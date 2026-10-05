// music/files.rs - 文件操作命令

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
use crate::player::{notify_audio_paths_relocated, AudioPathRelocation};
use crate::remote::{
    cache::is_remote_uri,
    repository::{get_song_cache_path, get_source_for_remote_uri},
    webdav,
};
use lofty::config::WriteOptions;
use lofty::file::{AudioFile, TaggedFileExt};
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::tag::{ItemKey, ItemValue, Tag, TagItem};
use rusqlite::{params, OptionalExtension, TransactionBehavior};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use tauri::{Emitter, State};
use uuid::Uuid;

use super::utils::{is_supported_library_extension, normalize_path};

const SIDECAR_LYRIC_EXTENSIONS: &[&str] = &["ttml", "yrc", "qrc", "lys", "lrc", "txt"];

#[derive(Serialize)]
pub struct MovedMusicFilePath {
    old_path: String,
    new_path: String,
}

#[derive(Serialize)]
pub struct BatchMoveMusicFilesResult {
    moved_paths: Vec<MovedMusicFilePath>,
}

#[derive(Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SongLyricsSource {
    pub raw_lyrics: String,
    pub source_format: Option<String>,
    pub source_path: Option<String>,
}

fn read_sidecar_lrc_with_path(path_obj: &Path) -> Option<(String, PathBuf)> {
    let stem = path_obj.file_stem()?.to_string_lossy().to_string();
    let parent = path_obj.parent()?;

    // 仅自动发现同名侧边文件时按信息完整度排序；用户指定的 source_path 不走这里。
    let candidates = fs::read_dir(parent)
        .ok()?
        .flatten()
        .map(|entry| entry.path())
        .filter(|candidate| candidate.is_file())
        .collect::<Vec<_>>();

    for ext in SIDECAR_LYRIC_EXTENSIONS {
        let exact_path = parent.join(format!("{}.{}", stem, ext));
        if let Ok(content) = fs::read_to_string(&exact_path) {
            return Some((content, exact_path));
        }

        if let Some(candidate) = candidates.iter().find(|candidate| {
            let candidate_stem = candidate
                .file_stem()
                .map(|value| value.to_string_lossy())
                .unwrap_or_default();
            let candidate_ext = candidate
                .extension()
                .map(|value| value.to_string_lossy())
                .unwrap_or_default();
            candidate_stem.eq_ignore_ascii_case(&stem) && candidate_ext.eq_ignore_ascii_case(ext)
        }) {
            if let Ok(content) = fs::read_to_string(candidate) {
                return Some((content, candidate.clone()));
            }
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
    conn: &rusqlite::Connection,
    moved_paths: &[(String, String)],
) -> Result<(), String> {
    // The caller owns the transaction so database failures happen before files move.
    for (table, column) in [
        ("songs", "path"),
        ("play_history", "song_path"),
        ("song_loudness", "song_path"),
        ("song_highlight_paths", "path"),
    ] {
        let mut update = conn
            .prepare(&format!(
                "UPDATE {table} SET {column} = ?1 WHERE {column} = ?2"
            ))
            .map_err(|e| e.to_string())?;
        for (old_path, new_path) in moved_paths {
            update
                .execute(params![new_path, old_path])
                .map_err(|e| format!("更新歌曲关联路径失败（{old_path}）：{e}"))?;
        }
    }
    Ok(())
}

#[derive(Clone)]
struct PlannedMusicFileMove {
    source: PathBuf,
    destination: PathBuf,
}

struct MusicFileMovePlan {
    songs: Vec<PlannedMusicFileMove>,
    files: Vec<PlannedMusicFileMove>,
}

fn move_path_key(path: &Path) -> String {
    let path = normalize_path(&path.to_string_lossy()).replace('\\', "/");
    if cfg!(windows) {
        path.to_lowercase()
    } else {
        path
    }
}

fn require_regular_move_file(path: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(path)
        .map_err(|e| format!("无法读取源文件 {}：{e}", path.display()))?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(format!(
            "只能移动本地常规文件，不支持目录或符号链接：{}",
            path.display()
        ));
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        if metadata.file_attributes() & 0x400 != 0 {
            return Err(format!(
                "暂不支持移动链接或重解析点文件：{}",
                path.display()
            ));
        }
    }
    Ok(())
}

fn canonical_audio_move_source(path: &Path) -> Result<PathBuf, String> {
    let raw = path.to_string_lossy();
    if raw.contains("://") || raw.contains("::track") {
        return Err(format!(
            "只能移动本地音频文件；CUE 分轨请移动整个所在文件夹：{raw}"
        ));
    }
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !is_supported_library_extension(&extension) {
        return Err(format!(
            "不支持直接移动此文件；CUE 分轨请移动整个所在文件夹：{raw}"
        ));
    }
    require_regular_move_file(path)?;
    fs::canonicalize(path).map_err(|e| format!("源文件不可访问（{raw}）：{e}"))
}

fn canonical_move_directory(path: &Path) -> Result<PathBuf, String> {
    let resolved = fs::canonicalize(path)
        .map_err(|e| format!("目标文件夹不可访问（{}）：{e}", path.display()))?;
    if !resolved.is_dir() {
        return Err(format!("目标路径不是文件夹：{}", path.display()));
    }
    Ok(resolved)
}

fn require_unused_move_destination(path: &Path) -> Result<(), String> {
    match fs::symlink_metadata(path) {
        Ok(_) => Err(format!(
            "目标位置已有同名文件或目录，不会覆盖：{}",
            path.display()
        )),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("无法检查目标位置（{}）：{error}", path.display())),
    }
}

fn prepare_music_file_moves(
    requests: Vec<(PathBuf, PathBuf)>,
) -> Result<MusicFileMovePlan, String> {
    let mut songs = Vec::new();
    let mut seen_sources = HashSet::new();
    for (source, destination) in requests {
        let source = canonical_audio_move_source(&source)?;
        if !seen_sources.insert(move_path_key(&source)) {
            continue;
        }
        let parent = destination.parent().ok_or("目标文件缺少父文件夹")?;
        let name = destination.file_name().ok_or("目标文件名无效")?;
        let destination = canonical_move_directory(parent)?.join(name);
        if move_path_key(&source) == move_path_key(&destination) {
            continue;
        }
        songs.push(PlannedMusicFileMove {
            source,
            destination,
        });
    }

    let selected: HashSet<String> = songs
        .iter()
        .map(|entry| move_path_key(&entry.source))
        .collect();
    let mut files = songs.clone();
    let mut directory_entries: HashMap<PathBuf, Vec<PathBuf>> = HashMap::new();
    for song in &songs {
        let parent = song.source.parent().ok_or("源文件缺少父文件夹")?;
        if !directory_entries.contains_key(parent) {
            let entries = fs::read_dir(parent)
                .map_err(|e| format!("无法检查配套歌词（{}）：{e}", parent.display()))?
                .map(|entry| entry.map(|entry| entry.path()))
                .collect::<Result<Vec<_>, _>>()
                .map_err(|e| format!("无法读取源文件夹（{}）：{e}", parent.display()))?;
            directory_entries.insert(parent.to_path_buf(), entries);
        }
        let entries = &directory_entries[parent];
        let stem = song
            .source
            .file_stem()
            .ok_or("源文件名无效")?
            .to_string_lossy();
        let mut sidecars = Vec::new();
        let mut has_unselected_same_stem_audio = false;
        for entry in entries {
            // A directory named Song.lrc/Song.mp3 is not a lyric or shared audio file.
            if entry.is_dir() {
                continue;
            }
            let extension = entry
                .extension()
                .and_then(|value| value.to_str())
                .unwrap_or_default()
                .to_ascii_lowercase();
            if extension == "cue" {
                if let Ok(sheet) = super::cue::parse_cue_file(entry) {
                    if move_path_key(&sheet.resolved_audio_path) == move_path_key(&song.source) {
                        return Err(format!(
                            "音频被 CUE 分轨引用，请移动整个所在文件夹：{}",
                            song.source.display()
                        ));
                    }
                }
            }
            let same_stem = entry
                .file_stem()
                .map(|value| value.to_string_lossy())
                .is_some_and(|value| value.eq_ignore_ascii_case(&stem));
            if !same_stem {
                continue;
            }
            if SIDECAR_LYRIC_EXTENSIONS.contains(&extension.as_str()) {
                require_regular_move_file(entry)?;
                sidecars.push(entry);
            } else if is_supported_library_extension(&extension)
                && !selected.contains(&move_path_key(entry))
            {
                has_unselected_same_stem_audio = true;
            }
        }
        if !sidecars.is_empty() && has_unselected_same_stem_audio {
            return Err(format!(
                "同名歌词也被其他音频使用，请将同名音频一起移动，或移动整个文件夹：{}",
                song.source.display()
            ));
        }
        for sidecar in sidecars {
            let target_stem = song
                .destination
                .file_stem()
                .ok_or("目标文件名无效")?
                .to_string_lossy();
            let extension = sidecar
                .extension()
                .ok_or("配套歌词扩展名无效")?
                .to_string_lossy();
            files.push(PlannedMusicFileMove {
                source: sidecar.clone(),
                destination: song
                    .destination
                    .parent()
                    .ok_or("目标文件缺少父文件夹")?
                    .join(format!("{target_stem}.{extension}")),
            });
        }
    }

    let mut unique_files = Vec::new();
    let mut destinations = HashMap::new();
    let mut sources = HashMap::new();
    for file in files {
        let source_key = move_path_key(&file.source);
        let destination_key = move_path_key(&file.destination);
        if let Some(previous) = sources.get(&source_key) {
            if previous == &destination_key {
                continue;
            }
            return Err(format!(
                "同一配套文件不能移动到多个位置：{}",
                file.source.display()
            ));
        }
        if destinations.contains_key(&destination_key) {
            return Err(format!(
                "所选歌曲或歌词在目标位置重名，不会覆盖：{}",
                file.destination.display()
            ));
        }
        require_unused_move_destination(&file.destination)?;
        destinations.insert(destination_key.clone(), source_key.clone());
        sources.insert(source_key, destination_key);
        unique_files.push(file);
    }
    Ok(MusicFileMovePlan {
        songs,
        files: unique_files,
    })
}

/// Unlike std::fs::rename, never replace a file that appeared after preflight.
/// No cross-volume copy/delete fallback is used.
#[cfg(windows)]
fn move_file_without_replacing(source: &Path, destination: &Path) -> std::io::Result<()> {
    use std::os::windows::ffi::OsStrExt;
    #[link(name = "kernel32")]
    extern "system" {
        fn MoveFileExW(existing: *const u16, target: *const u16, flags: u32) -> i32;
    }
    let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
    let destination: Vec<u16> = destination
        .as_os_str()
        .encode_wide()
        .chain(Some(0))
        .collect();
    // Zero flags forbid both MOVEFILE_REPLACE_EXISTING and MOVEFILE_COPY_ALLOWED.
    if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) } == 0 {
        Err(std::io::Error::last_os_error())
    } else {
        Ok(())
    }
}

#[cfg(not(windows))]
fn move_file_without_replacing(source: &Path, destination: &Path) -> std::io::Result<()> {
    // A same-volume hard link is an exclusive destination claim, without a copy.
    fs::hard_link(source, destination)?;
    if let Err(error) = fs::remove_file(source) {
        if let Err(cleanup) = fs::remove_file(destination) {
            return Err(std::io::Error::new(
                error.kind(),
                format!(
                    "源文件仍保留，目标另有硬链接 {}；清理失败：{cleanup}；{error}",
                    destination.display()
                ),
            ));
        }
        return Err(error);
    }
    Ok(())
}

fn rollback_music_file_moves(moved: &[&PlannedMusicFileMove]) -> String {
    let mut failures = Vec::new();
    for file in moved.iter().rev() {
        if let Err(error) = move_file_without_replacing(&file.destination, &file.source) {
            failures.push(format!(
                "{}（原位置：{}；{error}）",
                file.destination.display(),
                file.source.display()
            ));
        }
    }
    if failures.is_empty() {
        "本次已移动的文件已恢复原位置。".to_string()
    } else {
        format!(
            "部分文件无法恢复，请勿再次移动；仍需检查以下目标位置：{}",
            failures.join("；")
        )
    }
}

fn execute_music_file_moves(
    conn: &mut rusqlite::Connection,
    plan: MusicFileMovePlan,
) -> Result<BatchMoveMusicFilesResult, String> {
    if plan.songs.is_empty() {
        return Ok(BatchMoveMusicFilesResult {
            moved_paths: Vec::new(),
        });
    }
    let moved_paths: Vec<(String, String)> = plan
        .songs
        .iter()
        .map(|entry| {
            (
                normalize_path(&entry.source.to_string_lossy()),
                normalize_path(&entry.destination.to_string_lossy()),
            )
        })
        .collect();
    let tx = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|e| e.to_string())?;
    for (source, _) in &moved_paths {
        let cue_reference: bool = tx.query_row(
            "SELECT EXISTS(SELECT 1 FROM songs WHERE cue_source_path = ?1 OR (path = ?1 AND cue_source_path IS NOT NULL))",
            [source], |row| row.get(0),
        ).map_err(|e| format!("检查 CUE 引用失败，文件未移动：{e}"))?;
        if cue_reference {
            return Err(format!(
                "音频被 CUE 分轨引用，请移动整个所在文件夹：{source}"
            ));
        }
    }
    sync_moved_song_paths(&tx, &moved_paths)
        .map_err(|error| format!("保存路径失败，文件未移动：{error}"))?;
    let mut moved = Vec::new();
    for file in &plan.files {
        if let Err(error) = move_file_without_replacing(&file.source, &file.destination) {
            return Err(format!(
                "移动失败（可能跨磁盘、文件被占用或权限不足）：{} → {}；{error}。{}",
                file.source.display(),
                file.destination.display(),
                rollback_music_file_moves(&moved)
            ));
        }
        moved.push(file);
    }
    if let Err(error) = tx.commit() {
        return Err(format!(
            "保存移动结果失败：{error}。{}",
            rollback_music_file_moves(&moved)
        ));
    }
    Ok(BatchMoveMusicFilesResult {
        moved_paths: moved_paths
            .into_iter()
            .map(|(old_path, new_path)| MovedMusicFilePath { old_path, new_path })
            .collect(),
    })
}

fn read_local_song_lyrics_source(path: &str) -> SongLyricsSource {
    let path_obj = Path::new(path);
    if let Some((raw_lyrics, source_path)) = read_sidecar_lrc_with_path(path_obj) {
        return SongLyricsSource {
            raw_lyrics,
            source_format: source_path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(str::to_ascii_lowercase),
            source_path: Some(normalize_path(&source_path.to_string_lossy())),
        };
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(path_obj) {
        if let Some(raw_lyrics) = extract_embedded_lyrics(&tagged_file) {
            return SongLyricsSource {
                raw_lyrics,
                // The audio extension does not identify its embedded lyric format.
                source_format: None,
                source_path: Some(normalize_path(path)),
            };
        }
    }

    SongLyricsSource::default()
}

fn remote_sidecar_lyrics_source(
    raw_lyrics: String,
    source_id: &str,
    lrc_path: &str,
) -> SongLyricsSource {
    SongLyricsSource {
        raw_lyrics,
        source_format: Some("lrc".to_string()),
        // Use the app's credential-free identifier, never the authenticated WebDAV URL.
        source_path: Some(format!(
            "remote://{}/{}",
            source_id,
            lrc_path.trim_start_matches('/')
        )),
    }
}

async fn read_remote_song_lyrics_source(path: &str, db_state: &DbState) -> SongLyricsSource {
    let lookup_and_cache = {
        let conn = match db_state.conn.lock() {
            Ok(conn) => conn,
            Err(_) => return SongLyricsSource::default(),
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
        let lyrics_source = read_local_song_lyrics_source(&cache_path);
        if !lyrics_source.raw_lyrics.trim().is_empty() {
            return lyrics_source;
        }
    }

    let Some((source, remote_path, _etag, _stored_remote_uri)) = lookup else {
        return SongLyricsSource::default();
    };
    let Some(lrc_path) = remote_sidecar_lrc_path(&remote_path) else {
        return SongLyricsSource::default();
    };

    webdav::read_text_file(&source, &lrc_path)
        .await
        .ok()
        .flatten()
        .map(|raw_lyrics| remote_sidecar_lyrics_source(raw_lyrics, &source.id, &lrc_path))
        .unwrap_or_default()
}

async fn read_song_lyrics_source_for_path(path: &str, db_state: &DbState) -> SongLyricsSource {
    if is_remote_uri(path) {
        read_remote_song_lyrics_source(path, db_state).await
    } else {
        read_local_song_lyrics_source(path)
    }
}

async fn read_song_lyrics_raw_for_path(path: &str, db_state: &DbState) -> String {
    read_song_lyrics_source_for_path(path, db_state)
        .await
        .raw_lyrics
}

#[tauri::command]
pub async fn get_song_lyrics_source(
    path: String,
    db_state: State<'_, DbState>,
) -> Result<SongLyricsSource, String> {
    Ok(read_song_lyrics_source_for_path(&path, &db_state).await)
}

#[tauri::command]
pub async fn get_song_lyrics(path: String, db_state: State<'_, DbState>) -> Result<String, String> {
    Ok(read_song_lyrics_raw_for_path(&path, &db_state).await)
}

#[tauri::command]
pub async fn get_song_lyrics_for_edit(path: String) -> Result<SongLyricsForEdit, String> {
    let path_obj = Path::new(&path);
    if let Some((content, lrc_path)) = read_sidecar_lrc_with_path(path_obj) {
        return Ok(SongLyricsForEdit {
            lyrics: content,
            source: LyricsStorageSource::Sidecar,
            source_path: Some(normalize_path(&lrc_path.to_string_lossy())),
        });
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(path_obj) {
        if let Some(lyrics) = extract_embedded_lyrics(&tagged_file) {
            return Ok(SongLyricsForEdit {
                lyrics,
                source: LyricsStorageSource::Embedded,
                source_path: None,
            });
        }
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

#[tauri::command]
pub async fn refresh_song_metadata(
    app: tauri::AppHandle,
    path: String,
    db_state: State<'_, DbState>,
) -> Result<SaveSongInfoResponse, String> {
    if is_remote_uri(&path) {
        return Err("远程歌曲暂不支持从本地文件刷新标签".to_string());
    }
    if path.to_ascii_lowercase().contains(".cue::track") {
        return Err("CUE 分轨请在本地音乐中刷新所属文件夹，以保留完整的轨道信息".to_string());
    }

    let db_conn = db_state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let normalized_path = normalize_path(&path);
        let existing = {
            let conn = db_conn.lock().map_err(|error| error.to_string())?;
            conn.query_row(
                "SELECT path, id, cue_source_path, cue_start_offset, cue_end_offset, added_at,
                        album, album_artist, album_key, is_various_artists_album, collapse_artist_credits
                 FROM songs WHERE path = ?1 OR path = ?2
                 ORDER BY path = ?1 DESC LIMIT 1",
                params![&path, &normalized_path],
                |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        row.get::<_, i64>(1)?,
                        row.get::<_, Option<String>>(2)?,
                        row.get::<_, Option<i64>>(3)?,
                        row.get::<_, Option<i64>>(4)?,
                        row.get::<_, Option<i64>>(5)?,
                        (
                            row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                            row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                            row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                            row.get::<_, Option<i64>>(9)?.unwrap_or(0) != 0,
                            row.get::<_, Option<i64>>(10)?.unwrap_or(0) != 0,
                        ),
                    ))
                },
            )
            .optional()
            .map_err(|error| error.to_string())?
        };
        if existing.as_ref().is_some_and(|record| record.2.is_some()) {
            return Err("CUE 分轨请在本地音乐中刷新所属文件夹，以保留完整的轨道信息".to_string());
        }

        let path_obj = Path::new(&normalized_path);
        let extension = path_obj
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase())
            .unwrap_or_default();
        if extension == "cue" {
            return Err("CUE 分轨请在本地音乐中刷新所属文件夹，以保留完整的轨道信息".to_string());
        }
        if !is_supported_library_extension(&extension) {
            return Err("当前文件格式暂不支持刷新歌曲标签".to_string());
        }
        let before = fs::metadata(path_obj)
            .map_err(|error| format!("无法读取歌曲文件，已保留原有信息：{error}"))?;
        if !before.is_file() || before.len() == 0 {
            return Err("歌曲文件不存在或尚未保存完成，已保留原有信息".to_string());
        }

        // Tag reads must succeed before using the scanner's audio-property fallback.
        // Derive every editable field from this successful read, so a later
        // permissive scanner read cannot replace existing tags with placeholders.
        let tagged_file = read_tagged_file_from_path(path_obj)
            .map_err(|error| format!("读取歌曲标签失败，已保留原有信息：{error}"))?;
        let retained_path = existing
            .as_ref()
            .map(|record| record.0.as_str())
            .unwrap_or(&path);
        let mut song = parse_song_from_file(path_obj, retained_path, &extension)
            .ok_or_else(|| "无法完整读取歌曲信息，已保留原有信息".to_string())?;
        if song.duration == 0 || song.sample_rate == 0 {
            return Err("歌曲文件尚未保存完成或无法读取音频信息，已保留原有信息".to_string());
        }
        song.title.clear();
        song.artist = super::scanner::UNKNOWN_ARTIST.to_string();
        song.album = super::scanner::UNKNOWN_ALBUM.to_string();
        song.album_artist.clear();
        super::scanner::fill_text_fields_from_tags(
            &tagged_file,
            &mut song.artist,
            &mut song.album,
            &mut song.title,
            &mut song.album_artist,
        );
        if song.title.trim().is_empty() {
            song.title = path_obj
                .file_stem()
                .unwrap_or_default()
                .to_string_lossy()
                .to_string();
        }
        let tagged_album_artist = song.album_artist.clone();
        if song.album_artist.trim().is_empty() {
            song.album_artist = song.artist.clone();
        }
        song.artist_names = super::scanner::split_artist_names(&song.artist);
        song.effective_artist_names = song.artist_names.clone();
        song.album_key = super::scanner::build_album_key(&song.album, &song.album_artist);
        let tag_detail = extract_detail_metadata(&tagged_file);
        song.track_number = tag_detail.track_number.clone();
        song.disc_number = tag_detail.disc_number.clone();
        song.comment = tag_detail.comment.clone();
        if let Some((_, id, source, start, end, added_at, group)) = existing.as_ref() {
            song.id = Some(*id);
            song.cue_source_path = source.clone();
            song.cue_start_offset = start.map(|value| value as u32);
            song.cue_end_offset = end.map(|value| value as u32);
            song.added_at = added_at
                .filter(|value| *value >= 0)
                .map(|value| value as u64);

            // Album grouping is derived from every track in the folder. A
            // one-file refresh must retain it unless the file changes its album
            // or explicitly chooses a different group artist. Album artist tags
            // equal to the track artist are ignored by the folder grouping too.
            let (album, album_artist, album_key, is_various, collapse) = group;
            if song.album.trim().eq_ignore_ascii_case(album.trim())
                && !album_artist.trim().is_empty()
                && !album_key.trim().is_empty()
                && (tagged_album_artist.is_empty()
                    || tagged_album_artist.eq_ignore_ascii_case(&song.artist)
                    || tagged_album_artist.eq_ignore_ascii_case(album_artist))
            {
                song.album_artist = album_artist.clone();
                song.album_key = album_key.clone();
                song.is_various_artists_album = *is_various;
                song.collapse_artist_credits = *collapse;
                song.effective_artist_names = if *collapse {
                    vec![super::scanner::VARIOUS_ARTISTS.to_string()]
                } else {
                    song.artist_names.clone()
                };
            }
        }
        let detail = SongDetail {
            path: song.path.clone(),
            genre: tag_detail.genre,
            year: tag_detail.year,
            track_number: tag_detail.track_number,
            disc_number: tag_detail.disc_number,
            comment: tag_detail.comment,
            container: song.container.clone(),
            codec: song.codec.clone(),
            file_size: Some(song.file_size),
            bitrate: Some(song.bitrate),
            sample_rate: Some(song.sample_rate),
            bit_depth: song.bit_depth,
            format: Some(song.format.clone()),
        };

        let after = fs::metadata(path_obj)
            .map_err(|error| format!("歌曲文件正在保存，请稍后重试：{error}"))?;
        if !after.is_file()
            || before.len() != after.len()
            || before.modified().ok() != after.modified().ok()
        {
            return Err("歌曲文件正在保存，请稍后重试，已保留原有信息".to_string());
        }
        super::covers::invalidate_song_cover_cache(path_obj, &app)?;

        if song.id.is_some() {
            let mut conn = db_conn.lock().map_err(|error| error.to_string())?;
            if load_song_id(&conn, &song.path)? != song.id {
                return Err("歌曲位置已变化，请重新打开歌曲信息后刷新".to_string());
            }
            // Refresh only retained rows. Opening an external file must not import
            // it into the library; remote-source/cache columns remain untouched.
            apply_scan_changes(&mut conn, &[], std::slice::from_ref(&song), &[], None)?;
        }

        Ok(SaveSongInfoResponse { song, detail })
    })
    .await
    .map_err(|error| error.to_string())?
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
    app: tauri::AppHandle,
) -> Result<BatchMoveMusicFilesResult, CommandError> {
    let target = canonical_move_directory(Path::new(&target_folder))
        .map_err(|error| CommandError::new("INVALID_MOVE_TARGET", &error))?;
    let mut requests = Vec::new();
    for path_str in paths {
        let source = PathBuf::from(path_str);
        let name = source
            .file_name()
            .ok_or_else(|| CommandError::new("INVALID_MOVE_SOURCE", "源文件名无效"))?;
        let destination = target.join(name);
        requests.push((source, destination));
    }
    let plan = prepare_music_file_moves(requests)
        .map_err(|error| CommandError::new("MOVE_PRECHECK_FAILED", &error))?;
    let mut conn = db_state
        .conn
        .lock()
        .map_err(|error| CommandError::new("DB_LOCK_FAILED", &error.to_string()))?;
    let result = execute_music_file_moves(&mut conn, plan)
        .map_err(|error| CommandError::new("MOVE_FAILED", &error))?;
    drop(conn);
    notify_moved_music_files(&app, &result);
    Ok(result)
}

fn notify_moved_music_files(app: &tauri::AppHandle, result: &BatchMoveMusicFilesResult) {
    if result.moved_paths.is_empty() {
        return;
    }
    notify_audio_paths_relocated(
        app,
        AudioPathRelocation::Files(
            result
                .moved_paths
                .iter()
                .map(|entry| (entry.old_path.clone(), entry.new_path.clone()))
                .collect(),
        ),
    );
}

#[tauri::command]
pub fn move_music_file(
    old_path: String,
    new_path: String,
    db_state: State<'_, DbState>,
    app: tauri::AppHandle,
) -> Result<(), String> {
    let source = canonical_audio_move_source(Path::new(&old_path))?;
    let destination = PathBuf::from(new_path);
    if let Some(parent) = destination.parent() {
        if !parent.exists() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
    }
    let plan = prepare_music_file_moves(vec![(source, destination)])?;
    let mut conn = db_state.conn.lock().map_err(|e| e.to_string())?;
    let result = execute_music_file_moves(&mut conn, plan)?;
    drop(conn);
    notify_moved_music_files(&app, &result);
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
    stmt.execute([&normalized_path])
        .map_err(|e| e.to_string())?;

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
    use id3::frame::Comment;
    use id3::{TagLike, Version};
    use rusqlite::Connection;
    use std::sync::{Arc, Mutex};
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn lyrics_source_command_is_registered_and_allowed() {
        let app_entrypoint = include_str!("../lib.rs");
        let command_permissions = include_str!("../../permissions/app-commands.toml");

        assert!(app_entrypoint.contains("\n            get_song_lyrics_source,"));
        assert!(command_permissions.contains("\"get_song_lyrics_source\""));
    }

    #[test]
    fn remote_sidecar_lrc_path_uses_remote_song_parent_and_stem() {
        assert_eq!(
            remote_sidecar_lrc_path("/Artist/Album/Demo.flac").as_deref(),
            Some("/Artist/Album/Demo.lrc")
        );
    }

    #[test]
    fn remote_sidecar_lyrics_source_serializes_only_credential_free_metadata() {
        let source = remote_sidecar_lyrics_source(
            "[00:01.00]remote lyric".to_string(),
            "source-id",
            "/Artist/Album/Demo.lrc",
        );

        assert_eq!(
            serde_json::to_value(source).unwrap(),
            serde_json::json!({
                "rawLyrics": "[00:01.00]remote lyric",
                "sourceFormat": "lrc",
                "sourcePath": "remote://source-id/Artist/Album/Demo.lrc",
            })
        );
    }

    #[test]
    fn missing_local_lyrics_source_has_no_format_or_path() {
        let path = std::env::temp_dir()
            .join(format!("lycia_missing_lyrics_{}", Uuid::new_v4()))
            .join("Demo.flac");

        let source = read_local_song_lyrics_source(path.to_str().unwrap());

        assert_eq!(
            serde_json::to_value(source).unwrap(),
            serde_json::json!({
                "rawLyrics": "",
                "sourceFormat": null,
                "sourcePath": null,
            })
        );
    }

    #[test]
    fn local_lyrics_source_preserves_raw_text_and_format_hints_without_parsing() {
        let dir = std::env::temp_dir().join(format!("lycia_lyrics_source_{}", Uuid::new_v4()));
        fs::create_dir_all(&dir).unwrap();
        let raw_lyrics = "\u{feff} unparsed lyric content\r\n";

        for extension in ["yrc", "qrc", "lys", "lrc", "txt"] {
            let audio = dir.join(format!("Demo-{extension}.flac"));
            let sidecar = audio.with_extension(extension.to_ascii_uppercase());
            fs::write(&audio, b"not real audio").unwrap();
            fs::write(&sidecar, raw_lyrics).unwrap();

            let source = read_local_song_lyrics_source(audio.to_str().unwrap());

            assert_eq!(source.raw_lyrics, raw_lyrics);
            assert_eq!(source.source_format.as_deref(), Some(extension));
            assert_eq!(
                source.source_path,
                Some(normalize_path(&sidecar.to_string_lossy()))
            );
        }

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn local_sidecar_discovery_prefers_ttml_even_with_uppercase_extension() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lycia_sidecar_priority_test_{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let audio = dir.join("Demo.flac");
        let lrc = dir.join("Demo.lrc");
        let ttml = dir.join("Demo.TTML");
        fs::write(&audio, b"not real audio").unwrap();
        fs::write(&lrc, "[00:01.00]lrc").unwrap();
        fs::write(&ttml, "<tt></tt>").unwrap();

        let (lyrics, path) = read_sidecar_lrc_with_path(&audio).expect("sidecar lyrics");

        assert_eq!(lyrics, "<tt></tt>");
        assert!(path
            .file_name()
            .is_some_and(|name| name.eq_ignore_ascii_case(ttml.file_name().unwrap())));

        let source = read_local_song_lyrics_source(audio.to_str().unwrap());
        assert_eq!(source.raw_lyrics, "<tt></tt>");
        assert_eq!(source.source_format.as_deref(), Some("ttml"));
        assert_eq!(
            source.source_path,
            Some(normalize_path(&ttml.to_string_lossy()))
        );
        let _ = fs::remove_dir_all(dir);
    }

    #[tokio::test]
    async fn local_sidecar_lyrics_override_embedded_lyrics() {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lycia_sidecar_override_test_{unique}"));
        fs::create_dir_all(&dir).unwrap();
        let audio = dir.join("Demo.mp3");
        let lrc = dir.join("Demo.lrc");

        let mut id3_tag = id3::Tag::new();
        id3_tag.add_frame(Comment {
            lang: "eng".to_string(),
            description: "lyrics".to_string(),
            text: "[00:01.00]embedded lyric".to_string(),
        });
        let mut audio_bytes = Vec::new();
        id3_tag.write_to(&mut audio_bytes, Version::Id3v24).unwrap();
        audio_bytes.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x64]);
        audio_bytes.extend(std::iter::repeat(0).take(413));
        fs::write(&audio, audio_bytes).unwrap();

        let embedded_source = read_local_song_lyrics_source(audio.to_str().unwrap());
        assert_eq!(embedded_source.raw_lyrics, "[00:01.00]embedded lyric");
        assert_eq!(embedded_source.source_format, None);
        assert_eq!(
            embedded_source.source_path,
            Some(normalize_path(&audio.to_string_lossy()))
        );

        fs::write(&lrc, "[00:01.00]sidecar lyric").unwrap();

        let source = read_local_song_lyrics_source(audio.to_str().unwrap());
        assert_eq!(source.raw_lyrics, "[00:01.00]sidecar lyric");
        assert_eq!(source.source_format.as_deref(), Some("lrc"));
        assert_eq!(
            source.source_path,
            Some(normalize_path(&lrc.to_string_lossy()))
        );

        let editable = get_song_lyrics_for_edit(audio.to_string_lossy().into_owned())
            .await
            .unwrap();
        assert_eq!(editable.lyrics, "[00:01.00]sidecar lyric");
        assert_eq!(editable.source, LyricsStorageSource::Sidecar);
        assert_eq!(editable.source_path.as_deref(), lrc.to_str());

        let _ = fs::remove_dir_all(dir);
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

        let source =
            read_remote_song_lyrics_source("remote://source/Artist/Album/Demo.flac", &db_state)
                .await;

        assert_eq!(source.raw_lyrics, "[00:01.00]cached lyric");
        assert_eq!(source.source_format.as_deref(), Some("lrc"));
        assert_eq!(
            source.source_path,
            Some(normalize_path(&cached_lrc.to_string_lossy()))
        );
        assert_eq!(
            read_song_lyrics_raw_for_path("remote://source/Artist/Album/Demo.flac", &db_state)
                .await,
            source.raw_lyrics
        );
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
        assert_eq!(
            metadata.cue_source_path.as_deref(),
            Some("/music/album.flac")
        );
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
    app: tauri::AppHandle,
) -> Result<(), String> {
    batch_move_music_files(vec![source_path], target_folder, db_state, app)
        .map(|_| ())
        .map_err(|error| error.message)
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
    let bytes_read = file
        .read(&mut header)
        .map_err(|e| format!("Failed to read image header: {}", e))?;

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
    file.seek(std::io::SeekFrom::Start(0))
        .map_err(|e| format!("Failed to seek image file: {}", e))?;

    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 8192];
    loop {
        let n = file
            .read(&mut buffer)
            .map_err(|e| format!("Failed to read image file for hashing: {}", e))?;
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
    fs::copy(path, &target_path)
        .map_err(|e| format!("Failed to copy image to covers directory: {}", e))?;

    let target_path_str = normalize_path(&target_path.to_string_lossy());

    // Update database & query song paths in a short-lived transaction block
    let (songs_info, task_id) = if write_to_tags {
        let conn = db_state.conn.lock().map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE artists SET avatar_path = ?1 WHERE id = ?2",
            params![Some(&target_path_str), artist_id],
        )
        .map_err(|e| format!("Failed to update database: {}", e))?;

        let mut stmt = conn
            .prepare(
                "SELECT s.path, s.source_type, s.remote_source_id, s.cue_source_path, \
             (SELECT COUNT(*) FROM song_artists sa2 WHERE sa2.song_id = s.id) AS artist_count \
             FROM songs s \
             INNER JOIN song_artists sa ON s.id = sa.song_id \
             WHERE sa.artist_id = ?1",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![artist_id], |row| {
                Ok(SongTagWriteInfo {
                    path: row.get(0)?,
                    source_type: row.get(1)?,
                    remote_source_id: row.get(2)?,
                    cue_source_path: row.get(3)?,
                    artist_count: row.get(4)?,
                })
            })
            .map_err(|e| e.to_string())?;

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
            let _ = app_clone.emit(
                "artist-avatar:write-tags-progress",
                super::types::WriteTagsProgressPayload {
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
                },
            );

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

                                                match tagged_file
                                                    .save_to_path(path_obj, WriteOptions::default())
                                                {
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
                            let _ = app_clone.emit(
                                "artist-avatar:write-tags-progress",
                                super::types::WriteTagsProgressPayload {
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
                                },
                            );
                        }
                    }
                    Err(e) => {
                        let error_msg = format!("Failed to read avatar cache: {}", e);
                        let _ = app_clone.emit(
                            "artist-avatar:write-tags-progress",
                            super::types::WriteTagsProgressPayload {
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
                            },
                        );
                        return;
                    }
                }
            }

            // Emit final done event
            let _ = app_clone.emit(
                "artist-avatar:write-tags-progress",
                super::types::WriteTagsProgressPayload {
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
                },
            );
        });
    }

    Ok(super::types::SaveArtistAvatarResponse {
        artist_id,
        avatar_path: target_path_str,
        task_id,
    })
}
