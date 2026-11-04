use super::{index_paths, retain_paths, sources, types::*};
use crate::database::DbState;
use notify::Watcher;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::{Duration, Instant};
use tauri::{AppHandle, Emitter, State};

#[derive(Default)]
pub struct PlaylistFileWatcher {
    sender: Mutex<Option<mpsc::Sender<Message>>>,
    generation: Arc<AtomicU64>,
}

enum Message {
    Configure(u64, Vec<FileBinding>),
    Changed(Vec<PathBuf>),
    Stop(mpsc::Sender<()>),
}

impl PlaylistFileWatcher {
    pub fn stop(&self) -> Result<(), String> {
        self.generation.fetch_add(1, Ordering::SeqCst);
        if let Some(sender) = self.sender.lock().map_err(|e| e.to_string())?.take() {
            let (tx, rx) = mpsc::channel();
            if sender.send(Message::Stop(tx)).is_ok() {
                rx.recv_timeout(Duration::from_secs(30))
                    .map_err(|_| "歌单文件任务尚未结束，请稍后重试清除数据")?;
            }
        }
        Ok(())
    }
}

struct Slot {
    binding: FileBinding,
    observed: Option<(Vec<u8>, Instant)>,
    output: String,
    dirty: bool,
}

fn path_key(path: &Path) -> String {
    let value = path.to_string_lossy().replace('\\', "/");
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

#[tauri::command]
pub async fn configure_playlist_files(
    bindings: Vec<FileBinding>,
    retained: Vec<RetainedPlaylist>,
    app: AppHandle,
    db: State<'_, DbState>,
    watcher: State<'_, PlaylistFileWatcher>,
) -> Result<(), String> {
    if bindings.len() > 500 {
        return Err("最多关联 500 个歌单文件".into());
    }
    let generation = watcher.generation.fetch_add(1, Ordering::SeqCst) + 1;
    let connection = db.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let mut conn = connection.lock().map_err(|e| e.to_string())?;
        super::ensure_schema(&conn)?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        tx.execute("DELETE FROM playlist_import_paths", [])
            .map_err(|e| e.to_string())?;
        for item in retained {
            retain_paths(&tx, &item.id, &item.paths)?;
        }
        tx.commit().map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())??;
    let mut sender = watcher.sender.lock().map_err(|e| e.to_string())?;
    if sender.is_none() {
        let (tx, rx) = mpsc::channel();
        let event_sender = tx.clone();
        let connection = db.conn.clone();
        let current_generation = watcher.generation.clone();
        std::thread::Builder::new()
            .name("playlist-files".into())
            .spawn(move || run(app, connection, rx, event_sender, current_generation))
            .map_err(|e| e.to_string())?;
        *sender = Some(tx);
    }
    sender
        .as_ref()
        .ok_or("文件监听未启动")?
        .send(Message::Configure(generation, bindings))
        .map_err(|e| e.to_string())
}

fn run(
    app: AppHandle,
    db: Arc<Mutex<rusqlite::Connection>>,
    receiver: mpsc::Receiver<Message>,
    sender: mpsc::Sender<Message>,
    current_generation: Arc<AtomicU64>,
) {
    let mut native = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result {
            let _ = sender.send(Message::Changed(event.paths));
        }
    })
    .ok();
    // Polling also covers missed native events, missing directories and newly arrived audio.
    let mut watched = HashSet::new();
    let mut slots: HashMap<String, Slot> = HashMap::new();
    let mut last_poll = Instant::now();
    let mut last_change = Instant::now();
    let mut generation = 0;
    loop {
        match receiver.recv_timeout(Duration::from_millis(250)) {
            Ok(Message::Configure(next_generation, bindings)) => {
                if next_generation != current_generation.load(Ordering::SeqCst) {
                    continue;
                }
                generation = next_generation;
                let mut previous = std::mem::take(&mut slots);
                for binding in bindings {
                    let id = binding.id.clone();
                    let mut slot = previous
                        .remove(&id)
                        .filter(|slot| slot.binding.revision == binding.revision)
                        .unwrap_or(Slot {
                            binding,
                            observed: None,
                            output: String::new(),
                            dirty: true,
                        });
                    slot.dirty = true;
                    slots.insert(id, slot);
                }
                update_watches(&mut native, &mut watched, &slots);
            }
            Ok(Message::Changed(paths)) => {
                for slot in slots.values_mut() {
                    if paths
                        .iter()
                        .any(|p| path_key(p) == path_key(Path::new(&slot.binding.path)))
                    {
                        slot.dirty = true;
                        last_change = Instant::now();
                    }
                }
            }
            Ok(Message::Stop(done)) => {
                let _ = done.send(());
                break;
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }
        if last_poll.elapsed() >= Duration::from_secs(30) {
            for slot in slots.values_mut() {
                slot.dirty = true;
            }
            update_watches(&mut native, &mut watched, &slots);
            last_poll = Instant::now();
        }
        if last_change.elapsed() < Duration::from_millis(700) {
            continue;
        }
        for slot in slots.values_mut().filter(|s| s.dirty) {
            if generation != current_generation.load(Ordering::SeqCst) {
                break;
            }
            let update = refresh(slot, &db, &current_generation, generation);
            if let Some(update) = update {
                if generation != current_generation.load(Ordering::SeqCst) {
                    break;
                }
                let key = serde_json::to_string(&update).unwrap_or_default();
                if slot.output != key {
                    slot.output = key;
                    let _ = app.emit("playlist-file-updated", update);
                }
            }
        }
    }
}

fn update_watches(
    native: &mut Option<notify::RecommendedWatcher>,
    watched: &mut HashSet<PathBuf>,
    slots: &HashMap<String, Slot>,
) {
    let mut wanted = HashSet::new();
    for slot in slots.values() {
        let mut parent = Path::new(&slot.binding.path).parent();
        while let Some(path) = parent {
            if path.is_dir() {
                wanted.insert(path.to_path_buf());
                break;
            }
            parent = path.parent();
        }
    }
    if let Some(native) = native {
        for path in watched.difference(&wanted) {
            let _ = native.unwatch(path);
        }
        let mut next = HashSet::new();
        for path in &wanted {
            if watched.contains(path)
                || native
                    .watch(path, notify::RecursiveMode::NonRecursive)
                    .is_ok()
            {
                next.insert(path.clone());
            }
        }
        *watched = next;
    }
}

fn refresh(
    slot: &mut Slot,
    db: &Arc<Mutex<rusqlite::Connection>>,
    current_generation: &AtomicU64,
    generation: u64,
) -> Option<FileUpdate> {
    let attempt = (|| {
        let path = Path::new(&slot.binding.path);
        let before = std::fs::metadata(path).map_err(|e| format!("源文件暂不可用：{e}"))?;
        let bytes = sources::read_bytes(path)?;
        let after = std::fs::metadata(path).map_err(|e| e.to_string())?;
        if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
            return Ok(None);
        }
        let hash = Sha256::digest(&bytes).to_vec();
        match &slot.observed {
            Some((previous, since))
                if *previous == hash && since.elapsed() >= Duration::from_millis(700) => {}
            Some((previous, _)) if *previous == hash => return Ok(None),
            _ => {
                slot.observed = Some((hash, Instant::now()));
                return Ok(None);
            }
        }
        let document = sources::parse_file(path, &bytes, slot.binding.mapping.as_ref())?;
        let paths = document
            .tracks
            .iter()
            .filter_map(|t| t.path.clone())
            .collect::<Vec<_>>();
        let mut conn = db.lock().map_err(|e| e.to_string())?;
        if generation != current_generation.load(Ordering::SeqCst) {
            return Ok(None);
        }
        let tx = conn.transaction().map_err(|e| e.to_string())?;
        retain_paths(&tx, &slot.binding.id, &paths)?;
        tx.commit().map_err(|e| e.to_string())?;
        drop(conn);
        let playable = index_paths(db, &paths)?;
        slot.dirty = false;
        Ok::<_, String>(Some((document, playable)))
    })();
    match attempt {
        Ok(Some((document, playable_paths))) => Some(FileUpdate {
            id: slot.binding.id.clone(),
            revision: slot.binding.revision.clone(),
            document: Some(document),
            playable_paths,
            error: None,
        }),
        Ok(None) => None,
        Err(error) => {
            slot.dirty = false;
            slot.observed = None;
            Some(FileUpdate {
                id: slot.binding.id.clone(),
                revision: slot.binding.revision.clone(),
                document: None,
                playable_paths: vec![],
                error: Some(error),
            })
        }
    }
}
