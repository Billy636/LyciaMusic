// music/files.rs - 文件操作命令

use super::lyrics::{build_structured_lyrics_payload, StructuredLyricsPayload};
use super::scanner::{apply_scan_changes, parse_song_from_file};
use super::tags::{
    extract_detail_metadata, extract_embedded_lyrics, extract_embedded_lyrics_match,
    read_tagged_file_from_path,
};
use super::types::{
    LyricsStorageSource, SaveSongInfoResponse, SongDetail, SongInfoEditPayload, SongLyricsForEdit,
    SongRuntimeMetadata,
};
use crate::database::DbState;
use crate::error::CommandError;
use crate::remote::{
    cache::is_remote_uri,
    repository::{get_song_cache_path, get_source_for_remote_uri},
    webdav,
};
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem};
use rusqlite::{params, OptionalExtension};
use serde::Serialize;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::{State, Emitter};
use uuid::Uuid;

use super::utils::normalize_path;

#[derive(Serialize)]
pub struct MovedMusicFilePath {
    old_path: String,
    new_path: String,
}

#[derive(Serialize)]
pub struct BatchMoveMusicFilesResult {
    moved_paths: Vec<MovedMusicFilePath>,
}

fn read_sidecar_lrc(path_obj: &Path) -> Option<String> {
    read_sidecar_lrc_with_path(path_obj).map(|(content, _)| content)
}

fn read_sidecar_lrc_with_path(path_obj: &Path) -> Option<(String, PathBuf)> {
    let stem = path_obj.file_stem()?.to_string_lossy().to_string();
    let parent = path_obj.parent()?;

    // 支持的侧边歌词文件后缀，按照优先级排序
    let extensions = ["lrc", "ttml", "qrc", "yrc", "lys", "txt"];

    // 1. 优先尝试精确匹配
    for ext in &extensions {
        let exact_path = parent.join(format!("{}.{}", stem, ext));
        if let Ok(content) = fs::read_to_string(&exact_path) {
            return Some((content, exact_path));
        }
    }

    // 2. 如果没有精确匹配到，进行目录遍历（不区分后缀大小写）
    let entries = fs::read_dir(parent).ok()?;
    for entry in entries.flatten() {
        let candidate = entry.path();
        if !candidate.is_file() {
            continue;
        }

        let is_valid_ext = candidate
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| {
                extensions.iter().any(|&valid_ext| ext.eq_ignore_ascii_case(valid_ext))
            })
            .unwrap_or(false);
        if !is_valid_ext {
            continue;
        }

        let candidate_stem = candidate.file_stem()?.to_string_lossy().to_string();
        if !candidate_stem.eq_ignore_ascii_case(&stem) {
            continue;
        }

        if let Ok(content) = fs::read_to_string(&candidate) {
            return Some((content, candidate));
        }
    }

    None
}

fn get_sidecar_lrc_path(path_obj: &Path) -> Result<PathBuf, String> {
    let stem = path_obj
        .file_stem()
        .ok_or_else(|| "Invalid song path".to_string())?
        .to_string_lossy()
        .to_string();
    let parent = path_obj
        .parent()
        .ok_or_else(|| "Song parent folder does not exist".to_string())?;

    Ok(parent.join(format!("{}.lrc", stem)))
}

fn remote_sidecar_lrc_path(remote_path: &str) -> Option<String> {
    let normalized = remote_path.replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    let (parent, file_name) = trimmed.rsplit_once('/')?;
    let stem = file_name.rsplit_once('.').map(|(stem, _)| stem)?;
    let parent = if parent.is_empty() { "/" } else { parent };
    Some(format!("{}/{}.lrc", parent.trim_end_matches('/'), stem))
}

fn write_sidecar_lyrics(
    path_obj: &Path,
    source_path: Option<String>,
    lyrics: String,
) -> Result<String, String> {
    let lrc_path = source_path
        .filter(|path| !path.trim().is_empty())
        .map(PathBuf::from)
        .map(Ok)
        .unwrap_or_else(|| get_sidecar_lrc_path(path_obj))?;

    fs::write(&lrc_path, lyrics).map_err(|e| e.to_string())?;

    Ok(normalize_path(&lrc_path.to_string_lossy()))
}

fn write_tag_item(tag: &mut Tag, key: ItemKey, description: String, lyrics: String) {
    if lyrics.trim().is_empty() {
        let _ = tag
            .take_filter(&key, |item| item.description() == description)
            .count();
        return;
    }

    let _ = tag
        .take_filter(&key, |item| item.description() == description)
        .count();

    let mut item = TagItem::new(key.clone(), ItemValue::Text(lyrics));
    if !description.is_empty() {
        item.set_description(description);
    }

    if matches!(key, ItemKey::Unknown(_)) {
        tag.push_unchecked(item);
    } else {
        let _ = tag.push(item);
    }
}

fn write_embedded_lyrics(path_obj: &Path, lyrics: String) -> Result<String, String> {
    let mut tagged_file = read_tagged_file_from_path(path_obj).map_err(|e| e.to_string())?;
    let current_lyrics = extract_embedded_lyrics_match(&tagged_file);
    let tag_type = current_lyrics
        .as_ref()
        .map(|lyrics_match| lyrics_match.tag_type)
        .unwrap_or_else(|| tagged_file.primary_tag_type());

    if tagged_file.tag_mut(tag_type).is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }

    let tag = tagged_file
        .tag_mut(tag_type)
        .ok_or_else(|| "Song file does not support writable lyrics tags".to_string())?;

    if let Some(lyrics_match) = current_lyrics {
        write_tag_item(tag, lyrics_match.item_key, lyrics_match.description, lyrics);
    } else if lyrics.trim().is_empty() {
        tag.remove_key(&ItemKey::Lyrics);
    } else {
        let _ = tag.insert_text(ItemKey::Lyrics, lyrics);
    }

    tagged_file
        .save_to_path(path_obj, WriteOptions::default())
        .map_err(|e| e.to_string())?;

    Ok(normalize_path(&path_obj.to_string_lossy()))
}

fn normalized_optional_text(value: Option<String>) -> Option<String> {
    value
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn write_optional_text(tag: &mut Tag, key: ItemKey, value: Option<String>) {
    if let Some(value) = normalized_optional_text(value) {
        let _ = tag.insert_text(key, value);
    } else {
        tag.remove_key(&key);
    }
}

fn picture_mime_from_path(path: &Path) -> MimeType {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .as_deref()
    {
        Some("jpg") | Some("jpeg") => MimeType::Jpeg,
        Some("png") => MimeType::Png,
        Some("gif") => MimeType::Gif,
        Some("bmp") => MimeType::Bmp,
        Some("tif") | Some("tiff") => MimeType::Tiff,
        Some("webp") => MimeType::Unknown("image/webp".to_string()),
        _ => MimeType::Unknown("application/octet-stream".to_string()),
    }
}

fn write_song_info_tags(path_obj: &Path, payload: &SongInfoEditPayload) -> Result<(), String> {
    let title = payload.title.trim();
    if title.is_empty() {
        return Err("歌名不能为空".to_string());
    }

    let mut tagged_file = read_tagged_file_from_path(path_obj).map_err(|e| e.to_string())?;
    let tag_type = tagged_file.primary_tag_type();

    if tagged_file.tag_mut(tag_type).is_none() {
        tagged_file.insert_tag(Tag::new(tag_type));
    }

    let tag = tagged_file
        .tag_mut(tag_type)
        .ok_or_else(|| "当前歌曲格式不支持写入标签".to_string())?;

    let _ = tag.insert_text(ItemKey::TrackTitle, title.to_string());
    write_optional_text(tag, ItemKey::TrackArtist, Some(payload.artist.clone()));
    write_optional_text(tag, ItemKey::AlbumTitle, Some(payload.album.clone()));
    write_optional_text(tag, ItemKey::AlbumArtist, Some(payload.artist.clone()));
    write_optional_text(tag, ItemKey::TrackNumber, payload.track_number.clone());
    write_optional_text(tag, ItemKey::DiscNumber, payload.disc_number.clone());
    write_optional_text(tag, ItemKey::RecordingDate, payload.year.clone());
    if normalized_optional_text(payload.year.clone()).is_none() {
        tag.remove_key(&ItemKey::Year);
    }

    if let Some(cover_path) = normalized_optional_text(payload.cover_path.clone()) {
        let cover_path_obj = Path::new(&cover_path);
        if !cover_path_obj.is_file() {
            return Err("选择的封面图片不存在".to_string());
        }

        let image_bytes = fs::read(cover_path_obj).map_err(|e| e.to_string())?;
        let picture = Picture::new_unchecked(
            PictureType::CoverFront,
            Some(picture_mime_from_path(cover_path_obj)),
            None,
            image_bytes,
        );
        tag.remove_picture_type(PictureType::CoverFront);
        tag.push_picture(picture);
    }

    tagged_file
        .save_to_path(path_obj, WriteOptions::default())
        .map_err(|e| e.to_string())
}

fn build_song_detail_from_file(path_obj: &Path, normalized_path: &str) -> SongDetail {
    let mut detail = SongDetail {
        path: normalized_path.to_string(),
        ..SongDetail::default()
    };

    if let Ok(metadata) = fs::metadata(path_obj) {
        detail.file_size = Some(metadata.len());
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(path_obj) {
        let tag_detail = extract_detail_metadata(&tagged_file);
        detail.genre = tag_detail.genre;
        detail.year = tag_detail.year;
        detail.track_number = tag_detail.track_number;
        detail.disc_number = tag_detail.disc_number;
        detail.comment = tag_detail.comment;
    }

    detail.container = path_obj
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase());

    detail
}

fn load_song_id(conn: &rusqlite::Connection, path: &str) -> Result<Option<i64>, String> {
    conn.query_row(
        "SELECT id FROM songs WHERE path = ?1 LIMIT 1",
        params![path],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|e| e.to_string())
}

fn sync_moved_song_paths(
    conn: &mut rusqlite::Connection,
    moved_paths: &[(String, String)],
) -> Result<(), String> {
    if moved_paths.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(|e| e.to_string())?;

    {
        let mut update_song_stmt = tx
            .prepare("UPDATE songs SET path = ?1 WHERE path = ?2")
            .map_err(|e| e.to_string())?;
        let mut update_history_stmt = tx
            .prepare("UPDATE play_history SET song_path = ?1 WHERE song_path = ?2")
            .map_err(|e| e.to_string())?;

        for (old_path, new_path) in moved_paths {
            update_song_stmt
                .execute(params![new_path, old_path])
                .map_err(|e| format!("failed to update song path '{}': {}", old_path, e))?;
            update_history_stmt
                .execute(params![new_path, old_path])
                .map_err(|e| format!("failed to update play history '{}': {}", old_path, e))?;
        }
    }

    tx.commit().map_err(|e| e.to_string())
}

fn read_song_lyrics_raw(path: &str) -> String {
    if let Ok(tagged_file) = read_tagged_file_from_path(Path::new(path)) {
        if let Some(lyrics) = extract_embedded_lyrics(&tagged_file) {
            return lyrics;
        }
    }

    let path_obj = Path::new(path);
    if let Some(content) = read_sidecar_lrc(path_obj) {
        return content;
    }

    String::new()
}

async fn read_remote_song_lyrics_raw(path: &str, db_state: &DbState) -> String {
    let lookup_and_cache = {
        let conn = match db_state.conn.lock() {
            Ok(conn) => conn,
            Err(_) => return String::new(),
        };
        let lookup = get_source_for_remote_uri(&conn, path).ok();
        let cache_path = lookup
            .as_ref()
            .and_then(|(_, _, _, stored_remote_uri)| {
                get_song_cache_path(&conn, stored_remote_uri.as_deref().unwrap_or(path)).ok()
            })
            .flatten();
        (lookup, cache_path)
    };
    let (lookup, cache_path) = lookup_and_cache;
    if let Some(cache_path) = cache_path.filter(|path| Path::new(path).is_file()) {
        let lyrics = read_song_lyrics_raw(&cache_path);
        if !lyrics.trim().is_empty() {
            return lyrics;
        }
    }

    let Some((source, remote_path, _etag, _stored_remote_uri)) = lookup else {
        return String::new();
    };
    let Some(lrc_path) = remote_sidecar_lrc_path(&remote_path) else {
        return String::new();
    };

    webdav::read_text_file(&source, &lrc_path)
        .await
        .ok()
        .flatten()
        .unwrap_or_default()
}

async fn read_song_lyrics_raw_for_path(path: &str, db_state: &DbState) -> String {
    if is_remote_uri(path) {
        read_remote_song_lyrics_raw(path, db_state).await
    } else {
        read_song_lyrics_raw(path)
    }
}

#[tauri::command]
pub async fn get_song_lyrics(path: String, db_state: State<'_, DbState>) -> Result<String, String> {
    Ok(read_song_lyrics_raw_for_path(&path, &db_state).await)
}

#[tauri::command]
pub async fn get_song_lyrics_payload(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<StructuredLyricsPayload, String> {
    Ok(build_structured_lyrics_payload(
        read_song_lyrics_raw_for_path(&path, &db_state).await,
    ))
}

#[tauri::command]
pub async fn get_song_lyrics_for_edit(path: String) -> Result<SongLyricsForEdit, String> {
    if let Ok(tagged_file) = read_tagged_file_from_path(Path::new(&path)) {
        if let Some(lyrics) = extract_embedded_lyrics(&tagged_file) {
            return Ok(SongLyricsForEdit {
                lyrics,
                source: LyricsStorageSource::Embedded,
                source_path: None,
            });
        }
    }

    let path_obj = Path::new(&path);
    if let Some((content, lrc_path)) = read_sidecar_lrc_with_path(path_obj) {
        return Ok(SongLyricsForEdit {
            lyrics: content,
            source: LyricsStorageSource::Sidecar,
            source_path: Some(normalize_path(&lrc_path.to_string_lossy())),
        });
    }

    Ok(SongLyricsForEdit {
        lyrics: String::new(),
        source: LyricsStorageSource::Empty,
        source_path: None,
    })
}

#[tauri::command]
pub async fn save_song_lyrics(
    path: String,
    lyrics: String,
    source: LyricsStorageSource,
    source_path: Option<String>,
) -> Result<SongLyricsForEdit, String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("Song file does not exist".to_string());
    }

    match source {
        LyricsStorageSource::Embedded => {
            let saved_path = write_embedded_lyrics(path_obj, lyrics.clone())?;
            Ok(SongLyricsForEdit {
                lyrics,
                source: LyricsStorageSource::Embedded,
                source_path: Some(saved_path),
            })
        }
        LyricsStorageSource::Sidecar | LyricsStorageSource::Empty => {
            let saved_path = write_sidecar_lyrics(path_obj, source_path, lyrics.clone())?;
            Ok(SongLyricsForEdit {
                lyrics,
                source: LyricsStorageSource::Sidecar,
                source_path: Some(saved_path),
            })
        }
    }
}

#[tauri::command]
pub fn save_song_info(
    _app: tauri::AppHandle,
    path: String,
    payload: SongInfoEditPayload,
    db_state: State<'_, DbState>,
) -> Result<SaveSongInfoResponse, String> {
    if is_remote_uri(&path) {
        return Err("远程歌曲暂不支持直接编辑文件标签".to_string());
    }

    let normalized_path = normalize_path(&path);
    let path_obj = Path::new(&path);
    if !path_obj.is_file() {
        return Err("歌曲文件不存在".to_string());
    }

    let existing_song_id = {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        load_song_id(&conn, &normalized_path)?
    };

    write_song_info_tags(path_obj, &payload)?;

    let extension = path_obj
        .extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.to_ascii_lowercase())
        .unwrap_or_default();
    let mut song = parse_song_from_file(path_obj, &normalized_path, &extension)
        .ok_or_else(|| "保存后无法重新读取歌曲信息".to_string())?;
    song.id = existing_song_id;

    {
        let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        if existing_song_id.is_some() {
            apply_scan_changes(&mut conn, &[], std::slice::from_ref(&song), &[], None)?;
        } else {
            apply_scan_changes(&mut conn, std::slice::from_ref(&song), &[], &[], None)?;
            song.id = load_song_id(&conn, &normalized_path)?;
        }
    }

    let mut detail = build_song_detail_from_file(path_obj, &normalized_path);
    detail.container = song.container.clone().or(detail.container);
    detail.codec = song.codec.clone();
    detail.file_size = Some(song.file_size);

    Ok(SaveSongInfoResponse { song, detail })
}

fn load_song_runtime_metadata(
    conn: &rusqlite::Connection,
    normalized_path: &str,
) -> Result<Option<SongRuntimeMetadata>, String> {
    conn.query_row(
        "SELECT id, remote_source_id, cue_source_path, cue_start_offset, cue_end_offset
         FROM songs
         WHERE path = ?1
         LIMIT 1",
        params![normalized_path],
        |row| {
            Ok(SongRuntimeMetadata {
                id: row.get(0)?,
                remote_source_id: row.get(1)?,
                cue_source_path: row.get(2)?,
                cue_start_offset: row.get::<_, Option<i64>>(3)?.map(|value| value as u32),
                cue_end_offset: row.get::<_, Option<i64>>(4)?.map(|value| value as u32),
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_song_runtime_metadata(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<Option<SongRuntimeMetadata>, String> {
    let normalized_path = normalize_path(&path);
    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    load_song_runtime_metadata(&conn, &normalized_path)
}

fn hydrate_song_detail_from_db(
    conn: &rusqlite::Connection,
    normalized_path: &str,
    detail: &mut SongDetail,
) -> Result<(), String> {
    if let Some((
        container,
        codec,
        file_size,
        track_number,
        disc_number,
        comment,
        bitrate,
        sample_rate,
        bit_depth,
        format,
    )) = conn
        .query_row(
            "SELECT container, codec, file_size, track_number, disc_number, comment,
                    bitrate, sample_rate, bit_depth, format
             FROM songs
             WHERE path = ?1
             LIMIT 1",
            params![normalized_path],
            |row| {
                Ok((
                    row.get::<_, Option<String>>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<i64>>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, Option<i64>>(6)?,
                    row.get::<_, Option<i64>>(7)?,
                    row.get::<_, Option<i64>>(8)?,
                    row.get::<_, Option<String>>(9)?,
                ))
            },
        )
        .optional()
        .map_err(|e| e.to_string())?
    {
        detail.container = container.filter(|value| !value.trim().is_empty());
        detail.codec = codec.filter(|value| !value.trim().is_empty());
        detail.file_size = file_size.and_then(|value| u64::try_from(value).ok());
        detail.track_number = track_number;
        detail.disc_number = disc_number;
        detail.comment = comment;
        detail.bitrate = bitrate.and_then(|value| u32::try_from(value).ok());
        detail.sample_rate = sample_rate.and_then(|value| u32::try_from(value).ok());
        detail.bit_depth = bit_depth.and_then(|value| u8::try_from(value).ok());
        detail.format = format.filter(|value| !value.trim().is_empty());
    }

    Ok(())
}

#[tauri::command]
pub async fn get_song_detail(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<SongDetail, String> {
    let normalized_path = normalize_path(&path);
    let path_obj = Path::new(&path);
    let mut detail = SongDetail {
        path: normalized_path.clone(),
        ..SongDetail::default()
    };

    {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        hydrate_song_detail_from_db(&conn, &normalized_path, &mut detail)?;
    }

    if let Ok(metadata) = fs::metadata(path_obj) {
        detail.file_size = Some(metadata.len());
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(path_obj) {
        let tag_detail = extract_detail_metadata(&tagged_file);
        detail.genre = tag_detail.genre;
        detail.year = tag_detail.year;
        detail.track_number = tag_detail.track_number;
        detail.disc_number = tag_detail.disc_number;
        detail.comment = tag_detail.comment;

        if detail.container.is_none() {
            detail.container = path_obj
                .extension()
                .and_then(|ext| ext.to_str())
                .map(|ext| ext.to_ascii_lowercase());
        }
    }

    Ok(detail)
}

#[tauri::command]
pub fn batch_move_music_files(
    paths: Vec<String>,
    target_folder: String,
    db_state: State<'_, DbState>,
) -> Result<BatchMoveMusicFilesResult, CommandError> {
    let target = Path::new(&target_folder);
    let mut moved_paths: Vec<(String, String)> = Vec::new();
    if !target.exists() || !target.is_dir() {
        return Err(CommandError::new("TARGET_NOT_FOUND", "目标文件夹不存在"));
    }
    for path_str in paths {
        let src = Path::new(&path_str);
        if let Some(file_name) = src.file_name() {
            let dest = target.join(file_name);
            if fs::rename(src, &dest).is_ok() {
                moved_paths.push((
                    normalize_path(&path_str),
                    normalize_path(&dest.to_string_lossy()),
                ));
            }
        }
    }
    if !moved_paths.is_empty() {
        let mut conn = db_state
            .conn
            .lock()
            .map_err(|e| CommandError::new("DB_LOCK_FAILED", &e.to_string()))?;
        sync_moved_song_paths(&mut conn, &moved_paths)
            .map_err(|e| CommandError::new("DB_SYNC_FAILED", &e))?;
    }

    Ok(BatchMoveMusicFilesResult {
        moved_paths: moved_paths
            .into_iter()
            .map(|(old_path, new_path)| MovedMusicFilePath { old_path, new_path })
            .collect(),
    })
}

#[tauri::command]
pub fn move_music_file(
    old_path: String,
    new_path: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let src = Path::new(&old_path);
    let dest = Path::new(&new_path);
    if !src.exists() {
        return Err("源文件不存在".to_string());
    }
    if let Some(parent) = dest.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    fs::rename(src, dest).map_err(|e| e.to_string())?;
    let normalized_old_path = normalize_path(&old_path);
    let normalized_new_path = normalize_path(&dest.to_string_lossy());
    let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    sync_moved_song_paths(&mut conn, &[(normalized_old_path, normalized_new_path)])?;
    Ok(())
}

#[tauri::command]
pub fn show_in_folder(path: String) {
    #[cfg(target_os = "windows")]
    {
        Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .unwrap_or_else(|_| {
                println!("Failed");
                child_dummy()
            });
    }
    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .args(["-R", &path])
            .spawn()
            .unwrap_or_else(|_| {
                println!("Failed");
                child_dummy()
            });
    }
    #[cfg(target_os = "linux")]
    {
        if let Some(parent) = std::path::Path::new(&path).parent() {
            Command::new("xdg-open").arg(parent).spawn().ok();
        }
    }
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn child_dummy() -> std::process::Child {
    Command::new("true").spawn().unwrap()
}

#[tauri::command]
pub fn delete_music_file(path: String, db_state: State<'_, DbState>) -> Result<(), String> {
    let normalized_path = crate::music::utils::normalize_path(&path);

    if let Err(e) = fs::remove_file(&path) {
        if e.kind() != std::io::ErrorKind::NotFound {
            return Err(format!("Failed to delete file on disk: {}", e));
        }
    }

    let conn = db_state.conn.lock().map_err(|e| e.to_string())?;

    #[cfg(target_os = "windows")]
    let delete_sql = "DELETE FROM songs WHERE path = ?1 COLLATE NOCASE";
    #[cfg(not(target_os = "windows"))]
    let delete_sql = "DELETE FROM songs WHERE path = ?1";

    let mut stmt = conn.prepare(delete_sql).map_err(|e| e.to_string())?;
    stmt.execute([&normalized_path]).map_err(|e| e.to_string())?;

    let _ = conn.execute(
        "DELETE FROM artists
         WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)",
        [],
    );

    Ok(())
}

#[tauri::command]
pub fn delete_folder(path: String) -> Result<(), String> {
    fs::remove_dir_all(path).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn create_folder(parent_path: String, folder_name: String) -> Result<String, String> {
    let trimmed_name = folder_name.trim();
    if trimmed_name.is_empty() {
        return Err("Folder name cannot be empty".to_string());
    }

    let mut components = Path::new(trimmed_name).components();
    match (components.next(), components.next()) {
        (Some(Component::Normal(_)), None) => {}
        _ => return Err("Folder name contains invalid path characters".to_string()),
    }

    let parent = Path::new(&parent_path);
    if !parent.exists() || !parent.is_dir() {
        return Err("Parent folder does not exist".to_string());
    }

    let new_folder_path = parent.join(trimmed_name);
    if new_folder_path.exists() {
        return Err("Folder already exists".to_string());
    }

    fs::create_dir(&new_folder_path).map_err(|e| e.to_string())?;

    Ok(normalize_path(&new_folder_path.to_string_lossy()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::database::DbState;
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn remote_sidecar_lrc_path_uses_remote_song_parent_and_stem() {
        assert_eq!(
            remote_sidecar_lrc_path("/Artist/Album/Demo.flac").as_deref(),
            Some("/Artist/Album/Demo.lrc")
        );
    }

    #[tokio::test]
    async fn remote_lyrics_use_cached_sidecar_before_remote_lrc() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lycia_remote_lyrics_test_{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let cached_audio = dir.join("Demo.flac");
        let cached_lrc = dir.join("Demo.lrc");
        fs::write(&cached_audio, b"not real audio").unwrap();
        fs::write(&cached_lrc, "[00:01.00]cached lyric").unwrap();

        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE remote_sources (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                provider TEXT NOT NULL,
                base_url TEXT NOT NULL,
                username TEXT,
                password TEXT,
                root_path TEXT NOT NULL,
                enabled INTEGER NOT NULL,
                last_sync_at INTEGER,
                last_sync_error TEXT,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL
            );
            CREATE TABLE remote_files (
                source_id TEXT NOT NULL,
                remote_path TEXT NOT NULL,
                remote_uri TEXT NOT NULL,
                etag TEXT
            );
            CREATE TABLE songs (
                path TEXT PRIMARY KEY,
                cache_path TEXT
            );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO remote_sources (
                id, name, provider, base_url, root_path, enabled, created_at, updated_at
             ) VALUES ('source', 'Source', 'webdav', 'https://dav.invalid', '/', 1, 0, 0)",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO remote_files (source_id, remote_path, remote_uri)
             VALUES ('source', '/Artist/Album/Demo.flac', 'remote://source/Artist/Album/Demo.flac')",
            [],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO songs (path, cache_path) VALUES (?1, ?2)",
            params![
                "remote://source/Artist/Album/Demo.flac",
                cached_audio.to_string_lossy()
            ],
        )
        .unwrap();
        let db_state = DbState {
            conn: Arc::new(Mutex::new(conn)),
        };

        let lyrics =
            read_remote_song_lyrics_raw("remote://source/Artist/Album/Demo.flac", &db_state).await;

        assert_eq!(lyrics, "[00:01.00]cached lyric");
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn loads_runtime_metadata_only_when_requested() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE songs (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                remote_source_id TEXT,
                cue_source_path TEXT,
                cue_start_offset INTEGER,
                cue_end_offset INTEGER
            );
            INSERT INTO songs VALUES (
                7,
                '/music/track.cue',
                'remote-source',
                '/music/album.flac',
                12000,
                34000
            );",
        )
        .unwrap();

        let metadata = load_song_runtime_metadata(&conn, "/music/track.cue")
            .unwrap()
            .expect("runtime metadata");

        assert_eq!(metadata.id, Some(7));
        assert_eq!(metadata.remote_source_id.as_deref(), Some("remote-source"));
        assert_eq!(metadata.cue_source_path.as_deref(), Some("/music/album.flac"));
        assert_eq!(metadata.cue_start_offset, Some(12000));
        assert_eq!(metadata.cue_end_offset, Some(34000));
    }

    #[test]
    fn song_detail_uses_database_metadata_when_file_is_unavailable() {
        let conn = Connection::open_in_memory().unwrap();
        conn.execute_batch(
            "CREATE TABLE songs (
                path TEXT PRIMARY KEY,
                container TEXT,
                codec TEXT,
                file_size INTEGER,
                track_number TEXT,
                disc_number TEXT,
                comment TEXT,
                bitrate INTEGER,
                sample_rate INTEGER,
                bit_depth INTEGER,
                format TEXT
            );
            INSERT INTO songs VALUES (
                'remote://source/track.flac',
                'flac',
                'flac',
                123456,
                '03',
                '02',
                'Remote comment',
                1411,
                96000,
                24,
                'flac'
            );",
        )
        .unwrap();
        let mut detail = SongDetail {
            path: "remote://source/track.flac".to_string(),
            ..SongDetail::default()
        };

        hydrate_song_detail_from_db(&conn, &detail.path.clone(), &mut detail).unwrap();

        assert_eq!(detail.container.as_deref(), Some("flac"));
        assert_eq!(detail.codec.as_deref(), Some("flac"));
        assert_eq!(detail.file_size, Some(123456));
        assert_eq!(detail.track_number.as_deref(), Some("03"));
        assert_eq!(detail.disc_number.as_deref(), Some("02"));
        assert_eq!(detail.comment.as_deref(), Some("Remote comment"));
        assert_eq!(detail.bitrate, Some(1411));
        assert_eq!(detail.sample_rate, Some(96000));
        assert_eq!(detail.bit_depth, Some(24));
        assert_eq!(detail.format.as_deref(), Some("flac"));
    }
}

#[tauri::command]
pub fn move_file_to_folder(
    source_path: String,
    target_folder: String,
    db_state: State<'_, DbState>,
) -> Result<(), String> {
    let source = Path::new(&source_path);
    let filename = source.file_name().ok_or("Invalid source filename")?;
    let target = Path::new(&target_folder).join(filename);

    if target.exists() {
        return Err("Target file already exists".to_string());
    }

    fs::rename(source, &target).map_err(|e| e.to_string())?;
    let normalized_source = normalize_path(&source_path);
    let normalized_target = normalize_path(&target.to_string_lossy());
    let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    sync_moved_song_paths(&mut conn, &[(normalized_source, normalized_target)])
}

#[tauri::command]
pub fn is_directory(path: String) -> bool {
    Path::new(&path).is_dir()
}

struct SongTagWriteInfo {
    path: String,
    source_type: Option<String>,
    remote_source_id: Option<String>,
    cue_source_path: Option<String>,
    artist_count: i64,
}

#[tauri::command]
pub async fn save_artist_avatar(
    app: tauri::AppHandle,
    db_state: State<'_, DbState>,
    artist_id: i64,
    image_path: String,
    write_to_tags: bool,
) -> Result<super::types::SaveArtistAvatarResponse, String> {
    use sha2::{Digest, Sha256};
    use std::io::{Read, Seek};

    let path = Path::new(&image_path);
    if !path.exists() {
        return Err("Image file does not exist".to_string());
    }

    let mut file = fs::File::open(path).map_err(|e| format!("Failed to open image file: {}", e))?;
    let mut header = [0u8; 12];
    let bytes_read = file.read(&mut header).map_err(|e| format!("Failed to read image header: {}", e))?;

    if bytes_read < 3 {
        return Err("Invalid image file: too short".to_string());
    }

    let ext = if header[..3] == [0xFF, 0xD8, 0xFF] {
        "jpg"
    } else if bytes_read >= 8 && header[..8] == [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A] {
        "png"
    } else if bytes_read >= 12 && &header[0..4] == b"RIFF" && &header[8..12] == b"WEBP" {
        "webp"
    } else {
        return Err("Unsupported image format. Only JPEG, PNG, and WEBP are allowed.".to_string());
    };

    // Reset file read pointer to compute SHA-256
    file.seek(std::io::SeekFrom::Start(0)).map_err(|e| format!("Failed to seek image file: {}", e))?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let n = file.read(&mut buffer).map_err(|e| format!("Failed to read image file for hashing: {}", e))?;
        if n == 0 {
            break;
        }
        hasher.update(&buffer[..n]);
    }
    let hash_result = hasher.finalize();
    let sha256_hex = format!("{:x}", hash_result);

    // Get covers cache directory
    let covers_dir = super::covers::get_cover_cache_dir(&app);
    let target_filename = format!("artist-avatar-{}-{}.{}", artist_id, sha256_hex, ext);
    let target_path = covers_dir.join(target_filename);

    // Copy file to target path
    fs::copy(path, &target_path).map_err(|e| format!("Failed to copy image to covers directory: {}", e))?;

    let target_path_str = normalize_path(&target_path.to_string_lossy());

    // Update database & query song paths in a short-lived transaction block
    let (songs_info, task_id) = if write_to_tags {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        
        conn.execute(
            "UPDATE artists SET avatar_path = ?1 WHERE id = ?2",
            params![Some(&target_path_str), artist_id],
        )
        .map_err(|e| format!("Failed to update database: {}", e))?;

        let mut stmt = conn.prepare(
            "SELECT s.path, s.source_type, s.remote_source_id, s.cue_source_path, \
             (SELECT COUNT(*) FROM song_artists sa2 WHERE sa2.song_id = s.id) AS artist_count \
             FROM songs s \
             INNER JOIN song_artists sa ON s.id = sa.song_id \
             WHERE sa.artist_id = ?1"
        ).map_err(|e| e.to_string())?;
        
        let rows = stmt.query_map(params![artist_id], |row| {
            Ok(SongTagWriteInfo {
                path: row.get(0)?,
                source_type: row.get(1)?,
                remote_source_id: row.get(2)?,
                cue_source_path: row.get(3)?,
                artist_count: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;

        let mut items = Vec::new();
        for r in rows {
            if let Ok(item) = r {
                items.push(item);
            }
        }

        let tid = Uuid::new_v4().to_string();
        (items, Some(tid))
    } else {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE artists SET avatar_path = ?1 WHERE id = ?2",
            params![Some(&target_path_str), artist_id],
        )
        .map_err(|e| format!("Failed to update database: {}", e))?;

        (Vec::new(), None)
    };

    // Spawn background blocking task if task_id exists
    if let Some(ref task_id_str) = task_id {
        let app_clone = app.clone();
        let avatar_path_clone = target_path_str.clone();
        let task_id_clone = task_id_str.clone();
        let ext_clone = ext.to_string();

        tokio::task::spawn_blocking(move || {
            let total = songs_info.len();
            let mut success_count = 0;
            let mut failure_count = 0;
            let mut skipped_count = 0;
            let mut skipped_multi_artist = 0;
            let mut skipped_remote = 0;
            let mut skipped_cue = 0;
            let mut skipped_readonly = 0;
            let mut skipped_missing = 0;

            // Emit initial progress event
            let _ = app_clone.emit("artist-avatar:write-tags-progress", super::types::WriteTagsProgressPayload {
                task_id: task_id_clone.clone(),
                artist_id,
                current: 0,
                total,
                success_count: 0,
                failure_count: 0,
                skipped_count: 0,
                skipped_multi_artist: 0,
                skipped_remote: 0,
                skipped_cue: 0,
                skipped_readonly: 0,
                skipped_missing: 0,
                done: false,
                error: None,
            });

            if total > 0 {
                match fs::read(&avatar_path_clone) {
                    Ok(image_bytes) => {
                        let mime = match ext_clone.as_str() {
                            "jpg" | "jpeg" => MimeType::Jpeg,
                            "png" => MimeType::Png,
                            "webp" => MimeType::Unknown("image/webp".to_string()),
                            _ => MimeType::Unknown("application/octet-stream".to_string()),
                        };

                        for (idx, item) in songs_info.iter().enumerate() {
                            let path_obj = Path::new(&item.path);

                            // 1. Remote/CUE/Multi-artist checks
                            let is_remote = {
                                let is_remote_source = match &item.source_type {
                                    Some(s) => !s.is_empty() && s != "local",
                                    None => false,
                                };
                                let is_remote_id = match &item.remote_source_id {
                                    Some(s) => !s.is_empty(),
                                    None => false,
                                };
                                is_remote_source || is_remote_id || is_remote_uri(&item.path)
                            };

                            let is_cue = match &item.cue_source_path {
                                Some(s) => !s.is_empty(),
                                None => false,
                              };

                            if is_remote {
                                skipped_remote += 1;
                                skipped_count += 1;
                            } else if is_cue {
                                skipped_cue += 1;
                                skipped_count += 1;
                            } else if item.artist_count > 1 {
                                skipped_multi_artist += 1;
                                skipped_count += 1;
                            } else if !path_obj.is_file() {
                                // 2. Existence check
                                skipped_missing += 1;
                                skipped_count += 1;
                            } else {
                                // 3. Readonly check
                                let is_readonly = match fs::metadata(path_obj) {
                                    Ok(meta) => meta.permissions().readonly(),
                                    Err(_) => false,
                                };

                                if is_readonly {
                                    skipped_readonly += 1;
                                    skipped_count += 1;
                                } else {
                                    // 4. lofty tag update
                                    match read_tagged_file_from_path(path_obj) {
                                        Ok(mut tagged_file) => {
                                            let tag_type = tagged_file.primary_tag_type();
                                            if tagged_file.tag_mut(tag_type).is_none() {
                                                tagged_file.insert_tag(Tag::new(tag_type));
                                            }
                                            if let Some(tag) = tagged_file.tag_mut(tag_type) {
                                                let picture = Picture::new_unchecked(
                                                    PictureType::Artist,
                                                    Some(mime.clone()),
                                                    None,
                                                    image_bytes.clone(),
                                                );
                                                tag.remove_picture_type(PictureType::Artist);
                                                tag.push_picture(picture);

                                                match tagged_file.save_to_path(path_obj, WriteOptions::default()) {
                                                    Ok(_) => {
                                                        success_count += 1;
                                                    }
                                                    Err(_) => {
                                                        failure_count += 1;
                                                    }
                                                }
                                            } else {
                                                failure_count += 1;
                                            }
                                        }
                                        Err(_) => {
                                            failure_count += 1;
                                        }
                                    }
                                }
                            }

                            // Emit periodic progress
                            let _ = app_clone.emit("artist-avatar:write-tags-progress", super::types::WriteTagsProgressPayload {
                                task_id: task_id_clone.clone(),
                                artist_id,
                                current: idx + 1,
                                total,
                                success_count,
                                failure_count,
                                skipped_count,
                                skipped_multi_artist,
                                skipped_remote,
                                skipped_cue,
                                skipped_readonly,
                                skipped_missing,
                                done: false,
                                error: None,
                            });
                        }
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to read avatar cache: {}", e);
                        let _ = app_clone.emit("artist-avatar:write-tags-progress", super::types::WriteTagsProgressPayload {
                            task_id: task_id_clone.clone(),
                            artist_id,
                            current: 0,
                            total,
                            success_count: 0,
                            failure_count: total,
                            skipped_count: 0,
                            skipped_multi_artist: 0,
                            skipped_remote: 0,
                            skipped_cue: 0,
                            skipped_readonly: 0,
                            skipped_missing: 0,
                            done: true,
                            error: Some(error_msg),
                        });
                        return;
                    }
                }
            }

            // Emit final done event
            let _ = app_clone.emit("artist-avatar:write-tags-progress", super::types::WriteTagsProgressPayload {
                task_id: task_id_clone,
                artist_id,
                current: total,
                total,
                success_count,
                failure_count,
                skipped_count,
                skipped_multi_artist,
                skipped_remote,
                skipped_cue,
                skipped_readonly,
                skipped_missing,
                done: true,
                error: None,
            });
        });
    }

    Ok(super::types::SaveArtistAvatarResponse {
        artist_id,
        avatar_path: target_path_str,
        task_id,
    })
}
