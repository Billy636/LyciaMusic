use crate::database::DbState;
use rusqlite::{params, TransactionBehavior};
use serde::Serialize;
use std::{fs, path::Path};
use tauri::State;

use super::utils::normalize_path;

#[derive(Serialize)]
pub struct FolderMoveResult {
    old_path: String,
    new_path: String,
}

fn path_key(path: &str) -> String {
    let value = path.replace('\\', "/").trim_end_matches('/').to_string();
    if cfg!(windows) {
        value.to_lowercase()
    } else {
        value
    }
}

fn in_folder(path: &str, folder: &str) -> bool {
    let path = path_key(path);
    let folder = path_key(folder);
    path == folder || path.starts_with(&format!("{folder}/"))
}

fn display_path(path: &Path) -> String {
    let text = path.to_string_lossy();
    if let Some(unc) = text.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{unc}")
    } else {
        text.strip_prefix(r"\\?\").unwrap_or(&text).to_string()
    }
}

fn relocated_path(path: &str, source: &str, destination: &str) -> Option<String> {
    if !in_folder(path, source) {
        return None;
    }
    // Use the original prefix length (not the case-folded string's byte length).
    let relative = path.replace('\\', "/");
    let prefix_len = source.replace('\\', "/").trim_end_matches('/').len();
    let suffix = relative.get(prefix_len..)?.trim_start_matches('/');
    Some(if suffix.is_empty() {
        destination.to_string()
    } else {
        Path::new(destination)
            .join(suffix.replace('/', std::path::MAIN_SEPARATOR_STR))
            .to_string_lossy()
            .into_owned()
    })
}

/// Move the complete directory, including artwork and lyric sidecars. Never merge.
#[tauri::command]
pub async fn move_folder_to_folder(
    source_path: String,
    target_folder: String,
    db_state: State<'_, DbState>,
) -> Result<FolderMoveResult, String> {
    let db = db_state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let source_metadata = fs::symlink_metadata(&source_path).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        {
            use std::os::windows::fs::MetadataExt;
            if source_metadata.file_attributes() & 0x400 != 0 {
                return Err("暂不支持移动目录链接或联接点".to_string());
            }
        }
        if source_metadata.file_type().is_symlink() {
            return Err("暂不支持移动符号链接文件夹".to_string());
        }
        let source = fs::canonicalize(&source_path).map_err(|e| format!("源文件夹不可访问：{e}"))?;
        let target = fs::canonicalize(&target_folder).map_err(|e| format!("目标文件夹不可访问：{e}"))?;
        if !source.is_dir() || !target.is_dir() {
            return Err("源路径和目标路径必须是文件夹".to_string());
        }
        let old_path = display_path(&source);
        let target_path = display_path(&target);
        if path_key(&source_path) != path_key(&old_path) {
            return Err("请从文件夹的原始完整路径操作，暂不支持通过目录链接移动".to_string());
        }
        if in_folder(&target_path, &old_path) {
            return Err("不能将文件夹移入自身或其子文件夹".to_string());
        }
        let name = source.file_name().ok_or("不能移动磁盘根目录")?;
        let destination = Path::new(&target_path).join(name);
        let new_path = display_path(&destination);
        if path_key(&old_path) == path_key(&new_path) {
            return Err("文件夹已在该目录中".to_string());
        }
        if fs::symlink_metadata(&destination).is_ok() {
            return Err("目标位置已有同名文件或文件夹，请先重命名；不会自动合并或覆盖".to_string());
        }

        let mut conn = db.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate).map_err(|e| e.to_string())?;
        let roots: Vec<String> = {
            let mut stmt = tx.prepare("SELECT path FROM library_folders UNION SELECT path FROM sidebar_folders")
                .map_err(|e| e.to_string())?;
            let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
                .into_iter().map(|path| fs::canonicalize(&path)
                    .map(|resolved| display_path(&resolved)).unwrap_or_else(|_| normalize_path(&path))).collect()
        };
        if roots.iter().any(|root| in_folder(root, &old_path)) {
            return Err("不能移动音乐库根目录或包含音乐库根目录的文件夹".to_string());
        }
        if !roots.iter().any(|root| in_folder(&old_path, root))
            || !roots.iter().any(|root| in_folder(&target_path, root)) {
            return Err("只能在已添加的本地音乐文件夹范围内移动".to_string());
        }

        // Update every persisted path while preserving song IDs and metadata.
        // All SQL identifiers below are constants, never user input.
        for (table, column) in [
            ("songs", "path"), ("songs", "cue_source_path"), ("songs", "cover_thumb_path"),
            ("play_history", "song_path"), ("song_loudness", "song_path"),
            ("song_highlight_paths", "path"),
        ] {
            let paths = {
                let mut stmt = tx.prepare(&format!("SELECT DISTINCT {column} FROM {table} WHERE {column} IS NOT NULL"))
                    .map_err(|e| e.to_string())?;
                let rows = stmt.query_map([], |row| row.get::<_, String>(0)).map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>().map_err(|e| e.to_string())?
            };
            for path in paths {
                if let Some(next) = relocated_path(&path, &old_path, &new_path) {
                    tx.execute(&format!("UPDATE {table} SET {column} = ?1 WHERE {column} = ?2"), params![next, path])
                        .map_err(|e| format!("更新歌曲路径失败，文件夹未移动：{e}"))?;
                }
            }
        }

        // rename does not copy/delete incrementally. A cross-volume or locked
        // directory fails without leaving a partially moved directory behind.
        fs::rename(&source, &destination)
            .map_err(|e| format!("移动失败（文件夹可能被占用或跨磁盘）：{e}"))?;
        if let Err(error) = tx.commit() {
            return match fs::rename(&destination, &source) {
                Ok(()) => Err(format!("保存失败，文件夹已恢复原位置：{error}")),
                Err(rollback) => Err(format!("保存失败且无法恢复原位置，文件夹现位于 {new_path}。请刷新音乐库。{error}；{rollback}")),
            };
        }
        Ok(FolderMoveResult { old_path, new_path })
    }).await.map_err(|e| e.to_string())?
}
