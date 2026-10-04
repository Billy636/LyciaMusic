use super::super::types::{FolderNode, GeneratedFolder, Song};
use super::super::utils::{
    descendant_like_patterns, describe_scan_io_error, is_dot_prefixed_path, normalize_path,
};
use super::diff::{collect_scan_diff, load_db_snapshot_for_folder};
use super::parser::parse_audio_files_internal;
use super::progress::ScanProgressReporter;
use super::repository::apply_scan_changes;
use super::ScanOptions;
use crate::database::DbState;
use rusqlite::{params, OptionalExtension};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, State};

struct ScanDirectoryOutcome {
    songs: Option<Vec<Song>>,
    paths: Option<Vec<String>>,
    song_count: usize,
}

#[derive(Clone, Copy, PartialEq)]
enum ScanResultMode {
    Songs,
    Paths,
    Summary,
}

pub fn scan_single_directory_internal(
    folder_path: String,
    db_conn: Arc<Mutex<rusqlite::Connection>>,
    app: Option<AppHandle>,
    folder_index: usize,
    folder_total: usize,
    options: ScanOptions,
) -> Result<Vec<Song>, String> {
    scan_single_directory_with_mode(
        folder_path,
        db_conn,
        app,
        folder_index,
        folder_total,
        options,
        ScanResultMode::Songs,
    )
    .map(|outcome| outcome.songs.unwrap_or_default())
}

pub(crate) fn scan_single_directory_summary_internal(
    folder_path: String,
    db_conn: Arc<Mutex<rusqlite::Connection>>,
    app: Option<AppHandle>,
    folder_index: usize,
    folder_total: usize,
    options: ScanOptions,
) -> Result<usize, String> {
    scan_single_directory_with_mode(
        folder_path,
        db_conn,
        app,
        folder_index,
        folder_total,
        options,
        ScanResultMode::Summary,
    )
    .map(|outcome| outcome.song_count)
}

fn scan_single_directory_with_mode(
    folder_path: String,
    db_conn: Arc<Mutex<rusqlite::Connection>>,
    app: Option<AppHandle>,
    folder_index: usize,
    folder_total: usize,
    options: ScanOptions,
    result_mode: ScanResultMode,
) -> Result<ScanDirectoryOutcome, String> {
    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    let normalized_folder = normalize_path(&folder_path);
    let reporter = app.as_ref().map(|app| {
        ScanProgressReporter::new(
            app.clone(),
            normalized_folder.clone(),
            folder_index,
            folder_total,
        )
    });

    let retain_existing = |message: String| -> Result<ScanDirectoryOutcome, String> {
        let message = format!("{message}；本次扫描未完成，保留已有记录，请恢复访问后重新扫描");
        eprintln!("[扫描] {message}");
        if let Some(reporter) = reporter.as_ref() {
            reporter.emit_error(message.clone());
        }
        if options.force_metadata_refresh {
            return Err(message);
        }
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        let snapshot = load_db_snapshot_for_folder(&conn, &normalized_folder)?;
        let song_count = snapshot.len();
        let paths =
            (result_mode == ScanResultMode::Paths).then(|| snapshot.keys().cloned().collect());
        let songs = (result_mode == ScanResultMode::Songs)
            .then(|| snapshot.into_values().map(|entry| entry.song).collect());
        Ok(ScanDirectoryOutcome {
            songs,
            paths,
            song_count,
        })
    };

    // Check before traversing, and once more before writing. No failure should
    // turn a temporarily unavailable share (or child directory) into deletions.
    if let Err(error) = fs::read_dir(&normalized_folder) {
        return retain_existing(describe_scan_io_error(
            Path::new(&normalized_folder),
            "访问文件夹",
            &error,
        ));
    }

    let db_snapshot = {
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        load_db_snapshot_for_folder(&conn, &normalized_folder)?
    };

    let mut scan_diff =
        match collect_scan_diff(&normalized_folder, db_snapshot, reporter.as_ref(), options) {
            Ok(diff) => diff,
            Err(error) => return retain_existing(error),
        };
    let song_count = scan_diff.songs.len();
    let paths = (result_mode == ScanResultMode::Paths).then(|| {
        scan_diff
            .songs
            .iter()
            .map(|song| song.path.clone())
            .collect()
    });
    if result_mode != ScanResultMode::Songs {
        scan_diff.songs = Vec::new();
    }

    if let Err(error) = fs::read_dir(&normalized_folder) {
        return retain_existing(describe_scan_io_error(
            Path::new(&normalized_folder),
            "扫描结束时访问文件夹",
            &error,
        ));
    }

    let covers_dir = app
        .as_ref()
        .map(|a| crate::music::covers::get_cover_cache_dir(a));

    if options.force_metadata_refresh {
        if let Some(app) = app.as_ref() {
            let mut refreshed_sources = HashSet::new();
            for song in scan_diff.to_add.iter().chain(scan_diff.to_update.iter()) {
                let source_path = song.cue_source_path.as_deref().unwrap_or(&song.path);
                if refreshed_sources.insert(source_path) {
                    if let Err(error) = crate::music::covers::invalidate_song_cover_cache(
                        Path::new(source_path),
                        app,
                    ) {
                        return retain_existing(error);
                    }
                }
            }
        }
    }

    // 按歌曲规范化路径进行稳定排序，保证入库及头像更新时序的唯一性
    scan_diff.to_add.sort_by(|a, b| a.path.cmp(&b.path));
    scan_diff.to_update.sort_by(|a, b| a.path.cmp(&b.path));

    // 缓存写盘并在结束后无条件释放字节内存
    for song in scan_diff
        .to_add
        .iter_mut()
        .chain(scan_diff.to_update.iter_mut())
    {
        if let Some(ref bytes) = song.artist_avatar_bytes {
            if let Some(ref dir) = covers_dir {
                if super::get_song_single_valid_artist(song).is_some() {
                    song.artist_avatar_path =
                        crate::music::covers::save_artist_avatar_auto(bytes, dir);
                }
            }
        }
        let _ = song.artist_avatar_bytes.take();
    }

    {
        let mut conn = db_conn.lock().map_err(|error| error.to_string())?;
        apply_scan_changes(
            &mut conn,
            &scan_diff.to_add,
            &scan_diff.to_update,
            &scan_diff.to_delete,
            reporter.as_ref(),
        )?;
    }

    if !scan_diff.to_add.is_empty()
        || !scan_diff.to_update.is_empty()
        || !scan_diff.to_delete.is_empty()
    {
        println!(
            "[刷新] 新增: {} 首, 更新: {} 首, 删除: {} 首",
            scan_diff.to_add.len(),
            scan_diff.to_update.len(),
            scan_diff.to_delete.len()
        );
    }

    if let Some(reporter) = reporter.as_ref() {
        reporter.emit_complete(song_count);
    }

    #[cfg(debug_assertions)]
    {
        let duration = start_time.elapsed();
        println!(
            "[Profiling] scan_single_directory_internal took {:?} (to_add: {}, to_update: {}, to_delete: {})",
            duration,
            scan_diff.to_add.len(),
            scan_diff.to_update.len(),
            scan_diff.to_delete.len()
        );
    }

    Ok(ScanDirectoryOutcome {
        songs: if result_mode == ScanResultMode::Songs {
            Some(scan_diff.songs)
        } else {
            None
        },
        paths,
        song_count,
    })
}

#[tauri::command]
pub async fn scan_music_folder(
    folder_path: String,
    minimum_duration_seconds: Option<u32>,
    force_metadata_refresh: Option<bool>,
    app: AppHandle,
    db_state: State<'_, DbState>,
) -> Result<Vec<Song>, String> {
    let db_conn = db_state.conn.clone();
    // A user-requested folder refresh must reread tags even when an external
    // editor preserves the audio file's size and modification timestamp.
    let options = ScanOptions {
        force_metadata_refresh: force_metadata_refresh.unwrap_or(false),
        ..ScanOptions::from_minimum_duration_seconds(minimum_duration_seconds)
    };

    tauri::async_runtime::spawn_blocking(move || {
        scan_single_directory_internal(folder_path, db_conn, Some(app), 1, 1, options)
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Folder refreshes only need membership; metadata stays in the database and is
/// fetched separately for records that are already materialized by the UI.
#[tauri::command]
pub async fn scan_music_folder_paths(
    folder_path: String,
    minimum_duration_seconds: Option<u32>,
    force_metadata_refresh: Option<bool>,
    app: AppHandle,
    db_state: State<'_, DbState>,
) -> Result<Vec<String>, String> {
    let db_conn = db_state.conn.clone();
    let options = ScanOptions {
        force_metadata_refresh: force_metadata_refresh.unwrap_or(false),
        ..ScanOptions::from_minimum_duration_seconds(minimum_duration_seconds)
    };
    tauri::async_runtime::spawn_blocking(move || {
        scan_single_directory_with_mode(
            folder_path,
            db_conn,
            Some(app),
            1,
            1,
            options,
            ScanResultMode::Paths,
        )
        .map(|outcome| outcome.paths.unwrap_or_default())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
pub async fn parse_audio_files(
    paths: Vec<String>,
    minimum_duration_seconds: Option<u32>,
) -> Result<Vec<Song>, String> {
    let options = ScanOptions::from_minimum_duration_seconds(minimum_duration_seconds);
    let result =
        tauri::async_runtime::spawn_blocking(move || parse_audio_files_internal(paths, options))
            .await
            .map_err(|error| error.to_string())?;

    Ok(result)
}

#[tauri::command]
pub async fn scan_folder_as_playlists(
    root_path: String,
    minimum_duration_seconds: Option<u32>,
    app: AppHandle,
    db_state: State<'_, DbState>,
) -> Result<Vec<GeneratedFolder>, String> {
    let songs = scan_music_folder(
        root_path.clone(),
        minimum_duration_seconds,
        None,
        app,
        db_state,
    )
    .await?;

    let mut grouped: HashMap<PathBuf, Vec<Song>> = HashMap::new();
    for song in songs {
        let path = PathBuf::from(&song.path);
        if let Some(parent) = path.parent() {
            grouped.entry(parent.to_path_buf()).or_default().push(song);
        }
    }

    let mut result = Vec::new();
    for (folder_path, folder_songs) in grouped {
        if folder_songs.is_empty() {
            continue;
        }

        let folder_name = folder_path
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| "未知文件夹".to_string());
        result.push(GeneratedFolder {
            name: folder_name,
            path: folder_path.to_string_lossy().into_owned(),
            songs: folder_songs,
        });
    }
    result.sort_by(|left, right| left.name.cmp(&right.name));
    Ok(result)
}

pub fn find_first_song_recursive(path: &Path, conn: &rusqlite::Connection) -> Option<String> {
    let path_str = normalize_path(&path.to_string_lossy());
    let (pattern_forward, pattern_back) = descendant_like_patterns(&path_str);

    let mut stmt = conn
        .prepare(
            "SELECT path
             FROM songs
             WHERE path = ?1
                OR path LIKE ?2 ESCAPE '^'
                OR path LIKE ?3 ESCAPE '^'
             ORDER BY path ASC
             LIMIT 1",
        )
        .ok()?;

    stmt.query_row(params![&path_str, pattern_forward, pattern_back], |row| {
        row.get(0)
    })
    .optional()
    .ok()?
}

fn count_songs_recursive(path: &Path, conn: &rusqlite::Connection) -> usize {
    let path_str = normalize_path(&path.to_string_lossy());
    let (pattern_forward, pattern_back) = descendant_like_patterns(&path_str);

    conn.query_row(
        "SELECT COUNT(*)
         FROM songs
         WHERE path = ?1
            OR path LIKE ?2 ESCAPE '^'
            OR path LIKE ?3 ESCAPE '^'",
        params![&path_str, pattern_forward, pattern_back],
        |row| row.get::<_, i64>(0),
    )
    .ok()
    .map(|count| count.max(0) as usize)
    .unwrap_or(0)
}

fn read_subdirectories(folder_path: &Path) -> Option<Vec<PathBuf>> {
    let read_dir = fs::read_dir(folder_path).ok()?;
    let mut subdirs: Vec<PathBuf> = read_dir
        .filter_map(|entry| entry.ok())
        .map(|entry| entry.path())
        .filter(|path| path.is_dir() && !is_dot_prefixed_path(path))
        .collect();

    subdirs.sort_by(|left, right| {
        let left_name = left
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| left.to_string_lossy().into_owned());
        let right_name = right
            .file_name()
            .map(|name| name.to_string_lossy().into_owned())
            .unwrap_or_else(|| right.to_string_lossy().into_owned());
        left_name.cmp(&right_name)
    });

    Some(subdirs)
}

#[tauri::command]
pub async fn get_folder_first_song(
    folder_path: String,
    db_state: State<'_, DbState>,
) -> Result<Option<String>, String> {
    let db_conn = db_state.conn.clone();

    tauri::async_runtime::spawn_blocking(move || {
        let conn = db_conn.lock().map_err(|error| error.to_string())?;
        let path = Path::new(&folder_path);
        Ok(find_first_song_recursive(path, &conn))
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn scan_folder_recursive(
    folder_path: PathBuf,
    current_depth: u32,
    max_depth: u32,
    conn: &rusqlite::Connection,
) -> Option<FolderNode> {
    if current_depth > max_depth {
        return None;
    }

    let normalized_path = normalize_path(&folder_path.to_string_lossy());
    let folder_name = folder_path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .filter(|name| !name.is_empty())
        .unwrap_or_else(|| normalized_path.clone());
    let song_count = count_songs_recursive(&folder_path, conn);
    let subdirs_opt = read_subdirectories(&folder_path);

    if subdirs_opt.is_none() {
        if current_depth == 0 {
            return Some(FolderNode {
                name: folder_name,
                path: normalized_path,
                children: Vec::new(),
                child_count: 0,
                children_loaded: true,
                song_count,
                cover_song_path: if song_count > 0 {
                    find_first_song_recursive(&folder_path, conn)
                } else {
                    None
                },
                is_expanded: false,
            });
        } else {
            return None;
        }
    }

    let subdirs = subdirs_opt.unwrap();
    let child_count = subdirs.len();
    let should_preload_children = current_depth < max_depth;
    let children = if should_preload_children {
        subdirs
            .iter()
            .filter_map(|subdir| {
                scan_folder_recursive(subdir.clone(), current_depth + 1, max_depth, conn)
            })
            .collect()
    } else {
        Vec::new()
    };

    Some(FolderNode {
        name: folder_name,
        path: normalized_path,
        children,
        child_count,
        children_loaded: should_preload_children || child_count == 0,
        song_count,
        cover_song_path: if song_count > 0 {
            find_first_song_recursive(&folder_path, conn)
        } else {
            None
        },
        is_expanded: false,
    })
}
