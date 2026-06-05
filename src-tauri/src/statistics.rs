use crate::database::DbState;
use crate::music::utils::{format_distribution_bucket, is_lossless_audio, normalize_path};
use rusqlite::OptionalExtension;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::State;
use time::{format_description::well_known::Rfc3339, OffsetDateTime};

// =====================================================
// 辅助函数
// =====================================================

/// 判断是否为无效的专辑/歌手名（用于统计时排除）
fn is_invalid_name(name: &str) -> bool {
    let normalized = name.trim().to_lowercase();
    normalized.is_empty()
        || normalized == "未知"
        || normalized == "未知专辑"
        || normalized == "未知歌手"
        || normalized == "unknown"
        || normalized == "unknown album"
        || normalized == "unknown artist"
}

/// 判断是否为 Hi-Res (24bit + >=48kHz)
fn is_hires(bit_depth: Option<i64>, sample_rate: i64) -> bool {
    bit_depth.unwrap_or(0) >= 24 && sample_rate >= 48000
}

const SUPPORTED_STATS_VERSION: i64 = 1;
const RECENT_PLAY_LIMIT: i64 = 300;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableSongIdentity {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub track_number: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableSongStats {
    pub play_count: i64,
    pub play_time_ms: i64,
    pub full_play_count: i64,
    pub skip_count: i64,
    pub first_played_at: Option<String>,
    pub last_played_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableSongStatsEntry {
    pub song_identity: PortableSongIdentity,
    pub song_stats: PortableSongStats,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableGlobalStats {
    pub total_play_count: i64,
    pub total_play_time_ms: i64,
    pub first_played_at: Option<String>,
    pub last_played_at: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableDailyStats {
    pub date: String,
    pub play_count: i64,
    pub play_time_ms: i64,
    pub unique_songs: i64,
    pub unique_artists: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableHourlyStats {
    pub hour: i64,
    pub play_count: i64,
    pub play_time_ms: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableRecentPlay {
    pub played_at: String,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration_ms: i64,
    pub listened_ms: i64,
    pub is_full_play: bool,
    pub is_skip: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableStatisticsPayload {
    pub global: PortableGlobalStats,
    pub songs: Vec<PortableSongStatsEntry>,
    pub daily: Vec<PortableDailyStats>,
    pub hourly: Vec<PortableHourlyStats>,
    #[serde(default)]
    pub recent_plays: Vec<PortableRecentPlay>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct PortableStatisticsExport {
    pub format: String,
    pub version: i64,
    pub exported_at: String,
    pub app_version: String,
    pub export_id: String,
    pub library_fingerprint: Option<String>,
    pub stats: PortableStatisticsPayload,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsExportOptions {
    pub file_path: String,
    pub include_recent_plays: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsImportPreviewOptions {
    pub file_path: String,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "camelCase")]
pub enum StatisticsImportMode {
    Overwrite,
    Merge,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsImportOptions {
    pub file_path: String,
    pub mode: StatisticsImportMode,
    pub continue_duplicate_import: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsExportResult {
    pub file_path: String,
    pub export_id: String,
    pub exported_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsImportPreview {
    pub version: i64,
    pub exported_at: String,
    pub app_version: String,
    pub export_id: String,
    pub song_stats_count: usize,
    pub daily_stats_count: usize,
    pub recent_plays_count: usize,
    pub matched_song_count: usize,
    pub unmatched_song_count: usize,
    pub duplicate_import_detected: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StatisticsImportResult {
    pub mode: String,
    pub matched_song_count: usize,
    pub unmatched_song_count: usize,
    pub merged_song_count: usize,
    pub imported_recent_plays_count: usize,
    pub duplicate_import_skipped: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordPlayPayload {
    pub song_path: String,
    pub listened_ms: i64,
    pub duration_ms: i64,
    pub title: String,
    pub artist: String,
    pub album: String,
    pub track_number: Option<String>,
}

#[derive(Debug, Clone)]
struct LibraryMatchCandidate {
    path: String,
    identity: PortableSongIdentity,
}

#[derive(Default)]
struct LibraryMatchIndex {
    strict: HashMap<String, Vec<LibraryMatchCandidate>>,
    weak_artist: HashMap<String, Vec<LibraryMatchCandidate>>,
    weak_title: HashMap<String, Vec<LibraryMatchCandidate>>,
}

fn now_unix_seconds() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs() as i64
}

fn now_unix_millis() -> i128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis() as i128
}

fn now_iso_timestamp() -> Result<String, String> {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .map_err(|e| e.to_string())
}

fn unix_seconds_to_iso(timestamp: i64) -> Result<String, String> {
    OffsetDateTime::from_unix_timestamp(timestamp)
        .map_err(|e| e.to_string())?
        .format(&Rfc3339)
        .map_err(|e| e.to_string())
}

fn normalize_identity_text(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn parse_track_number_value(value: Option<&str>) -> Option<i64> {
    value
        .unwrap_or_default()
        .split(['/', '\\'])
        .next()
        .and_then(|raw| {
            let digits: String = raw.chars().take_while(|ch| ch.is_ascii_digit()).collect();
            if digits.is_empty() {
                None
            } else {
                digits.parse::<i64>().ok()
            }
        })
}

fn strict_identity_key(identity: &PortableSongIdentity) -> String {
    format!(
        "{}|{}|{}|{}",
        normalize_identity_text(&identity.title),
        normalize_identity_text(&identity.artist),
        normalize_identity_text(&identity.album),
        identity.duration_ms.max(0),
    )
}

fn weak_artist_identity_key(identity: &PortableSongIdentity) -> String {
    format!(
        "{}|{}|{}",
        normalize_identity_text(&identity.title),
        normalize_identity_text(&identity.artist),
        identity.duration_ms.max(0),
    )
}

fn weak_title_identity_key(identity: &PortableSongIdentity) -> String {
    format!(
        "{}|{}",
        normalize_identity_text(&identity.title),
        identity.duration_ms.max(0),
    )
}

fn recent_play_dedupe_key(entry: &PortableRecentPlay) -> String {
    format!(
        "{}|{}|{}|{}",
        entry.played_at,
        normalize_identity_text(&entry.title),
        normalize_identity_text(&entry.artist),
        entry.duration_ms.max(0),
    )
}

fn resolve_song_identity(
    title: &str,
    artist: &str,
    album: &str,
    duration_ms: i64,
    track_number: Option<i64>,
    fallback_path: Option<&str>,
) -> PortableSongIdentity {
    let fallback_title = fallback_path
        .and_then(|path| Path::new(path).file_stem())
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "Unknown".to_string());

    PortableSongIdentity {
        title: if title.trim().is_empty() {
            fallback_title
        } else {
            title.trim().to_string()
        },
        artist: artist.trim().to_string(),
        album: album.trim().to_string(),
        duration_ms: duration_ms.max(0),
        track_number,
    }
}

fn derive_play_flags(listened_ms: i64, duration_ms: i64) -> (bool, bool) {
    if listened_ms <= 0 || duration_ms <= 0 {
        return (false, false);
    }

    let full_threshold = ((duration_ms as f64) * 0.9).round() as i64;
    let skip_threshold = ((duration_ms as f64) * 0.5).round() as i64;
    let is_full_play = listened_ms >= full_threshold.max(duration_ms - 5_000);
    let is_skip = !is_full_play && listened_ms < skip_threshold.min(30_000);
    (is_full_play, is_skip)
}

fn sqlite_local_date(conn: &rusqlite::Connection, played_at: i64) -> Result<String, String> {
    conn.query_row(
        "SELECT strftime('%Y-%m-%d', ?1, 'unixepoch', 'localtime')",
        [played_at],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn sqlite_local_hour(conn: &rusqlite::Connection, played_at: i64) -> Result<i64, String> {
    conn.query_row(
        "SELECT CAST(strftime('%H', ?1, 'unixepoch', 'localtime') AS INTEGER)",
        [played_at],
        |row| row.get(0),
    )
    .map_err(|e| e.to_string())
}

fn get_statistics_meta(conn: &rusqlite::Connection, key: &str) -> Result<Option<String>, String> {
    conn.query_row(
        "SELECT value FROM statistics_meta WHERE key = ?1",
        [key],
        |row| row.get(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn set_statistics_meta(conn: &rusqlite::Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT INTO statistics_meta (key, value)
         VALUES (?1, ?2)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        rusqlite::params![key, value],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn clear_aggregate_statistics(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute("DELETE FROM global_stats", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM song_stats", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_stats", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM hourly_stats", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_unique_song_entries", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM daily_unique_artist_entries", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM recent_plays", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn merge_global_stats(
    conn: &rusqlite::Connection,
    global: &PortableGlobalStats,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO global_stats (id, total_play_count, total_play_time_ms, first_played_at, last_played_at)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(id) DO UPDATE SET
           total_play_count = global_stats.total_play_count + excluded.total_play_count,
           total_play_time_ms = global_stats.total_play_time_ms + excluded.total_play_time_ms,
           first_played_at = CASE
             WHEN global_stats.first_played_at IS NULL THEN excluded.first_played_at
             WHEN excluded.first_played_at IS NULL THEN global_stats.first_played_at
             WHEN excluded.first_played_at < global_stats.first_played_at THEN excluded.first_played_at
             ELSE global_stats.first_played_at
           END,
           last_played_at = CASE
             WHEN global_stats.last_played_at IS NULL THEN excluded.last_played_at
             WHEN excluded.last_played_at IS NULL THEN global_stats.last_played_at
             WHEN excluded.last_played_at > global_stats.last_played_at THEN excluded.last_played_at
             ELSE global_stats.last_played_at
           END",
        rusqlite::params![
            global.total_play_count,
            global.total_play_time_ms,
            global.first_played_at,
            global.last_played_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn upsert_song_stats(
    conn: &rusqlite::Connection,
    identity: &PortableSongIdentity,
    stats: &PortableSongStats,
) -> Result<(), String> {
    let strict_key = strict_identity_key(identity);
    conn.execute(
        "INSERT INTO song_stats (
            strict_identity_key, title, artist, album, duration_ms, track_number,
            play_count, play_time_ms, full_play_count, skip_count, first_played_at, last_played_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
         ON CONFLICT(strict_identity_key) DO UPDATE SET
            title = excluded.title,
            artist = excluded.artist,
            album = excluded.album,
            duration_ms = excluded.duration_ms,
            track_number = excluded.track_number,
            play_count = song_stats.play_count + excluded.play_count,
            play_time_ms = song_stats.play_time_ms + excluded.play_time_ms,
            full_play_count = song_stats.full_play_count + excluded.full_play_count,
            skip_count = song_stats.skip_count + excluded.skip_count,
            first_played_at = CASE
              WHEN song_stats.first_played_at IS NULL THEN excluded.first_played_at
              WHEN excluded.first_played_at IS NULL THEN song_stats.first_played_at
              WHEN excluded.first_played_at < song_stats.first_played_at THEN excluded.first_played_at
              ELSE song_stats.first_played_at
            END,
            last_played_at = CASE
              WHEN song_stats.last_played_at IS NULL THEN excluded.last_played_at
              WHEN excluded.last_played_at IS NULL THEN song_stats.last_played_at
              WHEN excluded.last_played_at > song_stats.last_played_at THEN excluded.last_played_at
              ELSE song_stats.last_played_at
            END",
        rusqlite::params![
            strict_key,
            identity.title,
            identity.artist,
            identity.album,
            identity.duration_ms,
            identity.track_number,
            stats.play_count,
            stats.play_time_ms,
            stats.full_play_count,
            stats.skip_count,
            stats.first_played_at,
            stats.last_played_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn upsert_daily_stats(
    conn: &rusqlite::Connection,
    daily: &PortableDailyStats,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO daily_stats (date, play_count, play_time_ms, unique_songs, unique_artists)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(date) DO UPDATE SET
            play_count = daily_stats.play_count + excluded.play_count,
            play_time_ms = daily_stats.play_time_ms + excluded.play_time_ms,
            unique_songs = MAX(daily_stats.unique_songs, excluded.unique_songs),
            unique_artists = MAX(daily_stats.unique_artists, excluded.unique_artists)",
        rusqlite::params![
            daily.date,
            daily.play_count,
            daily.play_time_ms,
            daily.unique_songs,
            daily.unique_artists,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn upsert_hourly_stats(
    conn: &rusqlite::Connection,
    hourly: &PortableHourlyStats,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO hourly_stats (hour, play_count, play_time_ms)
         VALUES (?1, ?2, ?3)
         ON CONFLICT(hour) DO UPDATE SET
            play_count = hourly_stats.play_count + excluded.play_count,
            play_time_ms = hourly_stats.play_time_ms + excluded.play_time_ms",
        rusqlite::params![hourly.hour, hourly.play_count, hourly.play_time_ms],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn prune_recent_plays(conn: &rusqlite::Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM recent_plays
         WHERE id NOT IN (
           SELECT id FROM recent_plays ORDER BY played_at DESC, id DESC LIMIT ?1
         )",
        [RECENT_PLAY_LIMIT],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_recent_play(
    conn: &rusqlite::Connection,
    entry: &PortableRecentPlay,
) -> Result<bool, String> {
    let affected = conn
        .execute(
            "INSERT OR IGNORE INTO recent_plays (
                recent_dedupe_key, played_at, title, artist, album, duration_ms, listened_ms, is_full_play, is_skip
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            rusqlite::params![
                recent_play_dedupe_key(entry),
                entry.played_at,
                entry.title,
                entry.artist,
                entry.album,
                entry.duration_ms,
                entry.listened_ms,
                if entry.is_full_play { 1 } else { 0 },
                if entry.is_skip { 1 } else { 0 },
            ],
        )
        .map_err(|e| e.to_string())?;
    prune_recent_plays(conn)?;
    Ok(affected > 0)
}

fn record_unique_daily_entries(
    conn: &rusqlite::Connection,
    date: &str,
    identity: &PortableSongIdentity,
) -> Result<(bool, bool), String> {
    let song_added = conn
        .execute(
            "INSERT OR IGNORE INTO daily_unique_song_entries (date, song_identity_key) VALUES (?1, ?2)",
            rusqlite::params![date, strict_identity_key(identity)],
        )
        .map_err(|e| e.to_string())?
        > 0;

    let artist_key = normalize_identity_text(&identity.artist);
    let artist_added = if artist_key.is_empty() {
        false
    } else {
        conn.execute(
            "INSERT OR IGNORE INTO daily_unique_artist_entries (date, artist_key) VALUES (?1, ?2)",
            rusqlite::params![date, artist_key],
        )
        .map_err(|e| e.to_string())?
            > 0
    };

    Ok((song_added, artist_added))
}

fn record_aggregate_play(
    conn: &rusqlite::Connection,
    identity: &PortableSongIdentity,
    played_at: i64,
    listened_ms: i64,
    is_full_play: bool,
    is_skip: bool,
) -> Result<(), String> {
    let played_at_iso = unix_seconds_to_iso(played_at)?;
    merge_global_stats(
        conn,
        &PortableGlobalStats {
            total_play_count: 1,
            total_play_time_ms: listened_ms.max(0),
            first_played_at: Some(played_at_iso.clone()),
            last_played_at: Some(played_at_iso.clone()),
        },
    )?;

    upsert_song_stats(
        conn,
        identity,
        &PortableSongStats {
            play_count: 1,
            play_time_ms: listened_ms.max(0),
            full_play_count: if is_full_play { 1 } else { 0 },
            skip_count: if is_skip { 1 } else { 0 },
            first_played_at: Some(played_at_iso.clone()),
            last_played_at: Some(played_at_iso.clone()),
        },
    )?;

    let date = sqlite_local_date(conn, played_at)?;
    let (is_new_song, is_new_artist) = record_unique_daily_entries(conn, &date, identity)?;
    upsert_daily_stats(
        conn,
        &PortableDailyStats {
            date,
            play_count: 1,
            play_time_ms: listened_ms.max(0),
            unique_songs: if is_new_song { 1 } else { 0 },
            unique_artists: if is_new_artist { 1 } else { 0 },
        },
    )?;

    let hour = sqlite_local_hour(conn, played_at)?;
    upsert_hourly_stats(
        conn,
        &PortableHourlyStats {
            hour,
            play_count: 1,
            play_time_ms: listened_ms.max(0),
        },
    )?;

    insert_recent_play(
        conn,
        &PortableRecentPlay {
            played_at: played_at_iso,
            title: identity.title.clone(),
            artist: identity.artist.clone(),
            album: identity.album.clone(),
            duration_ms: identity.duration_ms,
            listened_ms: listened_ms.max(0),
            is_full_play,
            is_skip,
        },
    )?;

    Ok(())
}

// =====================================================
// 曲库统计
// =====================================================

/// 曲库统计结果（简化版）
#[derive(Serialize)]
pub struct LibraryStats {
    pub total_songs: i64,
    pub total_duration: i64,   // 秒
    pub total_file_size: i64,  // 字节
    pub album_count: i64,      // 专辑数（排除空/未知）
    pub artist_count: i64,     // 歌手数（排除空/未知）
    pub lossless_count: i64,   // 无损数量
    pub hires_count: i64,      // Hi-Res 数量 (24bit + >=48k)
    pub this_month_added: i64, // 本月首次入库数量
}

/// 音质分布统计
#[derive(Serialize)]
pub struct QualityDistribution {
    pub hires: i64,         // Hi-Res (24bit + >=48kHz 无损)
    pub super_quality: i64, // SQ (普通无损)
    pub high_quality: i64,  // HQ (有损 >= 256kbps)
    pub other: i64,         // 其他
}

/// 文件格式分布统计
#[derive(Serialize)]
pub struct FormatDistribution {
    pub flac: i64,
    pub mp3: i64,
    pub alac: i64,
    pub wav: i64,
    pub aiff: i64,
    pub aac: i64,
    pub ogg: i64,
    pub other: i64,
}

/// 获取文件格式分布统计
#[tauri::command]
pub fn get_format_distribution(db: State<DbState>) -> Result<FormatDistribution, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT format, container, codec FROM songs")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, Option<String>>(1).ok().flatten(),
                row.get::<_, Option<String>>(2).ok().flatten(),
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut flac = 0i64;
    let mut mp3 = 0i64;
    let mut alac = 0i64;
    let mut wav = 0i64;
    let mut aiff = 0i64;
    let mut aac = 0i64;
    let mut ogg = 0i64;
    let mut other = 0i64;

    for row in rows.flatten() {
        match format_distribution_bucket(row.1.as_deref(), row.2.as_deref(), &row.0) {
            "flac" => flac += 1,
            "mp3" => mp3 += 1,
            "alac" => alac += 1,
            "wav" => wav += 1,
            "aiff" => aiff += 1,
            "aac" => aac += 1,
            "ogg" => ogg += 1,
            _ => other += 1,
        }
    }

    Ok(FormatDistribution {
        flac,
        mp3,
        alac,
        wav,
        aiff,
        aac,
        ogg,
        other,
    })
}

/// 获取音质分布统计
#[tauri::command]
pub fn get_quality_distribution(db: State<DbState>) -> Result<QualityDistribution, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    let mut stmt = conn
        .prepare("SELECT format, codec, bit_depth, sample_rate, bitrate FROM songs")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0).unwrap_or_default(),
                row.get::<_, Option<String>>(1).ok().flatten(),
                row.get::<_, Option<i64>>(2).ok().flatten(),
                row.get::<_, i64>(3).unwrap_or(0),
                row.get::<_, i64>(4).unwrap_or(0),
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut hires = 0i64;
    let mut super_quality = 0i64;
    let mut high_quality = 0i64;
    let mut other = 0i64;

    for row in rows.flatten() {
        let (format, codec, bit_depth, sample_rate, bitrate) = row;
        let is_lossless = is_lossless_audio(codec.as_deref(), &format);
        let is_hr = is_hires(bit_depth, sample_rate);

        if is_lossless && is_hr {
            hires += 1;
        } else if is_lossless {
            super_quality += 1;
        } else if bitrate >= 256 {
            high_quality += 1;
        } else {
            other += 1;
        }
    }

    Ok(QualityDistribution {
        hires,
        super_quality,
        high_quality,
        other,
    })
}

/// 获取曲库统计（全库，无 scope/time_range 参数）
#[tauri::command]
pub fn get_library_stats(db: State<DbState>) -> Result<LibraryStats, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 基础统计
    let (total_songs, total_duration, total_file_size): (i64, i64, i64) = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(duration), 0), COALESCE(SUM(file_size), 0) FROM songs",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|e| e.to_string())?;

    // 专辑数（排除空/未知）- 在 Rust 端过滤
    let album_count: i64 = {
        let mut stmt = conn
            .prepare("SELECT DISTINCT album FROM songs WHERE album IS NOT NULL AND album != ''")
            .map_err(|e| e.to_string())?;
        let albums: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter(|name: &String| !is_invalid_name(name))
            .collect();
        albums.len() as i64
    };

    // 歌手数（排除空/未知）
    let artist_count: i64 = {
        let mut stmt = conn
            .prepare("SELECT DISTINCT artist FROM songs WHERE artist IS NOT NULL AND artist != ''")
            .map_err(|e| e.to_string())?;
        let artists: Vec<String> = stmt
            .query_map([], |row| row.get(0))
            .map_err(|e| e.to_string())?
            .filter_map(|r| r.ok())
            .filter(|name: &String| !is_invalid_name(name))
            .collect();
        artists.len() as i64
    };

    // 无损数量 + Hi-Res 数量
    let (lossless_count, hires_count): (i64, i64) = {
        let mut stmt = conn
            .prepare("SELECT format, codec, bit_depth, sample_rate FROM songs")
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0).unwrap_or_default(),
                    row.get::<_, Option<String>>(1).ok().flatten(),
                    row.get::<_, Option<i64>>(2).ok().flatten(),
                    row.get::<_, i64>(3).unwrap_or(0),
                ))
            })
            .map_err(|e| e.to_string())?;

        let mut lossless = 0i64;
        let mut hires = 0i64;
        for row in rows.flatten() {
            if is_lossless_audio(row.1.as_deref(), &row.0) {
                lossless += 1;
                if is_hires(row.2, row.3) {
                    hires += 1;
                }
            }
        }
        (lossless, hires)
    };

    // 本月首次入库数量
    let this_month_added: i64 = {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        // 简化：30天内入库
        let month_start = now - 30 * 24 * 60 * 60;
        conn.query_row(
            "SELECT COUNT(*) FROM songs WHERE added_at >= ?1",
            [month_start],
            |row| row.get(0),
        )
        .unwrap_or(0)
    };

    Ok(LibraryStats {
        total_songs,
        total_duration,
        total_file_size,
        album_count,
        artist_count,
        lossless_count,
        hires_count,
        this_month_added,
    })
}

// =====================================================
// 播放历史与行为统计
// =====================================================

/// 时间范围（用于行为统计）
#[derive(Deserialize, Debug)]
#[serde(tag = "type")]
pub enum TimeRange {
    All,
    Days7,
    Days30,
    ThisYear,
}

impl TimeRange {
    fn to_timestamp_from(&self) -> Option<i64> {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;

        match self {
            TimeRange::All => None,
            TimeRange::Days7 => Some(now - 7 * 24 * 60 * 60),
            TimeRange::Days30 => Some(now - 30 * 24 * 60 * 60),
            TimeRange::ThisYear => Some(now - 365 * 24 * 60 * 60),
        }
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentHistoryEntry {
    pub song_path: String,
    pub played_at: i64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentHistoryImportEntry {
    pub song_path: String,
    pub played_at: i64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentAlbumCatalogItem {
    pub key: String,
    pub name: String,
    pub artist: String,
    pub played_at: i64,
    pub first_song_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentPlaylistCatalogItem {
    pub id: String,
    pub name: String,
    pub count: u32,
    pub played_at: i64,
    pub first_song_path: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PlaylistImportItem {
    pub id: String,
    pub name: String,
    pub song_paths: Vec<String>,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "snake_case")]
pub enum SongPathSortMode {
    Title,
    Artist,
    AddedAt,
    AddedAtAsc,
    FileModifiedAt,
    FileModifiedAtAsc,
}

#[derive(Debug)]
struct SongCatalogRow {
    path: String,
    artist: String,
    artist_names: Vec<String>,
    effective_artist_names: Vec<String>,
    album: String,
    album_artist: String,
    album_key: String,
}

#[derive(Debug)]
struct SongViewRow {
    path: String,
    title: String,
    artist: String,
    artist_names: Vec<String>,
    effective_artist_names: Vec<String>,
    album: String,
    album_artist: String,
    album_key: String,
    added_at: Option<i64>,
    file_modified_at: Option<i64>,
}

fn deserialize_string_list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

fn preferred_artist_names(row: &SongCatalogRow) -> Vec<String> {
    if !row.effective_artist_names.is_empty() {
        return row.effective_artist_names.clone();
    }

    if !row.artist_names.is_empty() {
        return row.artist_names.clone();
    }

    vec![row.artist.clone()]
}

fn preferred_view_artist_names(row: &SongViewRow) -> Vec<String> {
    if !row.effective_artist_names.is_empty() {
        return row.effective_artist_names.clone();
    }

    if !row.artist_names.is_empty() {
        return row.artist_names.clone();
    }

    vec![row.artist.clone()]
}

fn resolve_album_key(row: &SongCatalogRow) -> String {
    if !row.album_key.trim().is_empty() {
        return row.album_key.clone();
    }

    let album = if row.album.trim().is_empty() {
        "unknown".to_string()
    } else {
        row.album.to_ascii_lowercase()
    };
    let artist = if row.album_artist.trim().is_empty() && row.artist.trim().is_empty() {
        "unknown".to_string()
    } else if row.album_artist.trim().is_empty() {
        row.artist.to_ascii_lowercase()
    } else {
        row.album_artist.to_ascii_lowercase()
    };

    format!("{}::{}", album, artist,)
}

fn resolve_view_album_key(row: &SongViewRow) -> String {
    if !row.album_key.trim().is_empty() {
        return row.album_key.clone();
    }

    let album = if row.album.trim().is_empty() {
        "unknown".to_string()
    } else {
        row.album.to_ascii_lowercase()
    };
    let artist = if row.album_artist.trim().is_empty() && row.artist.trim().is_empty() {
        "unknown".to_string()
    } else if row.album_artist.trim().is_empty() {
        row.artist.to_ascii_lowercase()
    } else {
        row.album_artist.to_ascii_lowercase()
    };

    format!("{album}::{artist}")
}

fn path_file_name(path: &str) -> String {
    std::path::Path::new(path)
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| path.to_string())
}

fn song_title_label(row: &SongViewRow) -> String {
    if row.title.trim().is_empty() {
        path_file_name(&row.path)
    } else {
        row.title.clone()
    }
}

fn song_matches_query(row: &SongViewRow, query: &str) -> bool {
    let lowered_query = query.trim().to_lowercase();
    if lowered_query.is_empty() {
        return true;
    }

    path_file_name(&row.path)
        .to_lowercase()
        .contains(&lowered_query)
        || row.title.to_lowercase().contains(&lowered_query)
        || row.artist.to_lowercase().contains(&lowered_query)
        || row.album.to_lowercase().contains(&lowered_query)
        || row.album_artist.to_lowercase().contains(&lowered_query)
        || preferred_view_artist_names(row)
            .iter()
            .any(|name| name.to_lowercase().contains(&lowered_query))
}

fn song_has_artist(row: &SongViewRow, artist_name: &str) -> bool {
    preferred_view_artist_names(row)
        .iter()
        .any(|name| name == artist_name)
}

fn sort_song_view_rows(rows: &mut [SongViewRow], sort_mode: &SongPathSortMode) {
    rows.sort_by(|left, right| match sort_mode {
        SongPathSortMode::Title => song_title_label(left)
            .to_lowercase()
            .cmp(&song_title_label(right).to_lowercase()),
        SongPathSortMode::Artist => left
            .artist
            .to_lowercase()
            .cmp(&right.artist.to_lowercase())
            .then_with(|| {
                song_title_label(left)
                    .to_lowercase()
                    .cmp(&song_title_label(right).to_lowercase())
            }),
        SongPathSortMode::AddedAt => right
            .added_at
            .unwrap_or_default()
            .cmp(&left.added_at.unwrap_or_default())
            .then_with(|| {
                song_title_label(left)
                    .to_lowercase()
                    .cmp(&song_title_label(right).to_lowercase())
            }),
        SongPathSortMode::AddedAtAsc => left
            .added_at
            .unwrap_or_default()
            .cmp(&right.added_at.unwrap_or_default())
            .then_with(|| {
                song_title_label(left)
                    .to_lowercase()
                    .cmp(&song_title_label(right).to_lowercase())
            }),
        SongPathSortMode::FileModifiedAt => right
            .file_modified_at
            .unwrap_or_default()
            .cmp(&left.file_modified_at.unwrap_or_default())
            .then_with(|| {
                song_title_label(left)
                    .to_lowercase()
                    .cmp(&song_title_label(right).to_lowercase())
            }),
        SongPathSortMode::FileModifiedAtAsc => left
            .file_modified_at
            .unwrap_or_default()
            .cmp(&right.file_modified_at.unwrap_or_default())
            .then_with(|| {
                song_title_label(left)
                    .to_lowercase()
                    .cmp(&song_title_label(right).to_lowercase())
            }),
    });
}

fn load_song_catalog_row(
    conn: &rusqlite::Connection,
    normalized_path: &str,
) -> Result<Option<SongCatalogRow>, String> {
    conn.query_row(
        "SELECT path, artist, artist_names, effective_artist_names, album, album_artist, album_key
         FROM songs
         WHERE path = ?1",
        [normalized_path],
        |row| {
            Ok(SongCatalogRow {
                path: row.get::<_, String>(0)?,
                artist: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist_names: deserialize_string_list(row.get::<_, Option<String>>(2)?),
                effective_artist_names: deserialize_string_list(row.get::<_, Option<String>>(3)?),
                album: row.get::<_, Option<String>>(4)?.unwrap_or_default(),
                album_artist: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                album_key: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn load_song_view_row(
    conn: &rusqlite::Connection,
    normalized_path: &str,
) -> Result<Option<SongViewRow>, String> {
    conn.query_row(
        "SELECT path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, added_at, file_modified_at
         FROM songs
         WHERE path = ?1",
        [normalized_path],
        |row| {
            Ok(SongViewRow {
                path: row.get::<_, String>(0)?,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                artist_names: deserialize_string_list(row.get::<_, Option<String>>(3)?),
                effective_artist_names: deserialize_string_list(row.get::<_, Option<String>>(4)?),
                album: row.get::<_, Option<String>>(5)?.unwrap_or_default(),
                album_artist: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                album_key: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                added_at: row.get::<_, Option<i64>>(8)?,
                file_modified_at: row.get::<_, Option<i64>>(9)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn lookup_song_id(conn: &rusqlite::Connection, normalized_path: &str) -> Option<i64> {
    conn.query_row(
        "SELECT id FROM songs WHERE path = ?1",
        [normalized_path],
        |row| row.get(0),
    )
    .ok()
}

fn build_library_match_index(conn: &rusqlite::Connection) -> Result<LibraryMatchIndex, String> {
    let mut stmt = conn
        .prepare("SELECT path, title, artist, album, duration, track_number FROM songs")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                row.get::<_, Option<i64>>(4)?.unwrap_or_default(),
                row.get::<_, Option<String>>(5)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut index = LibraryMatchIndex::default();

    for row in rows.flatten() {
        let identity = resolve_song_identity(
            &row.1,
            &row.2,
            &row.3,
            row.4.max(0) * 1000,
            parse_track_number_value(row.5.as_deref()),
            Some(&row.0),
        );
        let candidate = LibraryMatchCandidate {
            path: row.0,
            identity: identity.clone(),
        };

        index
            .strict
            .entry(strict_identity_key(&identity))
            .or_default()
            .push(candidate.clone());
        index
            .weak_artist
            .entry(weak_artist_identity_key(&identity))
            .or_default()
            .push(candidate.clone());
        index
            .weak_title
            .entry(weak_title_identity_key(&identity))
            .or_default()
            .push(candidate);
    }

    Ok(index)
}

fn select_unique_candidate(
    map: &HashMap<String, Vec<LibraryMatchCandidate>>,
    key: &str,
) -> Option<LibraryMatchCandidate> {
    map.get(key).and_then(|candidates| {
        if candidates.len() == 1 {
            candidates.first().cloned()
        } else {
            None
        }
    })
}

fn match_song_identity(
    index: &LibraryMatchIndex,
    identity: &PortableSongIdentity,
) -> Option<LibraryMatchCandidate> {
    select_unique_candidate(&index.strict, &strict_identity_key(identity))
        .or_else(|| {
            select_unique_candidate(&index.weak_artist, &weak_artist_identity_key(identity))
        })
        .or_else(|| select_unique_candidate(&index.weak_title, &weak_title_identity_key(identity)))
}

fn rebuild_statistics_aggregates(conn: &rusqlite::Connection) -> Result<(), String> {
    clear_aggregate_statistics(conn)?;

    {
        let mut stmt = conn
            .prepare(
                "SELECT s.path, s.title, s.artist, s.album, s.duration, s.track_number, ph.played_at, ph.played_seconds
                 FROM play_history ph
                 INNER JOIN songs s ON ph.song_id = s.id
                 WHERE ph.event = 'play' AND ph.song_id IS NOT NULL
                 ORDER BY ph.played_at ASC, ph.id ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                    row.get::<_, Option<i64>>(4)?.unwrap_or_default(),
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, i64>(6)?,
                    row.get::<_, i64>(7).unwrap_or(0),
                ))
            })
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let identity = resolve_song_identity(
                &row.1,
                &row.2,
                &row.3,
                row.4.max(0) * 1000,
                parse_track_number_value(row.5.as_deref()),
                Some(&row.0),
            );
            let listened_ms = row.7.max(0) * 1000;
            let (is_full_play, is_skip) = derive_play_flags(listened_ms, identity.duration_ms);
            record_aggregate_play(conn, &identity, row.6, listened_ms, is_full_play, is_skip)?;
        }
    }

    set_statistics_meta(conn, "aggregates_backfilled", "1")?;
    Ok(())
}

fn ensure_statistics_aggregates(conn: &rusqlite::Connection) -> Result<(), String> {
    if get_statistics_meta(conn, "aggregates_backfilled")?
        .as_deref()
        .is_some_and(|value| value == "1")
    {
        return Ok(());
    }

    rebuild_statistics_aggregates(conn)
}

fn load_portable_export(file_path: &str) -> Result<PortableStatisticsExport, String> {
    let raw = fs::read_to_string(file_path).map_err(|e| e.to_string())?;
    let export: PortableStatisticsExport =
        serde_json::from_str(&raw).map_err(|_| "文件格式不正确或已损坏".to_string())?;

    if export.format != "lycia-stats" {
        return Err("文件格式不正确或已损坏".to_string());
    }

    if export.version > SUPPORTED_STATS_VERSION {
        return Err("该统计文件版本过新，当前版本暂不支持".to_string());
    }

    Ok(export)
}

fn query_global_stats(conn: &rusqlite::Connection) -> Result<PortableGlobalStats, String> {
    let stats = conn
        .query_row(
            "SELECT total_play_count, total_play_time_ms, first_played_at, last_played_at
         FROM global_stats
         WHERE id = 1",
            [],
            |row| {
                Ok(PortableGlobalStats {
                    total_play_count: row.get::<_, i64>(0)?,
                    total_play_time_ms: row.get::<_, i64>(1)?,
                    first_played_at: row.get::<_, Option<String>>(2)?,
                    last_played_at: row.get::<_, Option<String>>(3)?,
                })
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(PortableGlobalStats {
            total_play_count: 0,
            total_play_time_ms: 0,
            first_played_at: None,
            last_played_at: None,
        });

    Ok(stats)
}

fn query_song_stats(conn: &rusqlite::Connection) -> Result<Vec<PortableSongStatsEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT title, artist, album, duration_ms, track_number,
                    play_count, play_time_ms, full_play_count, skip_count, first_played_at, last_played_at
             FROM song_stats
             ORDER BY play_count DESC, play_time_ms DESC, title COLLATE NOCASE ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PortableSongStatsEntry {
                song_identity: PortableSongIdentity {
                    title: row.get::<_, Option<String>>(0)?.unwrap_or_default(),
                    artist: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                    album: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                    duration_ms: row.get::<_, i64>(3).unwrap_or(0),
                    track_number: row.get::<_, Option<i64>>(4)?,
                },
                song_stats: PortableSongStats {
                    play_count: row.get::<_, i64>(5).unwrap_or(0),
                    play_time_ms: row.get::<_, i64>(6).unwrap_or(0),
                    full_play_count: row.get::<_, i64>(7).unwrap_or(0),
                    skip_count: row.get::<_, i64>(8).unwrap_or(0),
                    first_played_at: row.get::<_, Option<String>>(9)?,
                    last_played_at: row.get::<_, Option<String>>(10)?,
                },
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|row| row.ok()).collect())
}

fn query_daily_stats(conn: &rusqlite::Connection) -> Result<Vec<PortableDailyStats>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT date, play_count, play_time_ms, unique_songs, unique_artists
             FROM daily_stats
             ORDER BY date ASC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(PortableDailyStats {
                date: row.get(0)?,
                play_count: row.get::<_, i64>(1).unwrap_or(0),
                play_time_ms: row.get::<_, i64>(2).unwrap_or(0),
                unique_songs: row.get::<_, i64>(3).unwrap_or(0),
                unique_artists: row.get::<_, i64>(4).unwrap_or(0),
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|row| row.ok()).collect())
}

fn query_hourly_stats(conn: &rusqlite::Connection) -> Result<Vec<PortableHourlyStats>, String> {
    let mut buckets = vec![
        PortableHourlyStats {
            hour: 0,
            play_count: 0,
            play_time_ms: 0,
        };
        24
    ];

    for (index, bucket) in buckets.iter_mut().enumerate() {
        bucket.hour = index as i64;
    }

    let mut stmt = conn
        .prepare("SELECT hour, play_count, play_time_ms FROM hourly_stats")
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0)?,
                row.get::<_, i64>(1).unwrap_or(0),
                row.get::<_, i64>(2).unwrap_or(0),
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows.flatten() {
        if (0..24).contains(&row.0) {
            buckets[row.0 as usize].play_count = row.1;
            buckets[row.0 as usize].play_time_ms = row.2;
        }
    }

    Ok(buckets)
}

fn query_recent_plays(conn: &rusqlite::Connection) -> Result<Vec<PortableRecentPlay>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT played_at, title, artist, album, duration_ms, listened_ms, is_full_play, is_skip
             FROM recent_plays
             ORDER BY played_at DESC, id DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([RECENT_PLAY_LIMIT], |row| {
            Ok(PortableRecentPlay {
                played_at: row.get(0)?,
                title: row.get::<_, Option<String>>(1)?.unwrap_or_default(),
                artist: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                album: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                duration_ms: row.get::<_, i64>(4).unwrap_or(0),
                listened_ms: row.get::<_, i64>(5).unwrap_or(0),
                is_full_play: row.get::<_, i64>(6).unwrap_or(0) > 0,
                is_skip: row.get::<_, i64>(7).unwrap_or(0) > 0,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|row| row.ok()).collect())
}

fn aggregate_behavior_stats(conn: &rusqlite::Connection) -> Result<BehaviorStats, String> {
    ensure_statistics_aggregates(conn)?;

    let global = query_global_stats(conn)?;
    let song_entries = query_song_stats(conn)?;
    let index = build_library_match_index(conn)?;

    let mut top_songs = Vec::new();
    let mut seen_paths = HashSet::new();
    for entry in song_entries
        .iter()
        .filter(|entry| entry.song_stats.play_count > 0)
    {
        let Some(candidate) = match_song_identity(&index, &entry.song_identity) else {
            continue;
        };
        if !seen_paths.insert(candidate.path.clone()) {
            continue;
        }
        top_songs.push(TopSong {
            song_path: candidate.path,
            play_count: entry.song_stats.play_count,
            value: entry.song_stats.play_count,
        });
        if top_songs.len() >= 5 {
            break;
        }
    }

    let mut duration_entries = song_entries.clone();
    duration_entries.sort_by(|left, right| {
        right
            .song_stats
            .play_time_ms
            .cmp(&left.song_stats.play_time_ms)
            .then_with(|| right.song_stats.play_count.cmp(&left.song_stats.play_count))
    });

    let mut top_songs_by_duration = Vec::new();
    let mut seen_duration_paths = HashSet::new();
    for entry in duration_entries
        .iter()
        .filter(|entry| entry.song_stats.play_time_ms > 0)
    {
        let Some(candidate) = match_song_identity(&index, &entry.song_identity) else {
            continue;
        };
        if !seen_duration_paths.insert(candidate.path.clone()) {
            continue;
        }
        top_songs_by_duration.push(TopSong {
            song_path: candidate.path,
            play_count: entry.song_stats.play_count,
            value: entry.song_stats.play_time_ms / 1000,
        });
        if top_songs_by_duration.len() >= 5 {
            break;
        }
    }

    let mut artist_map = HashMap::<String, i64>::new();
    let mut album_map = HashMap::<String, i64>::new();
    for entry in &song_entries {
        if !is_invalid_name(&entry.song_identity.artist) {
            *artist_map
                .entry(entry.song_identity.artist.clone())
                .or_default() += entry.song_stats.play_count;
        }
        if !is_invalid_name(&entry.song_identity.album) {
            *album_map
                .entry(entry.song_identity.album.clone())
                .or_default() += entry.song_stats.play_count;
        }
    }

    let mut top_artists: Vec<TopArtist> = artist_map
        .into_iter()
        .map(|(artist, play_count)| TopArtist { artist, play_count })
        .collect();
    top_artists.sort_by(|a, b| {
        b.play_count
            .cmp(&a.play_count)
            .then_with(|| a.artist.to_lowercase().cmp(&b.artist.to_lowercase()))
    });
    top_artists.truncate(5);

    let mut top_albums: Vec<TopAlbum> = album_map
        .into_iter()
        .map(|(album, play_count)| TopAlbum { album, play_count })
        .collect();
    top_albums.sort_by(|a, b| {
        b.play_count
            .cmp(&a.play_count)
            .then_with(|| a.album.to_lowercase().cmp(&b.album.to_lowercase()))
    });
    top_albums.truncate(5);

    let hourly_rows = query_hourly_stats(conn)?;
    let mut hour_distribution = vec![0; 24];
    for row in hourly_rows {
        if (0..24).contains(&row.hour) {
            hour_distribution[row.hour as usize] = row.play_count;
        }
    }

    let mut recent_activity = vec![0; 7];

    let mut stmt = conn
        .prepare(
            "SELECT CAST(julianday(date) - julianday(date('now', 'localtime')) AS INTEGER) AS day_offset,
                    play_time_ms
             FROM daily_stats
             WHERE date >= date('now', 'localtime', '-6 day')",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, i64>(0).unwrap_or(0),
                row.get::<_, i64>(1).unwrap_or(0),
            ))
        })
        .map_err(|e| e.to_string())?;
    for row in rows.flatten() {
        if (-6..=0).contains(&row.0) {
            recent_activity[(row.0 + 6) as usize] = row.1 / 1000;
        }
    }

    Ok(BehaviorStats {
        total_plays: global.total_play_count,
        total_duration: global.total_play_time_ms / 1000,
        top_songs,
        top_songs_by_duration,
        top_artists,
        top_albums,
        hour_distribution,
        recent_activity,
    })
}

fn insert_history_event(
    conn: &rusqlite::Connection,
    normalized_path: &str,
    played_at: i64,
    played_seconds: i64,
    event: &str,
) -> Result<(), String> {
    let song_id = match lookup_song_id(conn, normalized_path) {
        Some(id) => id,
        None => return Ok(()),
    };

    conn.execute(
        "INSERT INTO play_history (song_path, song_id, played_at, played_seconds, event) VALUES (?1, ?2, ?3, ?4, ?5)",
        rusqlite::params![normalized_path, song_id, played_at, played_seconds, event],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn add_to_history(db: State<DbState>, song_path: String) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let normalized_path = normalize_path(&song_path);
    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    insert_history_event(&conn, &normalized_path, now, 0, "recent")
}

#[tauri::command]
pub fn import_recent_history(
    db: State<DbState>,
    entries: Vec<RecentHistoryImportEntry>,
) -> Result<(), String> {
    if entries.is_empty() {
        return Ok(());
    }

    let mut deduped = std::collections::HashMap::<String, i64>::new();
    for entry in entries {
        let normalized_path = normalize_path(&entry.song_path);
        if normalized_path.is_empty() {
            continue;
        }

        let existing = deduped.entry(normalized_path).or_insert(entry.played_at);
        if entry.played_at > *existing {
            *existing = entry.played_at;
        }
    }

    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    for (song_path, played_at) in deduped {
        insert_history_event(&tx, &song_path, played_at, 0, "recent")?;
    }

    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_recent_history(
    db: State<DbState>,
    limit: Option<usize>,
) -> Result<Vec<RecentHistoryEntry>, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let max_rows = limit.unwrap_or(1000).clamp(1, 5000) as i64;

    let mut stmt = conn
        .prepare(
            "SELECT s.path, MAX(ph.played_at) AS played_at
             FROM play_history ph
             INNER JOIN songs s ON ph.song_id = s.id
             WHERE ph.event = 'recent'
             GROUP BY ph.song_id
             ORDER BY played_at DESC
             LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([max_rows], |row| {
            Ok(RecentHistoryEntry {
                song_path: row.get(0)?,
                played_at: row.get::<_, i64>(1)? * 1000,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(rows.filter_map(|row| row.ok()).collect())
}

#[tauri::command]
pub fn export_statistics_file(
    db: State<DbState>,
    options: StatisticsExportOptions,
) -> Result<StatisticsExportResult, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    ensure_statistics_aggregates(&conn)?;

    let exported_at = now_iso_timestamp()?;
    let export_id = format!("stats-{}-{}", now_unix_seconds(), now_unix_millis());
    let payload = PortableStatisticsExport {
        format: "lycia-stats".to_string(),
        version: SUPPORTED_STATS_VERSION,
        exported_at: exported_at.clone(),
        app_version: env!("CARGO_PKG_VERSION").to_string(),
        export_id: export_id.clone(),
        library_fingerprint: None,
        stats: PortableStatisticsPayload {
            global: query_global_stats(&conn)?,
            songs: query_song_stats(&conn)?,
            daily: query_daily_stats(&conn)?,
            hourly: query_hourly_stats(&conn)?,
            recent_plays: if options.include_recent_plays {
                query_recent_plays(&conn)?
            } else {
                Vec::new()
            },
        },
    };

    let content = serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?;
    fs::write(&options.file_path, content).map_err(|e| e.to_string())?;

    Ok(StatisticsExportResult {
        file_path: options.file_path,
        export_id,
        exported_at,
    })
}

#[tauri::command]
pub fn preview_statistics_import(
    db: State<DbState>,
    options: StatisticsImportPreviewOptions,
) -> Result<StatisticsImportPreview, String> {
    let export = load_portable_export(&options.file_path)?;
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    ensure_statistics_aggregates(&conn)?;
    let match_index = build_library_match_index(&conn)?;

    let matched_song_count = export
        .stats
        .songs
        .iter()
        .filter(|entry| match_song_identity(&match_index, &entry.song_identity).is_some())
        .count();
    let duplicate_import_detected = conn
        .query_row(
            "SELECT 1 FROM imported_exports_log WHERE export_id = ?1",
            [&export.export_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();

    Ok(StatisticsImportPreview {
        version: export.version,
        exported_at: export.exported_at,
        app_version: export.app_version,
        export_id: export.export_id,
        song_stats_count: export.stats.songs.len(),
        daily_stats_count: export.stats.daily.len(),
        recent_plays_count: export.stats.recent_plays.len(),
        matched_song_count,
        unmatched_song_count: export.stats.songs.len().saturating_sub(matched_song_count),
        duplicate_import_detected,
    })
}

#[tauri::command]
pub fn import_statistics_file(
    db: State<DbState>,
    options: StatisticsImportOptions,
) -> Result<StatisticsImportResult, String> {
    let export = load_portable_export(&options.file_path)?;
    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    ensure_statistics_aggregates(&conn)?;

    let already_imported = conn
        .query_row(
            "SELECT 1 FROM imported_exports_log WHERE export_id = ?1",
            [&export.export_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();

    if already_imported && !options.continue_duplicate_import {
        return Err("该统计备份似乎已经导入过".to_string());
    }

    let match_index = build_library_match_index(&conn)?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    if matches!(options.mode, StatisticsImportMode::Overwrite) {
        clear_aggregate_statistics(&tx)?;
        tx.execute("DELETE FROM imported_exports_log", [])
            .map_err(|e| e.to_string())?;
    }

    set_statistics_meta(&tx, "aggregates_backfilled", "1")?;
    merge_global_stats(&tx, &export.stats.global)?;

    let mut matched_song_count = 0usize;
    let mut unmatched_song_count = 0usize;
    let mut merged_song_count = 0usize;

    for entry in &export.stats.songs {
        let target_identity = match match_song_identity(&match_index, &entry.song_identity) {
            Some(candidate) => {
                matched_song_count += 1;
                candidate.identity
            }
            None => {
                unmatched_song_count += 1;
                entry.song_identity.clone()
            }
        };

        upsert_song_stats(&tx, &target_identity, &entry.song_stats)?;
        merged_song_count += 1;
    }

    for daily in &export.stats.daily {
        upsert_daily_stats(&tx, daily)?;
    }

    for hourly in &export.stats.hourly {
        upsert_hourly_stats(&tx, hourly)?;
    }

    let mut imported_recent_plays_count = 0usize;
    for entry in &export.stats.recent_plays {
        if insert_recent_play(&tx, entry)? {
            imported_recent_plays_count += 1;
        }
    }

    tx.execute(
        "INSERT OR REPLACE INTO imported_exports_log (export_id, imported_at) VALUES (?1, ?2)",
        rusqlite::params![export.export_id, now_iso_timestamp()?],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;

    Ok(StatisticsImportResult {
        mode: match options.mode {
            StatisticsImportMode::Overwrite => "overwrite".to_string(),
            StatisticsImportMode::Merge => "merge".to_string(),
        },
        matched_song_count,
        unmatched_song_count,
        merged_song_count,
        imported_recent_plays_count,
        duplicate_import_skipped: already_imported,
    })
}

#[tauri::command]
pub fn get_favorite_artist_catalog(
    db: State<DbState>,
    favorite_paths: Vec<String>,
) -> Result<Vec<crate::music::types::ArtistCatalogItem>, String> {
    if favorite_paths.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut map = HashMap::<String, (u32, String)>::new();

    for path in favorite_paths {
        let normalized_path = normalize_path(&path);
        if normalized_path.is_empty() {
            continue;
        }

        let Some(row) = load_song_catalog_row(&conn, &normalized_path)? else {
            continue;
        };

        for artist_name in preferred_artist_names(&row) {
            let key = if artist_name.trim().is_empty() {
                "Unknown".to_string()
            } else {
                artist_name
            };
            let entry = map.entry(key).or_insert((0, row.path.clone()));
            entry.0 = entry.0.saturating_add(1);
        }
    }

    let mut result: Vec<crate::music::types::ArtistCatalogItem> = map
        .into_iter()
        .map(
            |(name, (count, first_song_path))| crate::music::types::ArtistCatalogItem {
                name,
                count,
                first_song_path,
            },
        )
        .collect();

    result.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
pub fn get_favorite_album_catalog(
    db: State<DbState>,
    favorite_paths: Vec<String>,
) -> Result<Vec<crate::music::types::AlbumCatalogItem>, String> {
    if favorite_paths.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut map = HashMap::<String, crate::music::types::AlbumCatalogItem>::new();

    for path in favorite_paths {
        let normalized_path = normalize_path(&path);
        if normalized_path.is_empty() {
            continue;
        }

        let Some(row) = load_song_catalog_row(&conn, &normalized_path)? else {
            continue;
        };

        let key = resolve_album_key(&row);
        let existing = map
            .entry(key.clone())
            .or_insert(crate::music::types::AlbumCatalogItem {
                key,
                name: if row.album.trim().is_empty() {
                    "Unknown".to_string()
                } else {
                    row.album.clone()
                },
                count: 0,
                artist: if row.album_artist.trim().is_empty() {
                    if row.artist.trim().is_empty() {
                        "Unknown".to_string()
                    } else {
                        row.artist.clone()
                    }
                } else {
                    row.album_artist.clone()
                },
                first_song_path: row.path.clone(),
            });

        existing.count = existing.count.saturating_add(1);
    }

    let mut result: Vec<crate::music::types::AlbumCatalogItem> = map.into_values().collect();
    result.sort_by(|a, b| {
        b.count
            .cmp(&a.count)
            .then_with(|| a.artist.to_lowercase().cmp(&b.artist.to_lowercase()))
    });

    Ok(result)
}

#[tauri::command]
pub fn get_recent_album_catalog(
    db: State<DbState>,
    recent_entries: Vec<RecentHistoryImportEntry>,
) -> Result<Vec<RecentAlbumCatalogItem>, String> {
    if recent_entries.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let mut map = HashMap::<String, RecentAlbumCatalogItem>::new();

    for entry in recent_entries {
        let normalized_path = normalize_path(&entry.song_path);
        if normalized_path.is_empty() {
            continue;
        }

        let Some(row) = load_song_catalog_row(&conn, &normalized_path)? else {
            continue;
        };

        let key = resolve_album_key(&row);
        let played_at = entry.played_at;

        match map.get_mut(&key) {
            Some(existing) if played_at > existing.played_at => {
                existing.played_at = played_at;
                existing.first_song_path = row.path.clone();
            }
            Some(_) => {}
            None => {
                map.insert(
                    key.clone(),
                    RecentAlbumCatalogItem {
                        key,
                        name: if row.album.trim().is_empty() {
                            "Unknown".to_string()
                        } else {
                            row.album.clone()
                        },
                        artist: if row.album_artist.trim().is_empty() {
                            if row.artist.trim().is_empty() {
                                "Unknown".to_string()
                            } else {
                                row.artist.clone()
                            }
                        } else {
                            row.album_artist.clone()
                        },
                        played_at,
                        first_song_path: row.path.clone(),
                    },
                );
            }
        }
    }

    let mut result: Vec<RecentAlbumCatalogItem> = map.into_values().collect();
    result.sort_by(|a, b| b.played_at.cmp(&a.played_at));
    Ok(result)
}

#[tauri::command]
pub fn get_favorite_song_paths_view(
    db: State<DbState>,
    favorite_paths: Vec<String>,
    query: Option<String>,
    sort_mode: SongPathSortMode,
    detail_filter_type: Option<String>,
    detail_filter_value: Option<String>,
) -> Result<Vec<String>, String> {
    if favorite_paths.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let lowered_query = query.map(|value| value.trim().to_lowercase());
    let normalized_filter_type = detail_filter_type
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty());
    let normalized_filter_value = detail_filter_value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let mut rows: Vec<SongViewRow> = Vec::new();

    for path in favorite_paths {
        let normalized_path = normalize_path(&path);
        if normalized_path.is_empty() {
            continue;
        }

        let Some(row) = load_song_view_row(&conn, &normalized_path)? else {
            continue;
        };

        let matches_detail_filter = match (
            normalized_filter_type.as_deref(),
            normalized_filter_value.as_deref(),
        ) {
            (Some("artist"), Some(filter_value)) => song_has_artist(&row, filter_value),
            (Some("album"), Some(filter_value)) => resolve_view_album_key(&row) == filter_value,
            _ => true,
        };

        if !matches_detail_filter {
            continue;
        }

        let matches_search = lowered_query
            .as_deref()
            .map(|value| song_matches_query(&row, value))
            .unwrap_or(true);

        if matches_search {
            rows.push(row);
        }
    }

    sort_song_view_rows(&mut rows, &sort_mode);
    Ok(rows.into_iter().map(|row| row.path).collect())
}

#[tauri::command]
pub fn get_recent_song_paths_view(
    db: State<DbState>,
    recent_entries: Vec<RecentHistoryImportEntry>,
    query: Option<String>,
    sort_mode: SongPathSortMode,
) -> Result<Vec<String>, String> {
    if recent_entries.is_empty() {
        return Ok(Vec::new());
    }

    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    let lowered_query = query.map(|value| value.trim().to_lowercase());
    let mut latest_entries = HashMap::<String, i64>::new();

    for entry in recent_entries {
        let normalized_path = normalize_path(&entry.song_path);
        if normalized_path.is_empty() {
            continue;
        }

        let existing = latest_entries
            .entry(normalized_path)
            .or_insert(entry.played_at);
        if entry.played_at > *existing {
            *existing = entry.played_at;
        }
    }

    let mut rows: Vec<SongViewRow> = Vec::new();
    for normalized_path in latest_entries.into_keys() {
        let Some(row) = load_song_view_row(&conn, &normalized_path)? else {
            continue;
        };

        let matches_search = lowered_query
            .as_deref()
            .map(|value| song_matches_query(&row, value))
            .unwrap_or(true);

        if matches_search {
            rows.push(row);
        }
    }

    sort_song_view_rows(&mut rows, &sort_mode);
    Ok(rows.into_iter().map(|row| row.path).collect())
}

#[tauri::command]
pub fn get_recent_playlist_catalog(
    playlists: Vec<PlaylistImportItem>,
    recent_entries: Vec<RecentHistoryImportEntry>,
) -> Result<Vec<RecentPlaylistCatalogItem>, String> {
    if playlists.is_empty() || recent_entries.is_empty() {
        return Ok(Vec::new());
    }

    let mut latest_played_at_by_path = HashMap::<String, i64>::new();
    for entry in recent_entries {
        let normalized_path = normalize_path(&entry.song_path);
        if normalized_path.is_empty() {
            continue;
        }

        let existing = latest_played_at_by_path
            .entry(normalized_path)
            .or_insert(entry.played_at);
        if entry.played_at > *existing {
            *existing = entry.played_at;
        }
    }

    let mut result = Vec::new();

    for playlist in playlists {
        let mut last_played_time = 0;

        for path in &playlist.song_paths {
            let normalized_path = normalize_path(path);
            if let Some(played_at) = latest_played_at_by_path.get(&normalized_path) {
                if *played_at > last_played_time {
                    last_played_time = *played_at;
                }
            }
        }

        if last_played_time <= 0 {
            continue;
        }

        result.push(RecentPlaylistCatalogItem {
            id: playlist.id,
            name: playlist.name,
            count: playlist.song_paths.len().min(u32::MAX as usize) as u32,
            played_at: last_played_time,
            first_song_path: playlist.song_paths.first().cloned().unwrap_or_default(),
        });
    }

    result.sort_by(|a, b| b.played_at.cmp(&a.played_at));
    Ok(result)
}

#[tauri::command]
pub fn remove_from_recent_history(
    db: State<DbState>,
    song_paths: Vec<String>,
) -> Result<(), String> {
    if song_paths.is_empty() {
        return Ok(());
    }

    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut stmt = tx
        .prepare("DELETE FROM play_history WHERE event = 'recent' AND song_path = ?1")
        .map_err(|e| e.to_string())?;

    for song_path in song_paths {
        let normalized_path = normalize_path(&song_path);
        if normalized_path.is_empty() {
            continue;
        }
        stmt.execute([normalized_path]).map_err(|e| e.to_string())?;
    }

    drop(stmt);
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn remove_songs_from_history_and_statistics(
    db: State<DbState>,
    song_paths: Vec<String>,
) -> Result<(), String> {
    if song_paths.is_empty() {
        return Ok(());
    }

    let mut conn = db.conn.lock().map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut stmt = tx
            .prepare("DELETE FROM play_history WHERE song_path = ?1")
            .map_err(|e| e.to_string())?;

        for song_path in song_paths {
            let normalized_path = normalize_path(&song_path);
            if normalized_path.is_empty() {
                continue;
            }
            stmt.execute([normalized_path]).map_err(|e| e.to_string())?;
        }
    }

    rebuild_statistics_aggregates(&tx)?;
    tx.commit().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn clear_recent_history(db: State<DbState>) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM play_history WHERE event = 'recent'", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// 记录一次播放事件（通过 song_path 查找 song_id）
#[tauri::command]
pub fn record_play(db: State<DbState>, payload: RecordPlayPayload) -> Result<(), String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    // 规范化路径，确保与数据库中的路径格式一致
    let normalized_path = normalize_path(&payload.song_path);

    // 通过 path 查找 song_id
    let song_id: Option<i64> = conn
        .query_row(
            "SELECT id FROM songs WHERE path = ?1",
            [&normalized_path],
            |row| row.get(0),
        )
        .ok();

    // 如果找不到歌曲，静默返回（歌曲可能已删除）
    let song_id = match song_id {
        Some(id) => id,
        None => return Ok(()),
    };

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let played_seconds = (payload.listened_ms.max(0) / 1000).max(0);
    conn.execute(
        "INSERT INTO play_history (song_path, song_id, played_at, played_seconds, event) VALUES (?1, ?2, ?3, ?4, 'play')",
        rusqlite::params![&normalized_path, song_id, now, played_seconds],
    )
    .map_err(|e| e.to_string())?;

    let identity = resolve_song_identity(
        &payload.title,
        &payload.artist,
        &payload.album,
        payload.duration_ms,
        parse_track_number_value(payload.track_number.as_deref()),
        Some(&payload.song_path),
    );
    let (is_full_play, is_skip) = derive_play_flags(payload.listened_ms, payload.duration_ms);
    record_aggregate_play(
        &conn,
        &identity,
        now,
        payload.listened_ms,
        is_full_play,
        is_skip,
    )?;

    Ok(())
}

/// 行为统计结果
#[derive(Serialize)]
pub struct BehaviorStats {
    pub total_plays: i64,
    pub total_duration: i64,
    pub top_songs: Vec<TopSong>,
    pub top_songs_by_duration: Vec<TopSong>,
    pub top_artists: Vec<TopArtist>,
    pub top_albums: Vec<TopAlbum>,
    pub hour_distribution: Vec<i64>,
    pub recent_activity: Vec<i64>,
}

#[derive(Serialize)]
pub struct TopSong {
    pub song_path: String,
    pub play_count: i64,
    pub value: i64,
}

#[derive(Serialize)]
pub struct TopArtist {
    pub artist: String,
    pub play_count: i64,
}

#[derive(Serialize)]
pub struct TopAlbum {
    pub album: String,
    pub play_count: i64,
}

/// 获取行为统计（全库，JOIN songs 表过滤有效歌曲）
#[tauri::command]
pub fn get_behavior_stats(
    db: State<DbState>,
    time_range: TimeRange,
) -> Result<BehaviorStats, String> {
    let conn = db.conn.lock().map_err(|e| e.to_string())?;

    if matches!(time_range, TimeRange::All) {
        return aggregate_behavior_stats(&conn);
    }

    // 构建时间条件
    let time_condition = match time_range.to_timestamp_from() {
        Some(from) => format!("AND ph.played_at >= {}", from),
        None => String::new(),
    };

    // 只统计 song_id 非空且在 songs 表中存在的记录
    let base_join = "FROM play_history ph INNER JOIN songs s ON ph.song_id = s.id";

    // 指标 A1: 播放次数
    let sql_plays = format!(
        "SELECT COUNT(*) {} WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {}",
        base_join, time_condition
    );
    let total_plays: i64 = conn
        .query_row(&sql_plays, [], |row| row.get(0))
        .unwrap_or(0);

    // 指标 A2: 播放总时长
    let sql_duration = format!(
        "SELECT COALESCE(SUM(ph.played_seconds), 0) {} WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {}",
        base_join, time_condition
    );
    let total_duration: i64 = conn
        .query_row(&sql_duration, [], |row| row.get(0))
        .unwrap_or(0);

    // 指标 B1: Top 5 歌曲 (按次数)
    let sql_top_plays = format!(
        "SELECT s.path, COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
         GROUP BY ph.song_id 
         ORDER BY cnt DESC 
         LIMIT 5",
        base_join, time_condition
    );
    let mut top_songs: Vec<TopSong> = Vec::new();
    {
        let mut stmt = conn.prepare(&sql_top_plays).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let count: i64 = row.get(1)?;
                Ok(TopSong {
                    song_path: row.get(0)?,
                    play_count: count,
                    value: count,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            top_songs.push(row);
        }
    }

    // 指标 B2: Top 5 歌曲 (按时长)
    let sql_top_duration = format!(
        "SELECT s.path, COALESCE(SUM(ph.played_seconds), 0) as duration 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
         GROUP BY ph.song_id 
         ORDER BY duration DESC 
         LIMIT 5",
        base_join, time_condition
    );
    let mut top_songs_by_duration: Vec<TopSong> = Vec::new();
    {
        let mut stmt = conn.prepare(&sql_top_duration).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                let duration: i64 = row.get(1)?;
                Ok(TopSong {
                    song_path: row.get(0)?,
                    play_count: 0,
                    value: duration,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            top_songs_by_duration.push(row);
        }
    }

    // 指标 C: 小时分布
    let sql_hours = format!(
        "SELECT CAST(strftime('%H', ph.played_at, 'unixepoch', 'localtime') AS INTEGER) as hour, 
                COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
         GROUP BY hour",
        base_join, time_condition
    );
    let mut hour_distribution: Vec<i64> = vec![0; 24];
    {
        let mut stmt = conn.prepare(&sql_hours).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            if row.0 >= 0 && row.0 < 24 {
                hour_distribution[row.0 as usize] = row.1;
            }
        }
    }

    // 指标 D1: Top 5 歌手
    let sql_top_artists = format!(
        "SELECT TRIM(s.artist) as artist, COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
           AND s.artist IS NOT NULL 
           AND TRIM(s.artist) != '' 
           AND LOWER(TRIM(s.artist)) NOT IN ('未知', '未知歌手', 'unknown', 'unknown artist') 
         GROUP BY TRIM(s.artist) 
         ORDER BY cnt DESC 
         LIMIT 5",
        base_join, time_condition
    );
    let mut top_artists: Vec<TopArtist> = Vec::new();
    {
        let mut stmt = conn.prepare(&sql_top_artists).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TopArtist {
                    artist: row.get(0)?,
                    play_count: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            top_artists.push(row);
        }
    }

    // 指标 D2: Top 5 专辑
    let sql_top_albums = format!(
        "SELECT TRIM(s.album) as album, COUNT(*) as cnt 
         {} 
         WHERE ph.event = 'play' AND ph.song_id IS NOT NULL {} 
           AND s.album IS NOT NULL 
           AND TRIM(s.album) != '' 
           AND LOWER(TRIM(s.album)) NOT IN ('未知', '未知专辑', 'unknown', 'unknown album') 
         GROUP BY TRIM(s.album) 
         ORDER BY cnt DESC 
         LIMIT 5",
        base_join, time_condition
    );
    let mut top_albums: Vec<TopAlbum> = Vec::new();
    {
        let mut stmt = conn.prepare(&sql_top_albums).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok(TopAlbum {
                    album: row.get(0)?,
                    play_count: row.get(1)?,
                })
            })
            .map_err(|e| e.to_string())?;
        for row in rows.flatten() {
            top_albums.push(row);
        }
    }

    // 指标 E: 最近 7 天播放趋势 (Timeline)
    // 即使 time_range 不是 7Days，我们也始终返回最近 7 天的趋势供 UI 显示
    let mut recent_activity: Vec<i64> = vec![0; 7];
    {
        // 算出 7 天前的零点时间戳 (简化处理，按 24h 倒推)
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as i64;
        let day_seconds = 24 * 60 * 60;
        let start_time = now - 7 * day_seconds;

        // 查询最近 7 天的每一天的播放时长
        // Output: day_offset (0-6), total_duration
        let sql_activity = format!(
            "SELECT CAST((ph.played_at - {}) / {} AS INTEGER) as day_offset, 
                    COALESCE(SUM(ph.played_seconds), 0) as duration 
             FROM play_history ph 
             INNER JOIN songs s ON ph.song_id = s.id 
             WHERE ph.played_at >= {} AND ph.event = 'play' AND ph.song_id IS NOT NULL 
             GROUP BY day_offset",
            start_time, day_seconds, start_time
        );

        let mut stmt = conn.prepare(&sql_activity).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map([], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, i64>(1)?)))
            .map_err(|e| e.to_string())?;

        for row in rows.flatten() {
            let offset = row.0;
            if offset >= 0 && offset < 7 {
                recent_activity[offset as usize] = row.1;
            }
        }
    }

    Ok(BehaviorStats {
        total_plays,
        total_duration,
        top_songs,
        top_songs_by_duration,
        top_artists,
        top_albums,
        hour_distribution,
        recent_activity,
    })
}
