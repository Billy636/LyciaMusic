use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::ImageReader;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{BufWriter, Write};
use std::panic::{catch_unwind, AssertUnwindSafe};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager, WebviewWindow};
use tokio::sync::oneshot;

const CUSTOM_BACKGROUND_CACHE_VERSION: &str = "v1";
const CUSTOM_BACKGROUND_CACHE_MAX_BYTES: u64 = 128 * 1024 * 1024;
// The cached image is already rendered at the physical screen size and blur is
// baked into it, so extra texture overscan only increases GPU memory.
const CUSTOM_BACKGROUND_RENDER_OVERSCAN: f64 = 1.0;
const CUSTOM_BACKGROUND_MAX_EDGE_PX: u32 = 3840;
const CUSTOM_BACKGROUND_JPEG_QUALITY: u8 = 90;
const CUSTOM_BACKGROUND_REQUEST_SUPERSEDED: &str = "CUSTOM_BACKGROUND_REQUEST_SUPERSEDED";
static CUSTOM_BACKGROUND_CACHE_IO: Mutex<()> = Mutex::new(());
static CUSTOM_BACKGROUND_CACHE_GENERATION: AtomicU64 = AtomicU64::new(0);

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedCustomBackgroundImage {
    pub display_path: String,
    pub source_width: u32,
    pub source_height: u32,
    pub display_width: u32,
    pub display_height: u32,
}

type PreparationResult = Result<PreparedCustomBackgroundImage, String>;
type PreparationWaiter = oneshot::Sender<PreparationResult>;

#[derive(Clone, Eq, Hash, PartialEq)]
struct PreparationConsumer {
    window_label: String,
    consumer_id: &'static str,
}

#[derive(Clone)]
struct PreparationTicket {
    consumer: PreparationConsumer,
    request_id: u64,
}

#[derive(Eq, PartialEq)]
struct PreparationKey {
    source_signature: String,
    cache_generation: u64,
    target_width: u32,
    target_height: u32,
    blur_bits: u32,
}

struct PreparationWork {
    app: AppHandle,
    source_path: String,
    target_width: u32,
    target_height: u32,
    blur_radius: f32,
}

struct PendingPreparation {
    key: PreparationKey,
    work: PreparationWork,
    waiters: HashMap<PreparationConsumer, PreparationWaiter>,
}

struct ActivePreparation {
    key: PreparationKey,
    waiters: HashMap<PreparationConsumer, PreparationWaiter>,
}

#[derive(Default)]
struct PreparationQueueState {
    latest_requests: HashMap<PreparationConsumer, u64>,
    pending: VecDeque<PendingPreparation>,
    active: Option<ActivePreparation>,
    worker_running: bool,
}

#[derive(Default)]
struct PreparationQueue {
    state: Mutex<PreparationQueueState>,
}

impl PreparationQueueState {
    fn prune_waiters(&mut self, app: &AppHandle) {
        let is_live = |consumer: &PreparationConsumer, waiter: &mut PreparationWaiter| {
            !waiter.is_closed() && app.get_webview_window(&consumer.window_label).is_some()
        };
        if let Some(active) = self.active.as_mut() {
            active.waiters.retain(is_live);
        }
        for job in &mut self.pending {
            job.waiters.retain(is_live);
        }
        self.pending.retain(|job| !job.waiters.is_empty());
        // Consumer IDs are fixed, and destroyed windows leave no sequence tombstones.
        self.latest_requests
            .retain(|consumer, _| app.get_webview_window(&consumer.window_label).is_some());
    }

    fn supersede_consumer(&mut self, consumer: &PreparationConsumer) {
        if let Some(active) = self.active.as_mut() {
            if let Some(waiter) = active.waiters.remove(consumer) {
                let _ = waiter.send(Err(CUSTOM_BACKGROUND_REQUEST_SUPERSEDED.to_string()));
            }
        }
        for job in &mut self.pending {
            if let Some(waiter) = job.waiters.remove(consumer) {
                let _ = waiter.send(Err(CUSTOM_BACKGROUND_REQUEST_SUPERSEDED.to_string()));
            }
        }
        self.pending.retain(|job| !job.waiters.is_empty());
    }
}

impl PreparationQueue {
    fn shared() -> Arc<Self> {
        static QUEUE: OnceLock<Arc<PreparationQueue>> = OnceLock::new();
        QUEUE.get_or_init(|| Arc::new(Self::default())).clone()
    }

    fn begin_request(
        &self,
        app: &AppHandle,
        consumer: PreparationConsumer,
        request_id: Option<u64>,
    ) -> Result<PreparationTicket, String> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.prune_waiters(app);
        let previous = state.latest_requests.get(&consumer).copied().unwrap_or(0);
        let request_id = match request_id {
            Some(request_id) if request_id <= previous => {
                return Err(CUSTOM_BACKGROUND_REQUEST_SUPERSEDED.to_string());
            }
            Some(request_id) => request_id,
            None => previous
                .checked_add(1)
                .ok_or_else(|| "背景图片请求序号已用尽".to_string())?,
        };
        state.latest_requests.insert(consumer.clone(), request_id);
        state.supersede_consumer(&consumer);
        Ok(PreparationTicket {
            consumer,
            request_id,
        })
    }

    fn enqueue(
        self: &Arc<Self>,
        ticket: &PreparationTicket,
        key: PreparationKey,
        work: PreparationWork,
    ) -> Result<oneshot::Receiver<PreparationResult>, String> {
        let (sender, receiver) = oneshot::channel();
        let start_worker = {
            let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
            state.prune_waiters(&work.app);
            if state.latest_requests.get(&ticket.consumer) != Some(&ticket.request_id) {
                return Err(CUSTOM_BACKGROUND_REQUEST_SUPERSEDED.to_string());
            }
            // An active job with no subscribers may already have decided to
            // skip processing. A fresh request must queue behind it instead of
            // inheriting that job's superseded result.
            if let Some(active) = state
                .active
                .as_mut()
                .filter(|active| active.key == key && !active.waiters.is_empty())
            {
                active.waiters.insert(ticket.consumer.clone(), sender);
            } else if let Some(pending) = state.pending.iter_mut().find(|job| job.key == key) {
                pending.waiters.insert(ticket.consumer.clone(), sender);
            } else {
                let mut waiters = HashMap::new();
                waiters.insert(ticket.consumer.clone(), sender);
                state
                    .pending
                    .push_back(PendingPreparation { key, work, waiters });
            }
            if state.worker_running {
                false
            } else {
                state.worker_running = true;
                true
            }
        };
        if start_worker {
            let queue = self.clone();
            tauri::async_runtime::spawn(async move { queue.run().await });
        }
        Ok(receiver)
    }

    fn detach(&self, ticket: &PreparationTicket) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        // A completed or dropped old future must never cancel a newer request.
        if state.latest_requests.get(&ticket.consumer) == Some(&ticket.request_id) {
            state.supersede_consumer(&ticket.consumer);
        }
    }

    fn next_work(&self) -> Option<PreparationWork> {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        while let Some(mut job) = state.pending.pop_front() {
            state.prune_waiters(&job.work.app);
            job.waiters.retain(|consumer, waiter| {
                !waiter.is_closed()
                    && job
                        .work
                        .app
                        .get_webview_window(&consumer.window_label)
                        .is_some()
            });
            if job.waiters.is_empty() {
                continue;
            }
            state.active = Some(ActivePreparation {
                key: job.key,
                waiters: job.waiters,
            });
            return Some(job.work);
        }
        state.worker_running = false;
        None
    }

    fn has_active_waiters(&self, app: &AppHandle) -> bool {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.prune_waiters(app);
        state
            .active
            .as_ref()
            .is_some_and(|active| !active.waiters.is_empty())
    }

    fn finish_work(&self, result: PreparationResult) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        if let Some(active) = state.active.take() {
            for waiter in active.waiters.into_values() {
                let _ = waiter.send(result.clone());
            }
        }
    }

    fn abort_worker(&self) {
        let mut state = self.state.lock().unwrap_or_else(|error| error.into_inner());
        state.worker_running = false;
        let error = "背景图片处理任务已中断，请重试".to_string();
        if let Some(active) = state.active.take() {
            for waiter in active.waiters.into_values() {
                let _ = waiter.send(Err(error.clone()));
            }
        }
        for job in state.pending.drain(..) {
            for waiter in job.waiters.into_values() {
                let _ = waiter.send(Err(error.clone()));
            }
        }
    }

    async fn run(self: Arc<Self>) {
        let mut worker_guard = PreparationWorkerGuard {
            queue: self.clone(),
            finished: false,
        };
        loop {
            let Some(work) = self.next_work() else {
                worker_guard.finished = true;
                return;
            };
            let queue = self.clone();
            let result = tauri::async_runtime::spawn_blocking(move || {
                let _cache_io = CUSTOM_BACKGROUND_CACHE_IO
                    .lock()
                    .unwrap_or_else(|error| error.into_inner());
                let result = catch_unwind(AssertUnwindSafe(|| {
                    // Clearing the cache may have held the I/O lock while this request expired.
                    if !queue.has_active_waiters(&work.app) {
                        return Err(CUSTOM_BACKGROUND_REQUEST_SUPERSEDED.to_string());
                    }
                    prepare_image(
                        &work.app,
                        Path::new(&work.source_path),
                        work.target_width,
                        work.target_height,
                        work.blur_radius,
                    )
                }))
                .unwrap_or_else(|_| Err("背景图片处理异常，请重新选择图片".to_string()));
                // Deliver while the cache lock is held, so a concurrent clear
                // cannot remove a newly generated file before its result is sent.
                queue.finish_work(result);
            })
            .await;
            if let Err(error) = result {
                self.finish_work(Err(format!("背景图片处理任务失败：{error}")));
            }
        }
    }
}

struct PreparationWorkerGuard {
    queue: Arc<PreparationQueue>,
    finished: bool,
}

impl Drop for PreparationWorkerGuard {
    fn drop(&mut self) {
        if !self.finished {
            self.queue.abort_worker();
        }
    }
}

struct PreparationWaiterGuard {
    queue: Arc<PreparationQueue>,
    ticket: PreparationTicket,
}

impl Drop for PreparationWaiterGuard {
    fn drop(&mut self) {
        self.queue.detach(&self.ticket);
    }
}

fn preparation_consumer(
    window: &WebviewWindow,
    consumer_id: Option<&str>,
) -> Result<PreparationConsumer, String> {
    let consumer_id = match consumer_id {
        None | Some("default") => "default",
        Some("global-background") => "global-background",
        Some("custom-skin-preview") => "custom-skin-preview",
        Some(_) => return Err("背景图片请求来源无效".to_string()),
    };
    Ok(PreparationConsumer {
        window_label: window.label().to_string(),
        consumer_id,
    })
}

pub fn get_custom_background_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("custom-backgrounds");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn source_signature(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("背景图片不存在".to_string());
    }

    let modified_nanos = metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    hasher.update(metadata.len().to_be_bytes());
    hasher.update(modified_nanos.to_be_bytes());
    Ok(hex::encode(hasher.finalize()))
}

fn calculate_display_dimensions(
    source_width: u32,
    source_height: u32,
    target_width: u32,
    target_height: u32,
) -> (u32, u32) {
    if source_width == 0 || source_height == 0 {
        return (0, 0);
    }

    let safe_target_width = target_width.max(1) as f64;
    let safe_target_height = target_height.max(1) as f64;
    let cover_scale =
        (safe_target_width / source_width as f64).max(safe_target_height / source_height as f64);
    let requested_scale = (cover_scale * CUSTOM_BACKGROUND_RENDER_OVERSCAN).min(1.0);
    let edge_scale =
        (CUSTOM_BACKGROUND_MAX_EDGE_PX as f64 / source_width.max(source_height) as f64).min(1.0);
    let scale = requested_scale.min(edge_scale);

    (
        ((source_width as f64 * scale).round() as u32).max(1),
        ((source_height as f64 * scale).round() as u32).max(1),
    )
}

fn cache_stem(
    source_signature: &str,
    display_width: u32,
    display_height: u32,
    blur_radius: f32,
) -> String {
    let blur_tenths = (blur_radius.max(0.0) * 10.0).round() as u32;
    format!(
        "{source_signature}_{CUSTOM_BACKGROUND_CACHE_VERSION}_{display_width}x{display_height}_b{blur_tenths}"
    )
}

fn touch_path(cache_path: &Path) -> PathBuf {
    cache_path.with_extension("touch")
}

fn touch_cache_entry(cache_path: &Path) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    let _ = fs::write(touch_path(cache_path), timestamp);
}

fn cache_entry_access_time(path: &Path) -> SystemTime {
    fs::metadata(touch_path(path))
        .and_then(|metadata| metadata.modified())
        .or_else(|_| fs::metadata(path).and_then(|metadata| metadata.modified()))
        .unwrap_or(UNIX_EPOCH)
}

fn cleanup_custom_background_cache(cache_dir: &Path, protected_path: Option<&Path>) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };

    let mut images: Vec<(PathBuf, u64, SystemTime)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "jpg"))
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok()?;
            Some((path.clone(), metadata.len(), cache_entry_access_time(&path)))
        })
        .collect();
    let mut total_bytes = images.iter().map(|(_, len, _)| *len).sum::<u64>();
    if total_bytes <= CUSTOM_BACKGROUND_CACHE_MAX_BYTES {
        return;
    }

    images.sort_by_key(|(_, _, accessed)| *accessed);
    for (path, len, _) in images {
        if total_bytes <= CUSTOM_BACKGROUND_CACHE_MAX_BYTES {
            break;
        }
        if protected_path.is_some_and(|protected| protected == path) {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            let _ = fs::remove_file(touch_path(&path));
            total_bytes = total_bytes.saturating_sub(len);
        }
    }
}

fn temporary_cache_path(cache_path: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    cache_path.with_extension(format!("{nonce}.tmp"))
}

struct TemporaryCacheFile(PathBuf);

impl Drop for TemporaryCacheFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn prepare_image(
    app: &AppHandle,
    source_path: &Path,
    target_width: u32,
    target_height: u32,
    blur_radius: f32,
) -> Result<PreparedCustomBackgroundImage, String> {
    let reader = ImageReader::open(source_path)
        .map_err(|error| format!("无法打开背景图片：{error}"))?
        .with_guessed_format()
        .map_err(|error| format!("无法识别背景图片格式：{error}"))?;
    let (source_width, source_height) = reader
        .into_dimensions()
        .map_err(|error| format!("无法读取背景图片尺寸：{error}"))?;
    let (display_width, display_height) =
        calculate_display_dimensions(source_width, source_height, target_width, target_height);
    if display_width == 0 || display_height == 0 {
        return Err("背景图片尺寸无效".to_string());
    }

    let signature = source_signature(source_path)?;
    let cache_dir = get_custom_background_cache_dir(app)?;
    let stem = cache_stem(&signature, display_width, display_height, blur_radius);
    let cache_path = cache_dir.join(format!("{stem}.jpg"));

    if fs::metadata(&cache_path)
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
    {
        touch_cache_entry(&cache_path);
        cleanup_custom_background_cache(&cache_dir, Some(&cache_path));
        return Ok(PreparedCustomBackgroundImage {
            display_path: cache_path.to_string_lossy().into_owned(),
            source_width,
            source_height,
            display_width,
            display_height,
        });
    }

    let decoded = image::open(source_path).map_err(|error| format!("无法解码背景图片：{error}"))?;
    let resized = decoded.resize_exact(display_width, display_height, FilterType::Lanczos3);
    drop(decoded);
    let rendered = if blur_radius > 0.05 {
        resized.blur(blur_radius)
    } else {
        resized
    };

    let temp_path = temporary_cache_path(&cache_path);
    let _temporary_file = TemporaryCacheFile(temp_path.clone());
    let file = fs::File::create(&temp_path).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, CUSTOM_BACKGROUND_JPEG_QUALITY);
    if let Err(error) = encoder.encode_image(&rendered) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("无法写入背景缓存：{error}"));
    }
    writer.flush().map_err(|error| error.to_string())?;
    drop(writer);
    drop(rendered);

    if cache_path.exists() {
        let _ = fs::remove_file(&cache_path);
    }
    fs::rename(&temp_path, &cache_path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        error.to_string()
    })?;
    touch_cache_entry(&cache_path);
    cleanup_custom_background_cache(&cache_dir, Some(&cache_path));

    Ok(PreparedCustomBackgroundImage {
        display_path: cache_path.to_string_lossy().into_owned(),
        source_width,
        source_height,
        display_width,
        display_height,
    })
}

#[tauri::command]
pub async fn prepare_custom_background_image(
    app: AppHandle,
    window: WebviewWindow,
    source_path: String,
    target_width: u32,
    target_height: u32,
    blur_radius: f32,
    consumer_id: Option<String>,
    request_id: Option<u64>,
) -> Result<PreparedCustomBackgroundImage, String> {
    let consumer = preparation_consumer(&window, consumer_id.as_deref())?;
    let queue = PreparationQueue::shared();
    let ticket = queue.begin_request(&app, consumer, request_id)?;
    let _waiter_guard = PreparationWaiterGuard {
        queue: queue.clone(),
        ticket: ticket.clone(),
    };
    // Register the latest request before validation, so even an invalid new
    // selection discards pending work for the consumer's previous selection.
    if !blur_radius.is_finite() || blur_radius < 0.0 {
        return Err("背景图片模糊参数无效".to_string());
    }
    let key = PreparationKey {
        source_signature: source_signature(Path::new(&source_path))?,
        cache_generation: CUSTOM_BACKGROUND_CACHE_GENERATION.load(Ordering::Acquire),
        target_width: target_width.max(1),
        target_height: target_height.max(1),
        blur_bits: blur_radius.to_bits(),
    };
    let receiver = queue.enqueue(
        &ticket,
        key,
        PreparationWork {
            app,
            source_path,
            target_width,
            target_height,
            blur_radius,
        },
    )?;
    receiver
        .await
        .map_err(|_| "背景图片处理任务已结束".to_string())?
}

#[tauri::command]
pub fn cancel_custom_background_image(
    app: AppHandle,
    window: WebviewWindow,
    consumer_id: Option<String>,
    request_id: Option<u64>,
) -> Result<(), String> {
    let consumer = preparation_consumer(&window, consumer_id.as_deref())?;
    PreparationQueue::shared()
        .begin_request(&app, consumer, request_id)
        .map(|_| ())
}

pub fn clear_custom_background_cache(app: &AppHandle) -> Result<(), String> {
    let _cache_io = CUSTOM_BACKGROUND_CACHE_IO
        .lock()
        .unwrap_or_else(|error| error.into_inner());
    // A request arriving after a clear must not join a completed job whose
    // result is still being delivered but whose cache file has been removed.
    CUSTOM_BACKGROUND_CACHE_GENERATION.fetch_add(1, Ordering::AcqRel);
    let cache_dir = get_custom_background_cache_dir(app)?;
    if !cache_dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(cache_dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_file() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downscales_eight_k_images_for_a_high_dpi_window() {
        assert_eq!(
            calculate_display_dimensions(8256, 6192, 2400, 1600),
            (2400, 1800)
        );
    }

    #[test]
    fn caps_the_longest_edge_at_four_k() {
        assert_eq!(
            calculate_display_dimensions(7680, 4320, 3840, 2160),
            (3840, 2160)
        );
    }

    #[test]
    fn never_upscales_small_sources() {
        assert_eq!(
            calculate_display_dimensions(1280, 720, 2400, 1600),
            (1280, 720)
        );
    }
}
