use crate::player::device::{default_output_device_name, emit_output_status};
use crate::player::loudness::{VolumeNormalizer, VolumeNormalizerHandle};
use crate::player::output::shared::progress_seconds_from_samples;
use crate::player::output::shared::{restore_current_playback, SharedOutputBackend};
#[cfg(target_os = "windows")]
use crate::player::output::wasapi_exclusive::{ExclusivePlayRequest, WasapiExclusivePlayback};
use crate::player::output::OutputBackend;
use crate::player::spectrum::SpectrumAnalyzer;
use crate::player::types::{
    AudioCommand, AudioOutputMode, AudioOutputStatus, AudioSource, PlaybackFinishedPayload,
    PlayerState, SeekCompletedPayload, SharedProgress, SharedVisualizer, TimedSource,
    VISUALIZER_BAND_COUNT, VISUALIZER_WINDOW_SIZE,
};
use crate::remote::cache::RemoteStreamSource;
use raw_window_handle::{HasWindowHandle, RawWindowHandle};
use rodio::Sink;
use souvlaki::{MediaControlEvent, MediaControls, MediaPlayback, PlatformConfig};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::{channel, RecvTimeoutError};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

const ACTIVE_PLAYER_POLL_INTERVAL: Duration = Duration::from_millis(150);
const IDLE_PLAYER_POLL_INTERVAL: Duration = Duration::from_secs(1);

#[derive(Clone, Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct PlaybackErrorPayload {
    playback_id: u64,
    message: String,
}

fn playback_failure(
    result: Result<(), String>,
    playback_id: u64,
    is_playing: &mut bool,
    current_sink: &mut Option<Sink>,
    normalizer: &mut Option<VolumeNormalizerHandle>,
) -> Option<PlaybackErrorPayload> {
    let message = result.err()?;
    *is_playing = false;
    if let Some(sink) = current_sink.take() {
        sink.stop();
    }
    *normalizer = None;
    Some(PlaybackErrorPayload {
        playback_id,
        message,
    })
}

fn report_playback_result(
    result: Result<(), String>,
    playback_id: u64,
    is_playing: &mut bool,
    current_sink: &mut Option<Sink>,
    normalizer: &mut Option<VolumeNormalizerHandle>,
    app: &AppHandle,
    controls: &Arc<Mutex<Option<MediaControls>>>,
) {
    if let Some(error) = playback_failure(result, playback_id, is_playing, current_sink, normalizer)
    {
        let _ = app.emit("playback-error", error);
        if let Ok(mut controls) = controls.lock() {
            // An older attempt may fail while a newer Play command is being
            // prepared. Like the frontend, leave the newer attempt untouched.
            let is_current = app
                .try_state::<PlayerState>()
                .is_some_and(|state| state.playback_id.load(Ordering::Relaxed) == playback_id);
            if is_current {
                if let Some(controls) = controls.as_mut() {
                    let _ = controls.set_playback(MediaPlayback::Stopped);
                }
            }
        }
    }
}

fn player_poll_interval(is_playing: bool) -> Duration {
    if is_playing {
        ACTIVE_PLAYER_POLL_INTERVAL
    } else {
        IDLE_PLAYER_POLL_INTERVAL
    }
}

fn progress_duration(progress: &Arc<SharedProgress>) -> Duration {
    let current_samples = progress.samples_played.load(Ordering::Relaxed);
    let rate = progress.sample_rate.load(Ordering::Relaxed);
    let channels = progress.channels.load(Ordering::Relaxed);

    Duration::from_secs_f64(progress_seconds_from_samples(
        current_samples,
        rate,
        channels,
    ))
}

fn reset_playback_progress(progress: &Arc<SharedProgress>) {
    progress.samples_played.store(0, Ordering::Relaxed);
    progress.visualizer.reset();
}

fn should_restore_for_default_device_change(
    selected_device_name: &Option<String>,
    last_default_device_name: &Option<String>,
    next_default_device_name: &Option<String>,
    _active_device_name: &Option<String>,
) -> bool {
    selected_device_name.is_none() && next_default_device_name != last_default_device_name
}

fn should_restore_shared_output(
    default_device_changed: bool,
    stream_has_error: bool,
    output_available: bool,
    is_playing: bool,
) -> bool {
    default_device_changed || stream_has_error || (is_playing && !output_available)
}

#[cfg(target_os = "windows")]
fn stop_exclusive_playback(exclusive_playback: &mut Option<WasapiExclusivePlayback>) {
    if let Some(mut playback) = exclusive_playback.take() {
        playback.stop();
    }
}

#[cfg(target_os = "windows")]
fn start_exclusive_playback(
    path: String,
    selected_device_name: Option<String>,
    current_volume: f32,
    is_playing: bool,
    start_time: Duration,
    progress: &Arc<SharedProgress>,
    volume_balance_gain: f32,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    cue_start_offset: Duration,
    total_duration: Option<Duration>,
) -> Result<WasapiExclusivePlayback, String> {
    WasapiExclusivePlayback::start(ExclusivePlayRequest {
        path,
        device_name: selected_device_name,
        volume: current_volume,
        is_playing,
        progress: progress.clone(),
        start_time,
        volume_balance_gain,
        equalizer_handle,
        user_volume,
        cue_start_offset,
        total_duration,
    })
    .map_err(|error| error.to_string())
}

#[allow(clippy::too_many_arguments)]
fn restore_preferred_output(
    selected_device_name: &Option<String>,
    output: &mut Option<SharedOutputBackend>,
    host: &cpal::Host,
    current_sink: &mut Option<Sink>,
    #[cfg(target_os = "windows")] exclusive_playback: &mut Option<WasapiExclusivePlayback>,
    active_device_name: &mut Option<String>,
    active_output_mode: &mut AudioOutputMode,
    fallback_reason: &mut Option<String>,
    requested_output_mode: AudioOutputMode,
    current_path: &str,
    current_volume: f32,
    is_playing_flag: bool,
    progress: &Arc<SharedProgress>,
    volume_balance_gain: f32,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    cue_start_offset: Duration,
    total_duration: Option<Duration>,
) -> Result<(), String> {
    *output = SharedOutputBackend::open(host, selected_device_name.as_deref()).ok();
    *active_device_name = output
        .as_ref()
        .map(|output| output.active_device_name().to_string());

    #[cfg(target_os = "windows")]
    if requested_output_mode == AudioOutputMode::WasapiExclusive && !current_path.is_empty() {
        match start_exclusive_playback(
            current_path.to_string(),
            selected_device_name.clone(),
            current_volume,
            is_playing_flag,
            progress_duration(progress),
            progress,
            volume_balance_gain,
            equalizer_handle.clone(),
            user_volume.clone(),
            cue_start_offset,
            total_duration,
        ) {
            Ok(playback) => {
                *active_device_name = Some(playback.active_device_name().to_string());
                *active_output_mode = AudioOutputMode::WasapiExclusive;
                *fallback_reason = None;
                *exclusive_playback = Some(playback);
                return Ok(());
            }
            Err(error) => {
                *active_output_mode = AudioOutputMode::Shared;
                *fallback_reason = Some(error);
            }
        }
    } else {
        *active_output_mode = AudioOutputMode::Shared;
        *fallback_reason = None;
    }

    #[cfg(not(target_os = "windows"))]
    {
        *active_output_mode = AudioOutputMode::Shared;
        *fallback_reason = if requested_output_mode == AudioOutputMode::WasapiExclusive {
            Some("WASAPI exclusive mode is only available on Windows".to_string())
        } else {
            None
        };
    }

    restore_current_playback(
        output,
        current_sink,
        current_path,
        is_playing_flag,
        progress,
        equalizer_handle,
        user_volume,
        cue_start_offset,
        total_duration,
    )
}

fn restore_shared_output(
    selected_device_name: &Option<String>,
    output: &mut Option<SharedOutputBackend>,
    host: &cpal::Host,
    current_sink: &mut Option<Sink>,
    active_device_name: &mut Option<String>,
    current_path: &str,
    is_playing_flag: bool,
    progress: &Arc<SharedProgress>,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    cue_start_offset: Duration,
    total_duration: Option<Duration>,
) -> Result<(), String> {
    *output = SharedOutputBackend::open(host, selected_device_name.as_deref()).ok();
    *active_device_name = output
        .as_ref()
        .map(|output| output.active_device_name().to_string());
    restore_current_playback(
        output,
        current_sink,
        current_path,
        is_playing_flag,
        progress,
        equalizer_handle,
        user_volume,
        cue_start_offset,
        total_duration,
    )
}

fn initialize_media_controls(app: &AppHandle) -> Arc<Mutex<Option<MediaControls>>> {
    let controls = Arc::new(Mutex::new(None));

    if let Some(window) = app.get_webview_window("main") {
        if let Ok(handle) = window.window_handle() {
            let raw_handle = handle.as_raw();

            #[cfg(target_os = "windows")]
            {
                if let RawWindowHandle::Win32(h) = raw_handle {
                    let hwnd = h.hwnd.get() as *mut std::ffi::c_void;

                    let config = PlatformConfig {
                        dbus_name: "my_cloud_music",
                        display_name: "My Cloud Music",
                        hwnd: Some(hwnd),
                    };

                    match MediaControls::new(config) {
                        Ok(mut mc) => {
                            let app_clone = app.clone();
                            let _ = mc.attach(move |event| match event {
                                MediaControlEvent::Play => {
                                    let _ = app_clone.emit("player:play", ());
                                }
                                MediaControlEvent::Pause => {
                                    let _ = app_clone.emit("player:pause", ());
                                }
                                MediaControlEvent::Next => {
                                    let _ = app_clone.emit("player:next", ());
                                }
                                MediaControlEvent::Previous => {
                                    let _ = app_clone.emit("player:prev", ());
                                }
                                MediaControlEvent::SetPosition(position) => {
                                    let seconds = position.0.as_secs_f64();
                                    if seconds.is_finite() && seconds >= 0.0 {
                                        let _ = app_clone.emit("player:seek", seconds);
                                    }
                                }
                                _ => {}
                            });
                            *controls.lock().unwrap() = Some(mc);
                        }
                        Err(error) => println!("Error initializing MediaControls: {:?}", error),
                    }
                }
            }
        }
    }

    controls
}

const REMOTE_STREAM_CHUNK_BYTES: u64 = 1024 * 1024;

struct RemoteRangeReader {
    client: reqwest::blocking::Client,
    source: RemoteStreamSource,
    pos: u64,
    len: Option<u64>,
    buffer_start: u64,
    buffer: Vec<u8>,
}

impl RemoteRangeReader {
    fn new(source: RemoteStreamSource) -> Result<Self, String> {
        let client = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(300))
            .build()
            .map_err(|error| error.to_string())?;
        let len = Self::content_len(&client, &source);
        Ok(Self {
            client,
            source,
            pos: 0,
            len,
            buffer_start: 0,
            buffer: Vec::new(),
        })
    }

    fn auth(
        request: reqwest::blocking::RequestBuilder,
        source: &RemoteStreamSource,
    ) -> reqwest::blocking::RequestBuilder {
        if let Some(username) = source.username.as_deref().filter(|value| !value.is_empty()) {
            request.basic_auth(username.to_string(), source.password.clone())
        } else {
            request
        }
    }

    fn content_len(client: &reqwest::blocking::Client, source: &RemoteStreamSource) -> Option<u64> {
        if let Ok(response) = Self::auth(client.head(&source.url), source).send() {
            if response.status().is_success() {
                if let Some(length) = response.content_length() {
                    return Some(length);
                }
            }
        }

        let response = Self::auth(
            client
                .get(&source.url)
                .header(reqwest::header::RANGE, "bytes=0-0"),
            source,
        )
        .send()
        .ok()?;
        if response.status() == reqwest::StatusCode::PARTIAL_CONTENT {
            response
                .headers()
                .get(reqwest::header::CONTENT_RANGE)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.rsplit('/').next())
                .and_then(|value| value.parse::<u64>().ok())
        } else if response.status().is_success() {
            response.content_length()
        } else {
            None
        }
    }

    fn fetch_at(&mut self, start: u64) -> std::io::Result<()> {
        let end = start.saturating_add(REMOTE_STREAM_CHUNK_BYTES - 1);
        let request = self
            .client
            .get(&self.source.url)
            .header(reqwest::header::RANGE, format!("bytes={start}-{end}"));
        let mut response = Self::auth(request, &self.source)
            .send()
            .map_err(std::io::Error::other)?;
        if !(response.status().is_success()
            || response.status() == reqwest::StatusCode::PARTIAL_CONTENT)
        {
            return Err(std::io::Error::other(format!(
                "远程音频播放失败：{}",
                response.status()
            )));
        }
        if response.status() == reqwest::StatusCode::OK && start > 0 {
            return Err(std::io::Error::other("WebDAV 服务器不支持 Range 播放"));
        }

        let mut limited = response.by_ref().take(REMOTE_STREAM_CHUNK_BYTES);
        let mut bytes = Vec::new();
        limited.read_to_end(&mut bytes)?;
        self.buffer_start = start;
        self.buffer = bytes;
        Ok(())
    }

    fn ensure_buffer(&mut self) -> std::io::Result<()> {
        let buffer_end = self.buffer_start.saturating_add(self.buffer.len() as u64);
        if self.pos >= self.buffer_start && self.pos < buffer_end {
            return Ok(());
        }
        self.fetch_at(self.pos)
    }
}

impl Read for RemoteRangeReader {
    fn read(&mut self, output: &mut [u8]) -> std::io::Result<usize> {
        if output.is_empty() {
            return Ok(0);
        }
        if self.len.map(|len| self.pos >= len).unwrap_or(false) {
            return Ok(0);
        }

        self.ensure_buffer()?;
        if self.buffer.is_empty() {
            return Ok(0);
        }

        let offset = self.pos.saturating_sub(self.buffer_start) as usize;
        let available = self.buffer.len().saturating_sub(offset);
        let count = available.min(output.len());
        output[..count].copy_from_slice(&self.buffer[offset..offset + count]);
        self.pos = self.pos.saturating_add(count as u64);
        Ok(count)
    }
}

impl Seek for RemoteRangeReader {
    fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
        let next = match pos {
            SeekFrom::Start(value) => value as i128,
            SeekFrom::Current(value) => self.pos as i128 + value as i128,
            SeekFrom::End(value) => {
                let len = self
                    .len
                    .ok_or_else(|| std::io::Error::other("远程音频长度未知，无法跳转"))?;
                len as i128 + value as i128
            }
        };
        if next < 0 {
            return Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "跳转位置不能小于 0",
            ));
        }
        self.pos = next as u64;
        Ok(self.pos)
    }
}

fn append_decoded_source<R>(
    reader: R,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    progress: &Arc<SharedProgress>,
    start_offset: Option<Duration>,
    volume_balance_gain: f32,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    cue_start_offset: Duration,
    total_duration: Option<Duration>,
    is_playing: bool,
) -> Result<(), String>
where
    R: Read + Seek + Send + Sync + 'static,
{
    let Some(output) = output else {
        // A disconnected device is retryable, not a corrupt track or normal EOF.
        return Ok(());
    };
    let prefetch_source = crate::player::decoder_thread::create_prefetch_source(
        reader,
        start_offset,
        cue_start_offset,
        total_duration,
    )?;
    let sink = output.create_sink().map_err(|error| error.to_string())?;
    let rate = prefetch_source.sample_rate();
    let playback_channels = prefetch_source.channels();
    let offset = start_offset.unwrap_or(Duration::ZERO);
    if start_offset.is_none() {
        progress.visualizer.reset();
    }

    progress.sample_rate.store(rate, Ordering::Relaxed);
    progress
        .channels
        .store(playback_channels as u32, Ordering::Relaxed);
    let skip_samples =
        (offset.as_secs_f64() * rate as f64 * playback_channels as f64).round() as u64;
    progress
        .samples_played
        .store(skip_samples, Ordering::Relaxed);

    let (normalized_source, handle) = VolumeNormalizer::new(
        prefetch_source.with_progress(progress.samples_played.clone()),
        volume_balance_gain,
        100,
    );
    *current_normalizer_handle = Some(handle);
    let eq_source = crate::player::equalizer::Equalizer::new(normalized_source, equalizer_handle);
    let vol_source = crate::player::equalizer::UserVolumeSource::new(eq_source, user_volume);
    let clip_source = crate::player::equalizer::ClipGuardSource::new(vol_source);
    let timed_source = TimedSource::new(clip_source, progress.visualizer.clone());

    if !is_playing {
        sink.pause();
    }
    sink.append(timed_source);
    sink.set_volume(1.0); // 主音量由 UserVolumeSource 接管
    *current_sink = Some(sink);
    Ok(())
}

fn handle_play(
    source: AudioSource,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_path: &mut String,
    is_playing_flag: &mut bool,
    progress: &Arc<SharedProgress>,
    start_offset_ms: Option<u64>,
    volume_balance_gain: f32,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    duration_ms: Option<u64>,
    cue_start_offset_ms: Option<u64>,
) -> Result<(), String> {
    *current_path = source.display_path();
    *is_playing_flag = true;
    reset_playback_progress(progress);

    if let Some(sink) = current_sink.take() {
        sink.stop();
    }
    *current_normalizer_handle = None;

    let start_offset = start_offset_ms.map(Duration::from_millis);
    let cue_start_offset = Duration::from_millis(cue_start_offset_ms.unwrap_or(0));
    let total_duration = if cue_start_offset_ms.is_some() {
        duration_ms.map(Duration::from_millis)
    } else {
        None
    };

    match source {
        AudioSource::LocalFile(path) => {
            let file = File::open(path).map_err(|error| format!("无法打开音频文件：{error}"))?;
            append_decoded_source(
                file,
                output,
                current_sink,
                progress,
                start_offset,
                volume_balance_gain,
                current_normalizer_handle,
                equalizer_handle,
                user_volume,
                cue_start_offset,
                total_duration,
                true,
            )
        }
        AudioSource::RemoteWebDav(stream) => {
            let reader = RemoteRangeReader::new(stream)?;
            append_decoded_source(
                reader,
                output,
                current_sink,
                progress,
                start_offset,
                volume_balance_gain,
                current_normalizer_handle,
                equalizer_handle,
                user_volume,
                cue_start_offset,
                total_duration,
                true,
            )
        }
    }
}

fn handle_seek(
    time: f64,
    is_playing: bool,
    request_id: u64,
    output: &Option<SharedOutputBackend>,
    current_sink: &mut Option<Sink>,
    current_source: &Option<AudioSource>,
    is_playing_flag: &mut bool,
    progress: &Arc<SharedProgress>,
    app: &AppHandle,
    volume_balance_gain: f32,
    current_normalizer_handle: &mut Option<VolumeNormalizerHandle>,
    equalizer_handle: Arc<crate::player::equalizer::EqualizerHandle>,
    user_volume: Arc<std::sync::atomic::AtomicU32>,
    duration_ms: Option<u64>,
    cue_start_offset_ms: Option<u64>,
) -> Result<(), String> {
    let clamped_time = time.max(0.0);
    let jump_target = Duration::from_secs_f64(clamped_time);
    *is_playing_flag = is_playing;
    progress.visualizer.reset();

    if let Some(sink) = current_sink {
        sink.stop();
    }
    *current_sink = None;
    *current_normalizer_handle = None;

    if let Some(source) = current_source {
        let cue_start_offset = Duration::from_millis(cue_start_offset_ms.unwrap_or(0));
        let total_duration = if cue_start_offset_ms.is_some() {
            duration_ms.map(Duration::from_millis)
        } else {
            None
        };

        match source {
            AudioSource::LocalFile(path) => {
                let file =
                    File::open(path).map_err(|error| format!("无法打开音频文件：{error}"))?;
                append_decoded_source(
                    file,
                    output,
                    current_sink,
                    progress,
                    Some(jump_target),
                    volume_balance_gain,
                    current_normalizer_handle,
                    equalizer_handle,
                    user_volume,
                    cue_start_offset,
                    total_duration,
                    is_playing,
                )?;
            }
            AudioSource::RemoteWebDav(stream) => {
                let reader = RemoteRangeReader::new(stream.clone())?;
                append_decoded_source(
                    reader,
                    output,
                    current_sink,
                    progress,
                    Some(jump_target),
                    volume_balance_gain,
                    current_normalizer_handle,
                    equalizer_handle,
                    user_volume,
                    cue_start_offset,
                    total_duration,
                    is_playing,
                )?;
            }
        }

        if let Some(new_sink) = current_sink {
            if is_playing {
                new_sink.play();
            } else {
                new_sink.pause();
            }
        }
    }

    let _ = app.emit(
        "seek_completed",
        SeekCompletedPayload {
            request_id,
            time: clamped_time,
        },
    );
    Ok(())
}

pub fn init_player(app: &AppHandle) -> PlayerState {
    let (tx, rx) = channel::<AudioCommand>();
    let shared_progress = Arc::new(SharedProgress {
        samples_played: Arc::new(AtomicU64::new(0)),
        sample_rate: Arc::new(AtomicU32::new(44100)),
        channels: Arc::new(AtomicU32::new(2)),
        cue_start_offset_ms: AtomicU64::new(0),
        visualizer: Arc::new(SharedVisualizer::new()),
    });
    let thread_progress = shared_progress.clone();
    let thread_app_handle = app.clone();
    let controls = initialize_media_controls(app);
    let thread_controls = controls.clone();
    let output_status = Arc::new(Mutex::new(AudioOutputStatus::default()));
    let thread_output_status = output_status.clone();

    // 在起播时创建非阻塞的 Equalizer 和 UserVolume 快照句柄
    let thread_eq_handle = Arc::new(crate::player::equalizer::EqualizerHandle::new(
        crate::player::equalizer::EqualizerSettings::default(),
    ));
    let thread_user_volume = Arc::new(AtomicU32::new(1.0_f32.to_bits()));

    thread::spawn(move || {
        let host = cpal::default_host();
        let mut selected_device_name: Option<String> = None;
        let mut output = SharedOutputBackend::open(&host, None).ok();
        let mut current_sink: Option<Sink> = None;
        #[cfg(target_os = "windows")]
        let mut exclusive_playback: Option<WasapiExclusivePlayback> = None;
        let mut current_path = String::new();
        let mut current_source: Option<AudioSource> = None;
        let mut current_volume = 1.0;
        let mut is_playing_flag = false;
        let mut current_duration_ms: Option<u64> = None;
        let mut current_cue_start_offset_ms: Option<u64> = None;
        let mut current_playback_id: u64 = 0;
        let mut requested_output_mode = AudioOutputMode::Shared;
        let mut active_output_mode = AudioOutputMode::Shared;
        let mut fallback_reason: Option<String> = None;
        let mut last_default_device_name = default_output_device_name(&host);
        let mut active_device_name = output
            .as_ref()
            .map(|output| output.active_device_name().to_string());
        let mut current_normalizer_handle: Option<VolumeNormalizerHandle> = None;
        let mut current_volume_balance_gain = 1.0;

        if let Some(output) = &output {
            current_sink = output.create_sink().ok();
        }

        emit_output_status(
            &thread_app_handle,
            &thread_output_status,
            selected_device_name.clone(),
            active_device_name.clone(),
            requested_output_mode,
            active_output_mode,
            fallback_reason.clone(),
        );

        loop {
            match rx.recv_timeout(player_poll_interval(is_playing_flag)) {
                Ok(cmd) => match cmd {
                    AudioCommand::Play {
                        source,
                        output_mode,
                        start_offset_ms,
                        volume_balance_gain,
                        duration_ms,
                        cue_start_offset_ms,
                        playback_id,
                    } => {
                        requested_output_mode = output_mode;
                        current_volume_balance_gain = volume_balance_gain;
                        current_duration_ms = duration_ms;
                        current_cue_start_offset_ms = cue_start_offset_ms;
                        thread_progress
                            .cue_start_offset_ms
                            .store(cue_start_offset_ms.unwrap_or(0), Ordering::Relaxed);
                        current_playback_id = playback_id;
                        let source_is_remote = source.is_remote();
                        let display_path = source.display_path();
                        current_source = Some(source.clone());

                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);

                        #[cfg(target_os = "windows")]
                        if output_mode == AudioOutputMode::WasapiExclusive && !source_is_remote {
                            let exclusive_start =
                                start_offset_ms.map_or(Duration::ZERO, Duration::from_millis);
                            let cue_start_offset =
                                Duration::from_millis(current_cue_start_offset_ms.unwrap_or(0));
                            let total_duration = if current_cue_start_offset_ms.is_some() {
                                current_duration_ms.map(Duration::from_millis)
                            } else {
                                None
                            };

                            match start_exclusive_playback(
                                display_path.clone(),
                                selected_device_name.clone(),
                                current_volume,
                                true,
                                exclusive_start,
                                &thread_progress,
                                current_volume_balance_gain,
                                thread_eq_handle.clone(),
                                thread_user_volume.clone(),
                                cue_start_offset,
                                total_duration,
                            ) {
                                Ok(playback) => {
                                    if selected_device_name.is_none() {
                                        last_default_device_name =
                                            default_output_device_name(&host);
                                    }
                                    active_device_name =
                                        Some(playback.active_device_name().to_string());
                                    active_output_mode = AudioOutputMode::WasapiExclusive;
                                    fallback_reason = None;
                                    current_path = display_path;
                                    is_playing_flag = true;
                                    exclusive_playback = Some(playback);
                                    current_sink = None;
                                    output = None;

                                    emit_output_status(
                                        &thread_app_handle,
                                        &thread_output_status,
                                        selected_device_name.clone(),
                                        active_device_name.clone(),
                                        requested_output_mode,
                                        active_output_mode,
                                        fallback_reason.clone(),
                                    );
                                    continue;
                                }
                                Err(error) => {
                                    active_output_mode = AudioOutputMode::Shared;
                                    fallback_reason = Some(error);
                                }
                            }
                        }
                        #[cfg(target_os = "windows")]
                        if output_mode == AudioOutputMode::WasapiExclusive && source_is_remote {
                            active_output_mode = AudioOutputMode::Shared;
                            fallback_reason =
                                Some("远程 WebDAV 音频使用共享模式流式播放".to_string());
                        }

                        #[cfg(not(target_os = "windows"))]
                        if output_mode == AudioOutputMode::WasapiExclusive {
                            active_output_mode = AudioOutputMode::Shared;
                            fallback_reason = Some(
                                "WASAPI exclusive mode is only available on Windows".to_string(),
                            );
                        }

                        if active_output_mode == AudioOutputMode::Shared {
                            output =
                                SharedOutputBackend::open(&host, selected_device_name.as_deref())
                                    .ok();
                            if selected_device_name.is_none() {
                                last_default_device_name = default_output_device_name(&host);
                            }
                            active_device_name = output
                                .as_ref()
                                .map(|output| output.active_device_name().to_string());
                        }

                        emit_output_status(
                            &thread_app_handle,
                            &thread_output_status,
                            selected_device_name.clone(),
                            active_device_name.clone(),
                            requested_output_mode,
                            active_output_mode,
                            fallback_reason.clone(),
                        );

                        let result = handle_play(
                            source,
                            &output,
                            &mut current_sink,
                            &mut current_path,
                            &mut is_playing_flag,
                            &thread_progress,
                            start_offset_ms,
                            current_volume_balance_gain,
                            &mut current_normalizer_handle,
                            thread_eq_handle.clone(),
                            thread_user_volume.clone(),
                            current_duration_ms,
                            current_cue_start_offset_ms,
                        );
                        report_playback_result(
                            result,
                            current_playback_id,
                            &mut is_playing_flag,
                            &mut current_sink,
                            &mut current_normalizer_handle,
                            &thread_app_handle,
                            &thread_controls,
                        );
                    }
                    AudioCommand::Pause => {
                        is_playing_flag = false;
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            playback.pause();
                        } else if let Some(sink) = &current_sink {
                            sink.pause();
                        }
                        #[cfg(not(target_os = "windows"))]
                        if let Some(sink) = &current_sink {
                            sink.pause();
                        }
                    }
                    AudioCommand::Stop => {
                        is_playing_flag = false;
                        current_path.clear();
                        current_source = None;
                        reset_playback_progress(&thread_progress);
                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);
                    }
                    AudioCommand::Resume => {
                        is_playing_flag = true;
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            playback.resume();
                        } else if let Some(sink) = &current_sink {
                            sink.play();
                        }
                        #[cfg(not(target_os = "windows"))]
                        if let Some(sink) = &current_sink {
                            sink.play();
                        }
                    }
                    AudioCommand::Seek {
                        time,
                        is_playing,
                        request_id,
                    } => {
                        #[cfg(target_os = "windows")]
                        if let Some(playback) = &exclusive_playback {
                            let clamped_time = time.max(0.0);
                            is_playing_flag = is_playing;
                            playback.seek(Duration::from_secs_f64(clamped_time), is_playing);
                            let _ = thread_app_handle.emit(
                                "seek_completed",
                                SeekCompletedPayload {
                                    request_id,
                                    time: clamped_time,
                                },
                            );
                            continue;
                        }

                        let result = handle_seek(
                            time,
                            is_playing,
                            request_id,
                            &output,
                            &mut current_sink,
                            &current_source,
                            &mut is_playing_flag,
                            &thread_progress,
                            &thread_app_handle,
                            current_volume_balance_gain,
                            &mut current_normalizer_handle,
                            thread_eq_handle.clone(),
                            thread_user_volume.clone(),
                            current_duration_ms,
                            current_cue_start_offset_ms,
                        );
                        report_playback_result(
                            result,
                            current_playback_id,
                            &mut is_playing_flag,
                            &mut current_sink,
                            &mut current_normalizer_handle,
                            &thread_app_handle,
                            &thread_controls,
                        );
                    }
                    AudioCommand::SetVolume(vol) => {
                        current_volume = vol;
                        thread_user_volume.store(vol.to_bits(), Ordering::Relaxed);
                    }
                    AudioCommand::SetDevice(device_name) => {
                        selected_device_name = device_name;

                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);

                        let cue_start_offset =
                            Duration::from_millis(current_cue_start_offset_ms.unwrap_or(0));
                        let total_duration = if current_cue_start_offset_ms.is_some() {
                            current_duration_ms.map(Duration::from_millis)
                        } else {
                            None
                        };

                        let result = restore_preferred_output(
                            &selected_device_name,
                            &mut output,
                            &host,
                            &mut current_sink,
                            #[cfg(target_os = "windows")]
                            &mut exclusive_playback,
                            &mut active_device_name,
                            &mut active_output_mode,
                            &mut fallback_reason,
                            requested_output_mode,
                            &current_path,
                            current_volume,
                            is_playing_flag,
                            &thread_progress,
                            current_volume_balance_gain,
                            thread_eq_handle.clone(),
                            thread_user_volume.clone(),
                            cue_start_offset,
                            total_duration,
                        );
                        report_playback_result(
                            result,
                            current_playback_id,
                            &mut is_playing_flag,
                            &mut current_sink,
                            &mut current_normalizer_handle,
                            &thread_app_handle,
                            &thread_controls,
                        );
                        if selected_device_name.is_none() {
                            last_default_device_name = default_output_device_name(&host);
                        }

                        emit_output_status(
                            &thread_app_handle,
                            &thread_output_status,
                            selected_device_name.clone(),
                            active_device_name.clone(),
                            requested_output_mode,
                            active_output_mode,
                            fallback_reason.clone(),
                        );
                    }
                    AudioCommand::SetOutputMode(output_mode) => {
                        requested_output_mode = output_mode;

                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);

                        let cue_start_offset =
                            Duration::from_millis(current_cue_start_offset_ms.unwrap_or(0));
                        let total_duration = if current_cue_start_offset_ms.is_some() {
                            current_duration_ms.map(Duration::from_millis)
                        } else {
                            None
                        };

                        let result = restore_preferred_output(
                            &selected_device_name,
                            &mut output,
                            &host,
                            &mut current_sink,
                            #[cfg(target_os = "windows")]
                            &mut exclusive_playback,
                            &mut active_device_name,
                            &mut active_output_mode,
                            &mut fallback_reason,
                            requested_output_mode,
                            &current_path,
                            current_volume,
                            is_playing_flag,
                            &thread_progress,
                            current_volume_balance_gain,
                            thread_eq_handle.clone(),
                            thread_user_volume.clone(),
                            cue_start_offset,
                            total_duration,
                        );
                        report_playback_result(
                            result,
                            current_playback_id,
                            &mut is_playing_flag,
                            &mut current_sink,
                            &mut current_normalizer_handle,
                            &thread_app_handle,
                            &thread_controls,
                        );
                        if selected_device_name.is_none() {
                            last_default_device_name = default_output_device_name(&host);
                        }

                        emit_output_status(
                            &thread_app_handle,
                            &thread_output_status,
                            selected_device_name.clone(),
                            active_device_name.clone(),
                            requested_output_mode,
                            active_output_mode,
                            fallback_reason.clone(),
                        );
                    }
                    AudioCommand::SetVolumeBalance {
                        enabled,
                        target_gain,
                    } => {
                        let next_gain = if enabled { target_gain } else { 1.0 };
                        current_volume_balance_gain = next_gain;

                        if let Some(ref handle) = current_normalizer_handle {
                            handle.set_target_gain(next_gain);
                        }

                        #[cfg(target_os = "windows")]
                        if let Some(ref playback) = exclusive_playback {
                            playback.set_volume_balance(enabled, target_gain);
                        }
                    }
                    AudioCommand::SetEqualizerSettings { settings } => {
                        thread_eq_handle.set_settings(settings.clone());
                        #[cfg(target_os = "windows")]
                        if let Some(ref playback) = exclusive_playback {
                            playback.set_equalizer_settings(settings);
                        }
                    }
                },
                Err(RecvTimeoutError::Timeout) => {
                    #[cfg(target_os = "windows")]
                    let exclusive_finished = if let Some(result) = exclusive_playback
                        .as_ref()
                        .and_then(|playback| playback.try_finished())
                    {
                        stop_exclusive_playback(&mut exclusive_playback);

                        match result {
                            Ok(()) => {
                                is_playing_flag = false;
                                let _ = thread_app_handle.emit(
                                    "playback-finished",
                                    PlaybackFinishedPayload {
                                        playback_id: current_playback_id,
                                    },
                                );
                                true
                            }
                            Err(error) => {
                                active_output_mode = AudioOutputMode::Shared;
                                fallback_reason = Some(error);
                                let cue_start_offset =
                                    Duration::from_millis(current_cue_start_offset_ms.unwrap_or(0));
                                let total_duration = if current_cue_start_offset_ms.is_some() {
                                    current_duration_ms.map(Duration::from_millis)
                                } else {
                                    None
                                };

                                let result = restore_shared_output(
                                    &selected_device_name,
                                    &mut output,
                                    &host,
                                    &mut current_sink,
                                    &mut active_device_name,
                                    &current_path,
                                    is_playing_flag,
                                    &thread_progress,
                                    thread_eq_handle.clone(),
                                    thread_user_volume.clone(),
                                    cue_start_offset,
                                    total_duration,
                                );
                                report_playback_result(
                                    result,
                                    current_playback_id,
                                    &mut is_playing_flag,
                                    &mut current_sink,
                                    &mut current_normalizer_handle,
                                    &thread_app_handle,
                                    &thread_controls,
                                );
                                if selected_device_name.is_none() {
                                    last_default_device_name = default_output_device_name(&host);
                                }

                                emit_output_status(
                                    &thread_app_handle,
                                    &thread_output_status,
                                    selected_device_name.clone(),
                                    active_device_name.clone(),
                                    requested_output_mode,
                                    active_output_mode,
                                    fallback_reason.clone(),
                                );
                                false
                            }
                        }
                    } else {
                        false
                    };

                    #[cfg(target_os = "windows")]
                    let should_check_shared = !exclusive_finished && exclusive_playback.is_none();
                    #[cfg(not(target_os = "windows"))]
                    let should_check_shared = true;

                    if should_check_shared
                        && is_playing_flag
                        && current_sink.as_ref().map_or(false, |sink| sink.empty())
                    {
                        is_playing_flag = false;
                        let _ = thread_app_handle.emit(
                            "playback-finished",
                            PlaybackFinishedPayload {
                                playback_id: current_playback_id,
                            },
                        );
                    }

                    let next_default_name = if selected_device_name.is_none() {
                        default_output_device_name(&host)
                    } else {
                        last_default_device_name.clone()
                    };
                    let default_device_changed = should_restore_for_default_device_change(
                        &selected_device_name,
                        &last_default_device_name,
                        &next_default_name,
                        &active_device_name,
                    );
                    let stream_has_error = should_check_shared
                        && output
                            .as_ref()
                            .is_some_and(SharedOutputBackend::has_stream_error);

                    if should_check_shared
                        && should_restore_shared_output(
                            default_device_changed,
                            stream_has_error,
                            output.is_some(),
                            is_playing_flag,
                        )
                    {
                        if selected_device_name.is_none() {
                            last_default_device_name = next_default_name;
                        }
                        if let Some(sink) = &current_sink {
                            sink.stop();
                        }
                        current_sink = None;
                        #[cfg(target_os = "windows")]
                        stop_exclusive_playback(&mut exclusive_playback);

                        let cue_start_offset =
                            Duration::from_millis(current_cue_start_offset_ms.unwrap_or(0));
                        let total_duration = if current_cue_start_offset_ms.is_some() {
                            current_duration_ms.map(Duration::from_millis)
                        } else {
                            None
                        };

                        let result = restore_preferred_output(
                            &selected_device_name,
                            &mut output,
                            &host,
                            &mut current_sink,
                            #[cfg(target_os = "windows")]
                            &mut exclusive_playback,
                            &mut active_device_name,
                            &mut active_output_mode,
                            &mut fallback_reason,
                            requested_output_mode,
                            &current_path,
                            current_volume,
                            is_playing_flag,
                            &thread_progress,
                            current_volume_balance_gain,
                            thread_eq_handle.clone(),
                            thread_user_volume.clone(),
                            cue_start_offset,
                            total_duration,
                        );

                        report_playback_result(
                            result,
                            current_playback_id,
                            &mut is_playing_flag,
                            &mut current_sink,
                            &mut current_normalizer_handle,
                            &thread_app_handle,
                            &thread_controls,
                        );

                        emit_output_status(
                            &thread_app_handle,
                            &thread_output_status,
                            selected_device_name.clone(),
                            active_device_name.clone(),
                            requested_output_mode,
                            active_output_mode,
                            fallback_reason.clone(),
                        );
                    }
                }
                Err(RecvTimeoutError::Disconnected) => break,
            }
        }
    });

    PlayerState {
        tx: Mutex::new(tx),
        progress: shared_progress,
        playback_id: Arc::new(AtomicU64::new(0)),
        controls,
        output_status,
        visualizer_analysis: Mutex::new(SpectrumAnalyzer::new(
            VISUALIZER_WINDOW_SIZE,
            VISUALIZER_BAND_COUNT,
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_progress_at(seconds: f64) -> Arc<SharedProgress> {
        let sample_rate = 44_100_u32;
        let channels = 2_u32;
        let samples = (seconds * sample_rate as f64 * channels as f64).round() as u64;

        Arc::new(SharedProgress {
            samples_played: Arc::new(AtomicU64::new(samples)),
            sample_rate: Arc::new(AtomicU32::new(sample_rate)),
            channels: Arc::new(AtomicU32::new(channels)),
            cue_start_offset_ms: AtomicU64::new(0),
            visualizer: Arc::new(SharedVisualizer::new()),
        })
    }

    #[test]
    fn handle_play_resets_progress_even_when_new_source_cannot_open() {
        let progress = test_progress_at(206.0);
        let mut current_sink = None;
        let mut current_path = String::new();
        let mut is_playing_flag = false;
        let mut current_normalizer_handle = None;

        let eq_handle = Arc::new(crate::player::equalizer::EqualizerHandle::new(
            crate::player::equalizer::EqualizerSettings::default(),
        ));
        let user_volume = Arc::new(std::sync::atomic::AtomicU32::new(1.0_f32.to_bits()));

        let result = handle_play(
            AudioSource::LocalFile("Z:\\missing\\song.flac".to_string()),
            &None,
            &mut current_sink,
            &mut current_path,
            &mut is_playing_flag,
            &progress,
            None,
            1.0,
            &mut current_normalizer_handle,
            eq_handle,
            user_volume,
            None,
            None,
        );

        assert_eq!(progress.samples_played.load(Ordering::Relaxed), 0);
        let error = playback_failure(
            result,
            42,
            &mut is_playing_flag,
            &mut current_sink,
            &mut current_normalizer_handle,
        )
        .expect("a missing file must produce a playback error, not a finished event");
        assert!(!is_playing_flag);
        assert!(current_sink.is_none());
        assert_eq!(error.playback_id, 42);
        assert!(error.message.contains("无法打开音频文件"));
    }

    #[test]
    fn invalid_audio_reports_its_playback_id_and_clears_playing_state() {
        let result = crate::player::decoder_thread::create_prefetch_source(
            std::io::Cursor::new(b"not an audio file".to_vec()),
            None,
            Duration::ZERO,
            None,
        )
        .map(|_| ());
        let (sink, _queue) = Sink::new_idle();
        let mut current_sink = Some(sink);
        let mut is_playing = true;
        let (_, handle) = VolumeNormalizer::new(
            rodio::buffer::SamplesBuffer::new(2, 44_100, vec![0.0_f32; 2]),
            1.0,
            100,
        );
        let mut normalizer = Some(handle);

        let error = playback_failure(
            result,
            7,
            &mut is_playing,
            &mut current_sink,
            &mut normalizer,
        )
        .expect("decoder failure must stop this playback attempt");

        assert!(!is_playing);
        assert!(current_sink.is_none());
        assert!(normalizer.is_none());
        let payload = serde_json::to_value(error).expect("serializable error payload");
        assert_eq!(payload["playbackId"], 7);
        assert!(payload["message"]
            .as_str()
            .is_some_and(|message| !message.is_empty()));
    }

    #[test]
    fn missing_output_device_remains_retryable_without_reporting_track_failure() {
        let progress = test_progress_at(0.0);
        let mut current_sink = None;
        let mut normalizer = None;
        let mut is_playing = true;
        let eq_handle = Arc::new(crate::player::equalizer::EqualizerHandle::new(
            crate::player::equalizer::EqualizerSettings::default(),
        ));
        let user_volume = Arc::new(AtomicU32::new(1.0_f32.to_bits()));
        let result = append_decoded_source(
            std::io::Cursor::new(Vec::<u8>::new()),
            &None,
            &mut current_sink,
            &progress,
            None,
            1.0,
            &mut normalizer,
            eq_handle,
            user_volume,
            Duration::ZERO,
            None,
            true,
        );

        assert!(playback_failure(
            result,
            7,
            &mut is_playing,
            &mut current_sink,
            &mut normalizer,
        )
        .is_none());
        assert!(is_playing);
        assert!(should_restore_shared_output(
            false, false, false, is_playing
        ));
    }

    #[test]
    fn default_device_monitor_ignores_active_output_display_name() {
        let selected_device_name = None;
        let last_default_device_name = Some("CPAL default device".to_string());
        let next_default_device_name = Some("CPAL default device".to_string());
        let active_device_name = Some("WASAPI friendly device".to_string());

        assert!(!should_restore_for_default_device_change(
            &selected_device_name,
            &last_default_device_name,
            &next_default_device_name,
            &active_device_name,
        ));
    }

    #[test]
    fn player_polling_slows_down_only_while_idle() {
        assert_eq!(player_poll_interval(true), Duration::from_millis(150));
        assert_eq!(player_poll_interval(false), Duration::from_secs(1));
    }

    #[test]
    fn test_take_duration_seek_recalibrates_remaining() {
        use rodio::buffer::SamplesBuffer;
        use rodio::Source;

        // 44.1kHz mono, 10 seconds of audio (441,000 samples)
        let samples = vec![0.0f32; 441_000];
        let buffer = SamplesBuffer::new(1, 44100, samples);
        let mut taken = buffer.take_duration(Duration::from_secs(4));

        // Consume 3 seconds (3 * 44100 = 132300 samples)
        for _ in 0..132_300 {
            assert!(taken.next().is_some());
        }

        // Seek back to 0.0 seconds
        taken
            .try_seek(Duration::ZERO)
            .expect("seek to 0 should succeed");

        // After seek: consume another 3 seconds (132300 samples), should still have samples available!
        let mut count = 0;
        for _ in 0..132_300 {
            if taken.next().is_some() {
                count += 1;
            }
        }
        assert_eq!(
            count, 132_300,
            "Should be able to play another 3 seconds after seeking back to 0"
        );
    }

    #[test]
    fn shared_output_recovers_when_stream_is_invalidated_without_device_rename() {
        assert!(should_restore_shared_output(false, true, true, true));
    }

    #[test]
    fn shared_output_retries_opening_while_playback_is_active() {
        assert!(should_restore_shared_output(false, false, false, true));
        assert!(!should_restore_shared_output(false, false, false, false));
    }
}
