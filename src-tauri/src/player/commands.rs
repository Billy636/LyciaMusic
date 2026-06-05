use crate::database::DbState;
use crate::music::scanner::apply_scan_changes;
use crate::music::types::Song;
use crate::player::equalizer::EqualizerSettings;
use crate::player::loudness::{
    calculate_playback_gain, get_song_loudness_record, process_song_on_play, LoudnessRecord,
};
use crate::player::spectrum::build_frequency_bands;
use crate::player::types::{
    AudioCommand, AudioOutputMode, AudioSource, PlayerState, VISUALIZER_BAND_COUNT,
};
use crate::remote::cache::{
    ensure_cached_path, is_remote_uri, remote_playback_source, RemotePlaybackSource,
};
use crate::remote::repository::get_source_for_remote_uri;
use crate::remote::scanner::song_from_cached_remote_file;
use crate::remote::types::RemoteFileEntry;
use souvlaki::{MediaMetadata, MediaPlayback, MediaPosition};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tauri::Emitter;

const REMOTE_LYRICS_CACHE_READY_EVENT: &str = "remote-lyrics-cache-ready";

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RemoteLyricsCacheReadyPayload {
    uri: String,
    song: Option<Song>,
}

fn normalize_cover_for_smtc(cover: &str) -> Option<String> {
    let trimmed = cover.trim();
    if trimmed.is_empty() {
        return None;
    }

    if trimmed.starts_with("file://")
        || trimmed.starts_with("http://")
        || trimmed.starts_with("https://")
        || trimmed.starts_with("data:")
    {
        return Some(trimmed.to_string());
    }

    let normalized = trimmed.replace('/', "\\");
    Some(format!("file://{normalized}"))
}

#[tauri::command]
pub async fn play_audio(
    path: String,
    title: String,
    artist: String,
    album: String,
    cover: String,
    duration: u32,
    output_mode: AudioOutputMode,
    start_offset_ms: Option<u64>,
    song_id: Option<i64>,
    volume_balance_enabled: Option<bool>,
    gain_offset_db: Option<f32>,
    prevent_clipping: Option<bool>,
    app: tauri::AppHandle,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let playback_id = state.playback_id.fetch_add(1, Ordering::Relaxed) + 1;
    let mut selected_output_mode = output_mode;
    let source = if is_remote_uri(&path) {
        match remote_playback_source(&db_state, &path)? {
            RemotePlaybackSource::Cached { path } => AudioSource::LocalFile(path),
            RemotePlaybackSource::Stream(stream) => {
                selected_output_mode = AudioOutputMode::Shared;
                schedule_remote_cache_after_half(
                    app.clone(),
                    db_state.conn.clone(),
                    state.progress.clone(),
                    state.playback_id.clone(),
                    playback_id,
                    stream.remote_uri.clone(),
                    duration,
                );
                AudioSource::RemoteWebDav(stream)
            }
        }
    } else {
        AudioSource::LocalFile(path.clone())
    };

    let mut volume_balance_gain = 1.0;
    if let (Some(s_id), Some(true)) = (song_id, volume_balance_enabled) {
        if let Ok(mut conn) = db_state.conn.lock() {
            if let Ok(record) = process_song_on_play(&mut conn, s_id, &path) {
                let offset_db = gain_offset_db.unwrap_or(0.0);
                let prev_clip = prevent_clipping.unwrap_or(true);
                volume_balance_gain = calculate_playback_gain(&record, offset_db, prev_clip);
            }
        }
    }

    let normalized_cover = normalize_cover_for_smtc(&cover);
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Play {
        source,
        output_mode: selected_output_mode,
        start_offset_ms,
        volume_balance_gain,
    })
    .map_err(|e| e.to_string())?;

    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: Some(&album),
                cover_url: normalized_cover.as_deref(),
                duration: if duration > 0 {
                    Some(Duration::from_secs(duration as u64))
                } else {
                    None
                },
            });
            let _ = mc.set_playback(MediaPlayback::Playing {
                progress: Some(MediaPosition(Duration::from_secs(0))),
            });
        }
    }

    Ok(())
}

fn schedule_remote_cache_after_half(
    app: tauri::AppHandle,
    conn: std::sync::Arc<std::sync::Mutex<rusqlite::Connection>>,
    progress: std::sync::Arc<crate::player::types::SharedProgress>,
    playback_id: std::sync::Arc<std::sync::atomic::AtomicU64>,
    expected_playback_id: u64,
    remote_uri: String,
    duration: u32,
) {
    tauri::async_runtime::spawn(async move {
        let threshold = if duration > 0 {
            duration as f64 * 0.5
        } else {
            30.0
        };
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            if playback_id.load(Ordering::Relaxed) != expected_playback_id {
                return;
            }

            let rate = progress.sample_rate.load(Ordering::Relaxed);
            let channels = progress.channels.load(Ordering::Relaxed);
            if rate == 0 || channels == 0 {
                continue;
            }

            let samples = progress.samples_played.load(Ordering::Relaxed);
            let seconds = samples as f64 / (rate as f64 * channels as f64);
            if seconds >= threshold {
                let db_state = DbState { conn };
                if let Ok(cache_path) = ensure_cached_path(&app, &db_state, &remote_uri).await {
                    let song =
                        update_cached_remote_audio_metadata(&db_state, &remote_uri, &cache_path);
                    let _ = app.emit(
                        REMOTE_LYRICS_CACHE_READY_EVENT,
                        RemoteLyricsCacheReadyPayload {
                            uri: remote_uri.clone(),
                            song,
                        },
                    );
                }
                return;
            }
        }
    });
}

fn update_cached_remote_audio_metadata(
    db_state: &DbState,
    remote_uri: &str,
    cache_path: &str,
) -> Option<Song> {
    let (source, remote_path, etag, stored_remote_uri) = {
        let conn = db_state.conn.lock().ok()?;
        get_source_for_remote_uri(&conn, remote_uri).ok()?
    };
    let normalized_uri = stored_remote_uri.unwrap_or_else(|| remote_uri.to_string());
    let file_size = std::fs::metadata(cache_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let file_name = remote_path
        .trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(&remote_path)
        .to_string();
    let remote_file = RemoteFileEntry {
        remote_path,
        name: file_name,
        size: file_size,
        etag,
        modified_at: None,
        is_dir: false,
    };
    let Some(song) = song_from_cached_remote_file(&source, &remote_file, Path::new(cache_path))
    else {
        return None;
    };
    if song.path != normalized_uri {
        return None;
    }
    if let Ok(mut conn) = db_state.conn.lock() {
        let _ = apply_scan_changes(&mut conn, &[], std::slice::from_ref(&song), &[], None);
    }
    Some(song)
}

#[tauri::command]
pub fn update_playback_metadata(
    title: String,
    artist: String,
    album: String,
    cover: String,
    duration: u32,
    is_playing: bool,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let normalized_cover = normalize_cover_for_smtc(&cover);
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_metadata(MediaMetadata {
                title: Some(&title),
                artist: Some(&artist),
                album: Some(&album),
                cover_url: normalized_cover.as_deref(),
                duration: if duration > 0 {
                    Some(Duration::from_secs(duration as u64))
                } else {
                    None
                },
            });
            let _ = mc.set_playback(if is_playing {
                MediaPlayback::Playing {
                    progress: Some(MediaPosition(Duration::from_secs(0))),
                }
            } else {
                MediaPlayback::Paused { progress: None }
            });
        }
    }

    Ok(())
}

#[tauri::command]
pub fn pause_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Pause).map_err(|e| e.to_string())?;
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Paused { progress: None });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn stop_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Stop).map_err(|e| e.to_string())?;
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Stopped);
        }
    }
    Ok(())
}

#[tauri::command]
pub fn resume_audio(state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Resume).map_err(|e| e.to_string())?;
    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let _ = mc.set_playback(MediaPlayback::Playing { progress: None });
        }
    }
    Ok(())
}

#[tauri::command]
pub fn seek_audio(
    time: f64,
    is_playing: bool,
    request_id: u64,
    state: tauri::State<PlayerState>,
) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::Seek {
        time,
        is_playing,
        request_id,
    })
    .map_err(|e| e.to_string())?;

    if let Ok(mut controls) = state.controls.lock() {
        if let Some(mc) = controls.as_mut() {
            let progress = MediaPosition(Duration::from_secs_f64(time.max(0.0)));
            if is_playing {
                let _ = mc.set_playback(MediaPlayback::Playing {
                    progress: Some(progress),
                });
            } else {
                let _ = mc.set_playback(MediaPlayback::Paused {
                    progress: Some(progress),
                });
            }
        }
    }

    Ok(())
}

#[tauri::command]
pub fn set_volume(volume: f32, state: tauri::State<PlayerState>) -> Result<(), String> {
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetVolume(volume))
        .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_playback_progress(state: tauri::State<PlayerState>) -> f64 {
    let samples = state.progress.samples_played.load(Ordering::Relaxed);
    let rate = state.progress.sample_rate.load(Ordering::Relaxed);
    let channels = state.progress.channels.load(Ordering::Relaxed);

    if rate == 0 || channels == 0 {
        return 0.0;
    }

    let total_samples_per_sec = rate as u64 * channels as u64;
    samples as f64 / total_samples_per_sec as f64
}

#[tauri::command]
pub fn get_audio_visualizer_samples(state: tauri::State<PlayerState>) -> Vec<f32> {
    let visualizer = &state.progress.visualizer;
    let sample_rate = state.progress.sample_rate.load(Ordering::Relaxed);
    build_frequency_bands(&visualizer.snapshot(), sample_rate, VISUALIZER_BAND_COUNT)
}

#[tauri::command]
pub async fn get_track_loudness_info(
    song_id: i64,
    db_state: tauri::State<'_, DbState>,
) -> Result<Option<LoudnessRecord>, String> {
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    get_song_loudness_record(&conn, song_id)
}

#[tauri::command]
pub async fn update_loudness_settings(
    enabled: bool,
    song_id: Option<i64>,
    song_path: Option<String>,
    gain_offset_db: f32,
    prevent_clipping: bool,
    db_state: tauri::State<'_, DbState>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    let mut target_gain = 1.0;
    if enabled {
        if let (Some(s_id), Some(path)) = (song_id, song_path.as_deref()) {
            if let Ok(mut conn) = db_state.conn.lock() {
                if let Ok(record) = process_song_on_play(&mut conn, s_id, path) {
                    target_gain =
                        calculate_playback_gain(&record, gain_offset_db, prevent_clipping);
                }
            }
        }
    }

    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    tx.send(AudioCommand::SetVolumeBalance {
        enabled,
        target_gain,
    })
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn set_equalizer_settings(
    enabled: bool,
    preamp: f32,
    gains: Vec<f32>,
    state: tauri::State<'_, PlayerState>,
) -> Result<(), String> {
    // 1. 严格入参校验：长度必须等于 10
    if gains.len() != 10 {
        return Err(format!("均衡器频段数量错误，期望 10，实际 {}", gains.len()));
    }

    // 2. 校验浮点数有限性，严禁 NaN / Inf
    if !preamp.is_finite() {
        return Err("Preamp 增益必须为有限浮点数，严禁 NaN/Inf".to_string());
    }
    for (i, &gain) in gains.iter().enumerate() {
        if !gain.is_finite() {
            return Err(format!("频段 {} 增益必须为有限浮点数，严禁 NaN/Inf", i));
        }
    }

    // 3. 数值 Clamp
    let preamp_clamped = preamp.clamp(-12.0, 12.0);
    let mut gains_clamped = [0.0; 10];
    for i in 0..10 {
        gains_clamped[i] = gains[i].clamp(-12.0, 12.0);
    }

    // 4. 发送指令
    let tx = state.tx.lock().map_err(|e| e.to_string())?;
    let settings = EqualizerSettings {
        enabled,
        preamp: preamp_clamped,
        gains: gains_clamped,
    };

    tx.send(AudioCommand::SetEqualizerSettings { settings })
        .map_err(|e| e.to_string())?;

    Ok(())
}
