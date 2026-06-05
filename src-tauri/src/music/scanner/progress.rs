use super::{LIBRARY_SCAN_BATCH_EVENT, LIBRARY_SCAN_PROGRESS_EVENT, PROGRESS_EMIT_INTERVAL_MS};
use crate::music::types::Song;
use serde::Serialize;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct ScanProgressPayload {
    phase: &'static str,
    current: usize,
    total: usize,
    folder_path: String,
    folder_index: usize,
    folder_total: usize,
    message: Option<String>,
    done: bool,
    failed: bool,
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "snake_case")]
struct ScanBatchPayload {
    songs: Vec<Song>,
    deleted_paths: Vec<String>,
    folder_path: String,
    folder_index: usize,
    folder_total: usize,
}

fn now_millis() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(u128::from(u64::MAX)) as u64
}

#[derive(Clone)]
pub(crate) struct ScanProgressReporter {
    app: AppHandle,
    folder_path: String,
    folder_index: usize,
    folder_total: usize,
    parse_processed: Arc<AtomicUsize>,
    last_emit_ms: Arc<AtomicU64>,
    buffered_songs: Arc<std::sync::Mutex<Vec<Song>>>,
    buffered_deleted: Arc<std::sync::Mutex<Vec<String>>>,
    last_batch_emit_ms: Arc<AtomicU64>,
}

impl ScanProgressReporter {
    pub(super) fn new(
        app: AppHandle,
        folder_path: String,
        folder_index: usize,
        folder_total: usize,
    ) -> Self {
        Self {
            app,
            folder_path,
            folder_index,
            folder_total,
            parse_processed: Arc::new(AtomicUsize::new(0)),
            last_emit_ms: Arc::new(AtomicU64::new(0)),
            buffered_songs: Arc::new(std::sync::Mutex::new(Vec::new())),
            buffered_deleted: Arc::new(std::sync::Mutex::new(Vec::new())),
            last_batch_emit_ms: Arc::new(AtomicU64::new(0)),
        }
    }

    fn emit(
        &self,
        phase: &'static str,
        current: usize,
        total: usize,
        message: Option<String>,
        done: bool,
        failed: bool,
    ) {
        let _ = self.app.emit(
            LIBRARY_SCAN_PROGRESS_EVENT,
            ScanProgressPayload {
                phase,
                current,
                total,
                folder_path: self.folder_path.clone(),
                folder_index: self.folder_index,
                folder_total: self.folder_total,
                message,
                done,
                failed,
            },
        );
    }

    pub(super) fn emit_collecting(&self, current: usize, total: usize, message: Option<String>) {
        self.emit("collecting", current, total, message, false, false);
    }

    pub(super) fn start_parsing(&self, total: usize) {
        self.parse_processed.store(0, Ordering::Relaxed);
        self.last_emit_ms.store(0, Ordering::Relaxed);
        self.emit(
            "parsing",
            0,
            total,
            Some(format!("正在解析 {} 首歌曲", total)),
            false,
            false,
        );
    }

    pub(super) fn advance_parsing(&self, total: usize) {
        let processed = self.parse_processed.fetch_add(1, Ordering::Relaxed) + 1;
        let now = now_millis();
        let last = self.last_emit_ms.load(Ordering::Relaxed);
        let should_emit = processed == total
            || processed == 1
            || processed % 25 == 0
            || now.saturating_sub(last) >= PROGRESS_EMIT_INTERVAL_MS;

        if should_emit {
            self.last_emit_ms.store(now, Ordering::Relaxed);
            self.emit(
                "parsing",
                processed,
                total,
                Some(format!("已解析 {processed}/{total} 首歌曲")),
                false,
                false,
            );
        }
    }

    pub(super) fn emit_writing(&self, current: usize, total: usize) {
        self.emit(
            "writing",
            current,
            total,
            Some(format!("正在写入数据库 {current}/{total}")),
            false,
            false,
        );
    }

    fn flush_batch_internal(&self, now: u64) {
        let (songs, deleted_paths) = {
            let mut songs_guard = self.buffered_songs.lock().ok();
            let mut deleted_guard = self.buffered_deleted.lock().ok();

            let songs = songs_guard.as_mut().map(|g| std::mem::take(&mut **g)).unwrap_or_default();
            let deleted = deleted_guard.as_mut().map(|g| std::mem::take(&mut **g)).unwrap_or_default();
            (songs, deleted)
        };

        if songs.is_empty() && deleted_paths.is_empty() {
            return;
        }

        self.last_batch_emit_ms.store(now, Ordering::Relaxed);

        let _ = self.app.emit(
            LIBRARY_SCAN_BATCH_EVENT,
            ScanBatchPayload {
                songs,
                deleted_paths,
                folder_path: self.folder_path.clone(),
                folder_index: self.folder_index,
                folder_total: self.folder_total,
            },
        );
    }

    pub(super) fn emit_complete(&self, total_songs: usize) {
        self.flush_batch_internal(now_millis());
        self.emit(
            "complete",
            total_songs,
            total_songs,
            Some(format!("已完成扫描，共 {} 首歌曲", total_songs)),
            true,
            false,
        );
    }

    pub(super) fn emit_error(&self, message: String) {
        self.flush_batch_internal(now_millis());
        self.emit("error", 0, 0, Some(message), true, true);
    }

    pub(super) fn emit_batch(&self, songs: Vec<Song>, deleted_paths: Vec<String>) {
        if songs.is_empty() && deleted_paths.is_empty() {
            return;
        }

        {
            if let Ok(mut buf_songs) = self.buffered_songs.lock() {
                buf_songs.extend(songs);
            }
            if let Ok(mut buf_deleted) = self.buffered_deleted.lock() {
                buf_deleted.extend(deleted_paths);
            }
        }

        let now = now_millis();
        let last = self.last_batch_emit_ms.load(Ordering::Relaxed);
        if now.saturating_sub(last) >= PROGRESS_EMIT_INTERVAL_MS {
            self.flush_batch_internal(now);
        }
    }
}
