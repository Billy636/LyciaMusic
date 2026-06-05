use super::cache;
use super::repository::{replace_remote_files, update_song_cache_path, update_sync_status};
use super::types::{
    RemoteFileEntry, RemoteSourceCredentials, RemoteSyncProgress, RemoteSyncResult,
};
use super::webdav;
use crate::music::scanner::{apply_scan_changes, parse_song_from_file};
use crate::music::types::Song;
use rusqlite::params;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};

const REMOTE_SYNC_PROGRESS_EVENT: &str = "remote-sync-progress";

#[derive(Clone)]
struct RemoteSongSnapshot {
    etag: Option<String>,
    size: u64,
    modified_at: Option<String>,
    song: Option<Song>,
}

fn extension_from_path(path: &str) -> String {
    path.rsplit('.')
        .next()
        .map(|value| value.to_ascii_lowercase())
        .unwrap_or_default()
}

fn title_from_name(name: &str) -> String {
    name.rsplit_once('.')
        .map(|(stem, _)| stem.to_string())
        .unwrap_or_else(|| name.to_string())
}

fn album_from_remote_path(path: &str) -> String {
    let mut segments = path
        .trim_matches('/')
        .split('/')
        .filter(|segment| !segment.trim().is_empty())
        .collect::<Vec<_>>();
    if segments.len() >= 2 {
        segments.pop();
        segments
            .pop()
            .map(|segment| segment.to_string())
            .unwrap_or_else(|| "未知专辑".to_string())
    } else {
        "未知专辑".to_string()
    }
}

fn is_unknown_text(value: &str, unknown: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty() || trimmed == unknown
}

fn split_filename_title_artist(name: &str) -> Option<(String, String)> {
    let stem = title_from_name(name);
    let separators = [" - ", "-", " – ", "–", " — ", "—"];
    for separator in separators {
        let Some((left, right)) = stem.rsplit_once(separator) else {
            continue;
        };
        let title = left.trim();
        let artist = right.trim();
        if !title.is_empty() && !artist.is_empty() {
            return Some((title.to_string(), artist.to_string()));
        }
    }
    None
}

fn refresh_artist_fields(song: &mut Song, artist: String) {
    song.artist = artist.clone();
    song.artist_names = vec![artist.clone()];
    song.effective_artist_names = vec![artist.clone()];
    song.album_artist = artist;
    song.album_key = format!(
        "{}::{}",
        song.album.to_lowercase(),
        song.album_artist.to_lowercase()
    );
}

fn apply_filename_metadata_fallback(song: &mut Song, file: &RemoteFileEntry) {
    let needs_artist = is_unknown_text(&song.artist, "未知歌手");
    let needs_title = song.title.trim().is_empty() || song.title == title_from_name(&file.name);

    if !(needs_artist || needs_title) {
        return;
    }

    let Some((title, artist)) = split_filename_title_artist(&file.name) else {
        return;
    };

    if needs_title {
        song.title = title;
    }
    if needs_artist {
        refresh_artist_fields(song, artist);
    }
}

fn song_from_remote_file(source: &RemoteSourceCredentials, file: &RemoteFileEntry) -> Song {
    let remote_uri = file.remote_uri(&source.id);
    let title = title_from_name(&file.name);
    let artist = "未知歌手".to_string();
    let album = album_from_remote_path(&file.remote_path);

    let mut song = Song {
        id: None,
        name: file.name.clone(),
        title,
        path: remote_uri,
        artist: artist.clone(),
        artist_names: vec![artist.clone()],
        effective_artist_names: vec![artist.clone()],
        album: album.clone(),
        album_artist: artist.clone(),
        album_key: format!("{}::{}", album.to_lowercase(), artist.to_lowercase()),
        is_various_artists_album: false,
        collapse_artist_credits: false,
        duration: 0,
        cover_thumb_path: None,
        bitrate: 0,
        sample_rate: 0,
        bit_depth: None,
        format: extension_from_path(&file.remote_path),
        container: None,
        codec: None,
        file_size: file.size,
        track_number: None,
        disc_number: None,
        added_at: None,
        file_modified_at: None,
        cue_source_path: None,
        cue_start_offset: None,
        cue_end_offset: None,
        comment: None,
    };
    apply_filename_metadata_fallback(&mut song, file);
    song
}

fn song_for_remote_index(source: &RemoteSourceCredentials, file: &RemoteFileEntry) -> Song {
    song_from_remote_file(source, file)
}

pub(crate) fn song_from_cached_remote_file(
    source: &RemoteSourceCredentials,
    file: &RemoteFileEntry,
    cache_path: &Path,
) -> Option<Song> {
    let remote_uri = file.remote_uri(&source.id);
    let format = extension_from_path(&file.remote_path);
    let mut parsed = parse_song_from_file(cache_path, &remote_uri, &format)?;
    let fallback = song_from_remote_file(source, file);

    parsed.name = file.name.clone();
    parsed.format = if parsed.format.trim().is_empty() {
        fallback.format
    } else {
        parsed.format
    };
    parsed.file_size = if file.size > 0 {
        file.size
    } else {
        parsed.file_size
    };
    parsed.added_at = None;
    parsed.file_modified_at = None;

    let cache_stem = cache_path
        .file_stem()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_default();
    if parsed.title.trim().is_empty() || (!cache_stem.is_empty() && parsed.title == cache_stem) {
        parsed.title = fallback.title;
    }
    if is_unknown_text(&parsed.artist, "未知歌手") {
        parsed.artist = fallback.artist;
    }
    if parsed.artist_names.is_empty() {
        parsed.artist_names = fallback.artist_names;
    }
    if parsed.effective_artist_names.is_empty() {
        parsed.effective_artist_names = parsed.artist_names.clone();
    }
    if is_unknown_text(&parsed.album, "未知专辑") {
        parsed.album = fallback.album;
    }
    if parsed.album_artist.trim().is_empty() {
        parsed.album_artist = parsed.artist.clone();
    }
    if parsed.album_key.trim().is_empty() {
        parsed.album_key = format!(
            "{}::{}",
            parsed.album.to_lowercase(),
            parsed.album_artist.to_lowercase()
        );
    }
    apply_filename_metadata_fallback(&mut parsed, file);

    Some(parsed)
}

async fn cache_and_parse_remote_song(
    app: &AppHandle,
    source: &RemoteSourceCredentials,
    file: &RemoteFileEntry,
) -> (Song, Option<String>) {
    let remote_uri = file.remote_uri(&source.id);
    let cache_path = cache::cache_remote_file(
        app,
        source,
        &file.remote_path,
        &remote_uri,
        file.etag.as_deref(),
    )
    .await;

    match cache_path {
        Ok(cache_path) => {
            let parsed = song_from_cached_remote_file(source, file, Path::new(&cache_path))
                .unwrap_or_else(|| song_for_remote_index(source, file));
            (parsed, Some(cache_path))
        }
        Err(_) => (song_for_remote_index(source, file), None),
    }
}

fn deserialize_string_list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

fn i64_to_u64_opt(value: Option<i64>) -> Option<u64> {
    value.filter(|value| *value >= 0).map(|value| value as u64)
}

fn i64_to_u32(value: Option<i64>) -> u32 {
    value.unwrap_or(0).clamp(0, u32::MAX as i64) as u32
}

fn i64_to_u8_opt(value: Option<i64>) -> Option<u8> {
    value
        .filter(|value| *value >= 0 && *value <= u8::MAX as i64)
        .map(|value| value as u8)
}

fn i64_to_bool(value: Option<i64>) -> bool {
    value.unwrap_or(0) != 0
}

fn remote_file_needs_refresh(
    snapshot: Option<&RemoteSongSnapshot>,
    file: &RemoteFileEntry,
) -> bool {
    let Some(snapshot) = snapshot else {
        return true;
    };
    if snapshot.song.is_none() {
        return true;
    }
    if snapshot
        .song
        .as_ref()
        .map(|song| song.duration == 0 || song.bitrate == 0 || song.sample_rate == 0)
        .unwrap_or(true)
    {
        return true;
    }

    match (snapshot.etag.as_deref(), file.etag.as_deref()) {
        (Some(previous), Some(current)) if !previous.is_empty() && !current.is_empty() => {
            previous != current
        }
        _ => {
            snapshot.size != file.size
                || match (snapshot.modified_at.as_deref(), file.modified_at.as_deref()) {
                    (Some(previous), Some(current)) => previous != current,
                    _ => false,
                }
        }
    }
}

fn load_remote_song_snapshots(
    conn: &rusqlite::Connection,
    source_id: &str,
) -> Result<HashMap<String, RemoteSongSnapshot>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT
                rf.remote_uri,
                rf.etag,
                rf.size,
                rf.modified_at,
                s.id,
                s.path,
                s.title,
                s.artist,
                s.artist_names,
                s.effective_artist_names,
                s.album,
                s.album_artist,
                s.album_key,
                s.is_various_artists_album,
                s.collapse_artist_credits,
                s.duration,
                s.cover_thumb_path,
                s.bitrate,
                s.sample_rate,
                s.bit_depth,
                s.format,
                s.container,
                s.codec,
                s.file_size,
                s.track_number,
                s.disc_number,
                s.added_at,
                s.file_modified_at,
                s.comment
             FROM remote_files rf
             LEFT JOIN songs s ON s.path = rf.remote_uri
             WHERE rf.source_id = ?1 AND rf.is_audio = 1",
        )
        .map_err(|error| error.to_string())?;

    let rows = stmt
        .query_map([source_id], |row| {
            let remote_uri: String = row.get(0)?;
            let song_path: Option<String> = row.get(5)?;
            let song = match song_path {
                Some(path) => {
                    let artist_names = deserialize_string_list(row.get::<_, Option<String>>(8)?);
                    let effective_artist_names =
                        deserialize_string_list(row.get::<_, Option<String>>(9)?);
                    let name = Path::new(&path)
                        .file_name()
                        .map(|name| name.to_string_lossy().into_owned())
                        .unwrap_or_else(|| path.clone());

                    Some(Song {
                        id: row.get::<_, Option<i64>>(4)?,
                        name,
                        path,
                        title: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                        artist: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                        artist_names,
                        effective_artist_names,
                        album: row.get::<_, Option<String>>(10)?.unwrap_or_default(),
                        album_artist: row.get::<_, Option<String>>(11)?.unwrap_or_default(),
                        album_key: row.get::<_, Option<String>>(12)?.unwrap_or_default(),
                        is_various_artists_album: i64_to_bool(row.get::<_, Option<i64>>(13)?),
                        collapse_artist_credits: i64_to_bool(row.get::<_, Option<i64>>(14)?),
                        duration: i64_to_u32(row.get::<_, Option<i64>>(15)?),
                        cover_thumb_path: row.get::<_, Option<String>>(16)?,
                        bitrate: i64_to_u32(row.get::<_, Option<i64>>(17)?),
                        sample_rate: i64_to_u32(row.get::<_, Option<i64>>(18)?),
                        bit_depth: i64_to_u8_opt(row.get::<_, Option<i64>>(19)?),
                        format: row.get::<_, Option<String>>(20)?.unwrap_or_default(),
                        container: row.get::<_, Option<String>>(21)?,
                        codec: row.get::<_, Option<String>>(22)?,
                        file_size: row.get::<_, Option<i64>>(23)?.unwrap_or(0).max(0) as u64,
                        track_number: row.get::<_, Option<String>>(24)?,
                        disc_number: row.get::<_, Option<String>>(25)?,
                        added_at: i64_to_u64_opt(row.get::<_, Option<i64>>(26)?),
                        file_modified_at: i64_to_u64_opt(row.get::<_, Option<i64>>(27)?),
                        cue_source_path: None,
                        cue_start_offset: None,
                        cue_end_offset: None,
                        comment: row.get::<_, Option<String>>(28)?,
                    })
                }
                None => None,
            };

            Ok((
                remote_uri,
                RemoteSongSnapshot {
                    etag: row.get::<_, Option<String>>(1)?,
                    size: row.get::<_, i64>(2)?.max(0) as u64,
                    modified_at: row.get::<_, Option<String>>(3)?,
                    song,
                },
            ))
        })
        .map_err(|error| error.to_string())?;

    let mut snapshots = HashMap::new();
    for row in rows {
        let (remote_uri, snapshot) = row.map_err(|error| error.to_string())?;
        snapshots.insert(remote_uri, snapshot);
    }
    Ok(snapshots)
}

fn emit_sync_progress(
    app: &AppHandle,
    source_id: &str,
    phase: &str,
    current: usize,
    total: usize,
    message: impl Into<String>,
    done: bool,
    failed: bool,
) {
    let _ = app.emit(
        REMOTE_SYNC_PROGRESS_EVENT,
        RemoteSyncProgress {
            source_id: source_id.to_string(),
            phase: phase.to_string(),
            current,
            total,
            message: message.into(),
            done,
            failed,
        },
    );
}

fn existing_remote_song_paths(
    conn: &rusqlite::Connection,
    source_id: &str,
) -> Result<Vec<String>, String> {
    let mut stmt = conn
        .prepare("SELECT path FROM songs WHERE remote_source_id = ?1")
        .map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map([source_id], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn mark_remote_songs(
    conn: &rusqlite::Connection,
    source: &RemoteSourceCredentials,
    files: &[RemoteFileEntry],
) -> Result<(), String> {
    let mut stmt = conn
        .prepare(
            "UPDATE songs
             SET source_type = 'remote',
                 remote_source_id = ?1,
                 remote_uri = ?2,
                 remote_etag = ?3
             WHERE path = ?2",
        )
        .map_err(|error| error.to_string())?;

    for file in files {
        let remote_uri = file.remote_uri(&source.id);
        stmt.execute(params![&source.id, remote_uri, &file.etag])
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

pub(crate) async fn sync_source(
    app: AppHandle,
    db_conn: Arc<Mutex<rusqlite::Connection>>,
    source: RemoteSourceCredentials,
) -> Result<RemoteSyncResult, String> {
    emit_sync_progress(
        &app,
        &source.id,
        "scanning",
        0,
        0,
        "正在读取远程目录",
        false,
        false,
    );
    let files = match webdav::collect_audio_files(&source).await {
        Ok(files) => files,
        Err(error) => {
            if let Ok(conn) = db_conn.lock() {
                let _ = update_sync_status(&conn, &source.id, Some(&error));
            }
            emit_sync_progress(&app, &source.id, "error", 0, 0, error.clone(), true, true);
            return Err(error);
        }
    };
    let snapshots = {
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        match load_remote_song_snapshots(&conn, &source.id) {
            Ok(snapshots) => snapshots,
            Err(error) => {
                let _ = update_sync_status(&conn, &source.id, Some(&error));
                emit_sync_progress(&app, &source.id, "error", 0, 0, error.clone(), true, true);
                return Err(error);
            }
        }
    };

    let mut songs = Vec::with_capacity(files.len());
    let mut cache_updates = Vec::new();
    let total = files.len();
    for (index, file) in files.iter().enumerate() {
        let current = index + 1;
        emit_sync_progress(
            &app,
            &source.id,
            "parsing",
            current,
            total,
            format!("正在解析 {}", file.name),
            false,
            false,
        );
        let remote_uri = file.remote_uri(&source.id);
        if let Some(snapshot) = snapshots.get(&remote_uri) {
            if !remote_file_needs_refresh(Some(snapshot), file) {
                if let Some(song) = snapshot.song.clone() {
                    songs.push(song);
                    continue;
                }
            }
        }
        let (song, cache_path) = cache_and_parse_remote_song(&app, &source, file).await;
        if let Some(cache_path) = cache_path {
            cache_updates.push((remote_uri, cache_path));
        }
        songs.push(song);
    }

    emit_sync_progress(
        &app,
        &source.id,
        "writing",
        total,
        total,
        "正在写入音乐库",
        false,
        false,
    );
    let write_result = (|| -> Result<(), String> {
        let mut conn = db_conn.lock().map_err(|error| error.to_string())?;
        let next_paths = songs
            .iter()
            .map(|song| song.path.clone())
            .collect::<HashSet<_>>();
        let to_delete = existing_remote_song_paths(&conn, &source.id)?
            .into_iter()
            .filter(|path| !next_paths.contains(path))
            .collect::<Vec<_>>();

        replace_remote_files(&mut conn, &source.id, &files)?;
        apply_scan_changes(&mut conn, &songs, &[], &to_delete, None)?;
        mark_remote_songs(&conn, &source, &files)?;
        for (remote_uri, cache_path) in &cache_updates {
            update_song_cache_path(&conn, remote_uri, cache_path)?;
        }
        update_sync_status(&conn, &source.id, None)?;
        Ok(())
    })();

    if let Err(error) = write_result {
        if let Ok(conn) = db_conn.lock() {
            let _ = update_sync_status(&conn, &source.id, Some(&error));
        }
        emit_sync_progress(
            &app,
            &source.id,
            "error",
            total,
            total,
            error.clone(),
            true,
            true,
        );
        return Err(error);
    }

    emit_sync_progress(
        &app,
        &source.id,
        "complete",
        total,
        total,
        "同步完成",
        true,
        false,
    );
    Ok(RemoteSyncResult {
        source_id: source.id,
        indexed_files: files.len(),
        audio_files: files.len(),
        parsed_songs: songs.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use id3::TagLike;
    use id3::Version;
    use std::fs;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn remote_file(etag: Option<&str>, size: u64, modified_at: Option<&str>) -> RemoteFileEntry {
        RemoteFileEntry {
            remote_path: "/demo.flac".to_string(),
            name: "demo.flac".to_string(),
            size,
            etag: etag.map(ToOwned::to_owned),
            modified_at: modified_at.map(ToOwned::to_owned),
            is_dir: false,
        }
    }

    fn remote_source() -> RemoteSourceCredentials {
        RemoteSourceCredentials {
            id: "source".to_string(),
            name: "Source".to_string(),
            provider: "webdav".to_string(),
            base_url: "https://example.com".to_string(),
            username: None,
            password: None,
            root_path: "/".to_string(),
            enabled: true,
            last_sync_at: None,
            last_sync_error: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    fn complete_remote_song() -> Song {
        let mut song = song_from_remote_file(
            &remote_source(),
            &remote_file(Some("etag-a"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT")),
        );
        song.duration = 180;
        song.bitrate = 320;
        song.sample_rate = 44_100;
        song
    }

    fn temp_audio_path(ext: &str) -> std::path::PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        std::env::temp_dir().join(format!("lycia_remote_scan_{unique}.{ext}"))
    }

    fn write_tagged_mp3(path: &std::path::Path) {
        let mut tag = id3::Tag::new();
        tag.set_title("Remote Title");
        tag.set_artist("Remote Artist");
        tag.set_album("Remote Album");
        tag.set_album_artist("Remote Album Artist");

        let mut bytes = Vec::new();
        tag.write_to(&mut bytes, Version::Id3v23)
            .expect("id3 tag should serialize");
        bytes.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x64]);
        bytes.extend(std::iter::repeat(0).take(413));

        fs::write(path, bytes).expect("temp mp3 should be written");
    }

    #[test]
    fn unchanged_remote_file_with_existing_song_does_not_need_refresh() {
        let snapshot = RemoteSongSnapshot {
            etag: Some("etag-a".to_string()),
            size: 1024,
            modified_at: Some("Mon, 04 May 2026 10:00:00 GMT".to_string()),
            song: Some(complete_remote_song()),
        };

        assert!(!remote_file_needs_refresh(
            Some(&snapshot),
            &remote_file(Some("etag-a"), 2048, Some("changed"))
        ));
    }

    #[test]
    fn first_index_song_uses_remote_file_without_requiring_metadata_download() {
        let source = remote_source();
        let file = remote_file(
            Some("etag-a"),
            12_345,
            Some("Mon, 04 May 2026 10:00:00 GMT"),
        );

        let song = song_for_remote_index(&source, &file);

        assert_eq!(song.path, "remote://source/demo.flac");
        assert_eq!(song.title, "demo");
        assert_eq!(song.file_size, 12_345);
        assert_eq!(song.duration, 0);
        assert_eq!(song.bitrate, 0);
        assert_eq!(song.sample_rate, 0);
    }

    #[test]
    fn first_index_song_uses_parent_folder_as_album_fallback() {
        let source = remote_source();
        let mut file = remote_file(Some("etag-a"), 12_345, None);
        file.remote_path = "/Artist/Album/demo.flac".to_string();

        let song = song_for_remote_index(&source, &file);

        assert_eq!(song.album, "Album");
        assert_eq!(song.album_key, "album::未知歌手");
    }

    #[test]
    fn filename_metadata_fallback_splits_title_and_artist() {
        let source = remote_source();
        let mut file = remote_file(Some("etag-a"), 12_345, None);
        file.remote_path = "/Album/爱琴海-周杰伦.mp3".to_string();
        file.name = "爱琴海-周杰伦.mp3".to_string();
        let mut song = song_from_remote_file(&source, &file);

        apply_filename_metadata_fallback(&mut song, &file);

        assert_eq!(song.title, "爱琴海");
        assert_eq!(song.artist, "周杰伦");
        assert_eq!(song.artist_names, vec!["周杰伦".to_string()]);
        assert_eq!(song.album, "Album");
        assert_eq!(song.album_artist, "周杰伦");
        assert_eq!(song.album_key, "album::周杰伦");
    }

    #[test]
    fn cached_remote_file_uses_embedded_metadata_for_index_song() {
        let source = remote_source();
        let mut file = remote_file(Some("etag-a"), 12_345, None);
        file.remote_path = "/remote/demo.mp3".to_string();
        file.name = "demo.mp3".to_string();
        let temp_path = temp_audio_path("mp3");
        write_tagged_mp3(&temp_path);

        let song = song_from_cached_remote_file(&source, &file, &temp_path)
            .expect("cached file should parse");

        assert_eq!(song.path, "remote://source/remote/demo.mp3");
        assert_eq!(song.title, "Remote Title");
        assert_eq!(song.artist, "Remote Artist");
        assert_eq!(song.artist_names, vec!["Remote Artist".to_string()]);
        assert_eq!(song.album, "Remote Album");
        assert_eq!(song.album_artist, "Remote Album Artist");
        assert_eq!(song.album_key, "remote album::remote album artist");
        assert_eq!(song.format, "mp3");
        assert!(song.file_size > 0);

        let _ = fs::remove_file(temp_path);
    }

    #[test]
    fn incomplete_remote_song_needs_refresh_even_when_etag_matches() {
        let snapshot = RemoteSongSnapshot {
            etag: Some("etag-a".to_string()),
            size: 1024,
            modified_at: Some("Mon, 04 May 2026 10:00:00 GMT".to_string()),
            song: Some(song_from_remote_file(
                &remote_source(),
                &remote_file(Some("etag-a"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT")),
            )),
        };

        assert!(remote_file_needs_refresh(
            Some(&snapshot),
            &remote_file(Some("etag-a"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT"))
        ));
    }

    #[test]
    fn changed_remote_file_needs_refresh() {
        let snapshot = RemoteSongSnapshot {
            etag: Some("etag-a".to_string()),
            size: 1024,
            modified_at: Some("Mon, 04 May 2026 10:00:00 GMT".to_string()),
            song: None,
        };

        assert!(remote_file_needs_refresh(
            Some(&snapshot),
            &remote_file(Some("etag-b"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT"))
        ));
    }

    #[test]
    fn remote_file_without_existing_song_needs_refresh() {
        let snapshot = RemoteSongSnapshot {
            etag: Some("etag-a".to_string()),
            size: 1024,
            modified_at: Some("Mon, 04 May 2026 10:00:00 GMT".to_string()),
            song: None,
        };

        assert!(remote_file_needs_refresh(
            Some(&snapshot),
            &remote_file(Some("etag-a"), 1024, Some("Mon, 04 May 2026 10:00:00 GMT"))
        ));
    }
}
