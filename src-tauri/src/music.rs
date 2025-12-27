use crate::database::DbState;
use crate::error::CommandError;
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::ItemKey;
use rusqlite::OptionalExtension;
use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager, State};
use walkdir::WalkDir;
use image::ImageFormat;
use sha2::{Sha256, Digest};
use std::collections::HashMap;
use std::process::Command;
use std::time::SystemTime;
use tokio::sync::Semaphore; 

// --- 1. 定义并发控制状态 ---
pub struct ImageConcurrencyLimit(pub Semaphore);

#[derive(Serialize, Clone, Debug)]
pub struct Song {
    pub name: String,
    pub title: String,
    pub path: String,
    pub artist: String,
    pub album: String,
    pub duration: u32,
    pub cover: Option<String>,
}

#[derive(Serialize)]
pub struct GeneratedFolder {
    pub name: String,
    pub path: String,
    pub songs: Vec<Song>,
}

fn get_cover_cache_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().unwrap().join("covers");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

// --- 2. 磁盘清理逻辑 (Clean Up) ---
pub fn run_cache_cleanup(app: &AppHandle) {
    let cache_dir = get_cover_cache_dir(app);
    let max_size = 500 * 1024 * 1024; // 500 MB

    std::thread::spawn(move || {
        if let Ok(read_dir) = fs::read_dir(&cache_dir) {
            let mut files: Vec<_> = read_dir
                .filter_map(|entry| entry.ok())
                .filter_map(|entry| {
                    let metadata = entry.metadata().ok()?;
                    let len = metadata.len();
                    let accessed = metadata.accessed().or(metadata.modified()).unwrap_or(SystemTime::now());
                    Some((entry.path(), len, accessed))
                })
                .collect();

            files.sort_by_key(|&(_, _, time)| time);

            let mut total_size: u64 = files.iter().map(|&(_, len, _)| len).sum();

            if total_size > max_size {
                println!("缓存清理开始: 当前 {} MB", total_size / 1024 / 1024);
                for (path, len, _) in files {
                    if total_size <= max_size {
                        break;
                    }
                    if fs::remove_file(&path).is_ok() {
                        total_size = total_size.saturating_sub(len);
                    }
                }
                println!("缓存清理结束: 剩余 {} MB", total_size / 1024 / 1024);
            }
        }
    });
}

// --- 🔥 核心优化：基于“文件指纹”的哈希算法 ---
// 不再包含 absolute_path，仅使用：文件名 + 大小 + 修改时间
// 这样文件移动后，只要内容没变，缓存依然有效！
fn generate_hash(path: &Path) -> String {
    let mut hasher = Sha256::new();

    // 1. 获取元数据 (Size + Mtime)
    if let Ok(metadata) = fs::metadata(path) {
        let len = metadata.len();
        let mtime_secs = metadata.modified()
            .unwrap_or(SystemTime::now())
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        hasher.update(len.to_be_bytes());          // 指纹 1: 大小
        hasher.update(mtime_secs.to_be_bytes());   // 指纹 2: 时间
    } else {
        // 如果文件读不到(极罕见)，回退到用随机时间，避免崩溃
        hasher.update(SystemTime::now().duration_since(SystemTime::UNIX_EPOCH).unwrap_or_default().as_secs().to_be_bytes());
    }

    // 2. 获取文件名 (File Name) - 不含路径
    // 即使从 D:\Music 移到 E:\Best，文件名通常不变
    let file_name = path.file_name().unwrap_or_default().to_string_lossy();
    hasher.update(file_name.as_bytes());           // 指纹 3: 文件名

    hex::encode(hasher.finalize())
}

fn get_or_create_thumbnail(path: &Path, app: &AppHandle) -> Option<String> {
    let hash = generate_hash(path);
    let cache_dir = get_cover_cache_dir(app);
    let cache_path = cache_dir.join(format!("{}_thumb.jpg", hash));
    
    if cache_path.exists() {
        return Some(cache_path.to_string_lossy().into_owned());
    }
    
    if let Ok(tagged_file) = Probe::open(path).ok()?.read() {
         if let Some(tag) = tagged_file.primary_tag() {
            let pictures = tag.pictures();
            let pic_opt = pictures.iter()
                .find(|p| p.pic_type() == lofty::picture::PictureType::CoverFront)
                .or(pictures.first());

            if let Some(pic) = pic_opt {
                if let Ok(img) = image::load_from_memory(pic.data()) {
                    let resized = img.resize(100, 100, image::imageops::FilterType::Triangle);
                    if let Ok(mut file) = fs::File::create(&cache_path) {
                         if resized.write_to(&mut file, ImageFormat::Jpeg).is_ok() {
                             return Some(cache_path.to_string_lossy().into_owned());
                         }
                    }
                }
            }
         }
    }
    None
}

fn get_or_create_full_cover(path: &Path, app: &AppHandle) -> Option<String> {
    let hash = generate_hash(path);
    let cache_dir = get_cover_cache_dir(app);
    let cache_path = cache_dir.join(format!("{}_full.jpg", hash));
    
    if cache_path.exists() {
        return Some(cache_path.to_string_lossy().into_owned());
    }
    
    if let Ok(tagged_file) = Probe::open(path).ok()?.read() {
         if let Some(tag) = tagged_file.primary_tag() {
            let pictures = tag.pictures();
            let pic_opt = pictures.iter()
                .find(|p| p.pic_type() == lofty::picture::PictureType::CoverFront)
                .or(pictures.first());

            if let Some(pic) = pic_opt {
                if fs::write(&cache_path, pic.data()).is_ok() {
                    return Some(cache_path.to_string_lossy().into_owned());
                }
            }
         }
    }
    None
}

// --- 3. 注入并发控制的 Command ---

#[tauri::command]
pub async fn get_song_cover_thumbnail(
    path: String, 
    app: AppHandle,
    semaphore: State<'_, ImageConcurrencyLimit>
) -> Result<String, String> {
    // 获取许可 (如果没有空闲位置，这里会等待)
    let _permit = semaphore.0.acquire().await.map_err(|e| e.to_string())?;

    let p = Path::new(&path);
    let app_clone = app.clone();
    let p_buf = p.to_path_buf();
    
    let result = tauri::async_runtime::spawn_blocking(move || {
        get_or_create_thumbnail(&p_buf, &app_clone)
    }).await.map_err(|e| e.to_string())?;

    if let Some(cache_path_str) = result {
        return Ok(cache_path_str);
    }
    Ok(String::new())
}

#[tauri::command]
pub async fn get_song_cover(
    path: String, 
    app: AppHandle,
    semaphore: State<'_, ImageConcurrencyLimit>
) -> Result<String, String> {
    let _permit = semaphore.0.acquire().await.map_err(|e| e.to_string())?;

    let p = Path::new(&path);
    let app_clone = app.clone();
    let p_buf = p.to_path_buf();

    let result = tauri::async_runtime::spawn_blocking(move || {
        get_or_create_full_cover(&p_buf, &app_clone)
    }).await.map_err(|e| e.to_string())?;

    if let Some(cache_path_str) = result {
        return Ok(cache_path_str);
    }
    Ok(String::new())
}

#[tauri::command]
pub async fn scan_music_folder(
    folder_path: String,
    _app: AppHandle,
    db_state: State<'_, DbState>
) -> Result<Vec<Song>, String> {
    let db_conn = db_state.conn.clone();
    
    let result = tauri::async_runtime::spawn_blocking(move || {
        let mut songs = Vec::new();
        let conn = db_conn.lock().map_err(|e| e.to_string())?;
        
        for entry in WalkDir::new(folder_path).into_iter().filter_map(|e| e.ok()) {
            let path = entry.path();
            if path.is_file() {
                 if let Some(ext) = path.extension() {
                    let ext_str = ext.to_string_lossy().to_lowercase();
                    if ["mp3", "flac", "wav"].contains(&ext_str.as_str()) {
                        let path_str = path.to_string_lossy().to_string();
                        
                        let mut stmt = conn.prepare("SELECT title, artist, album, duration, cover_path FROM songs WHERE path = ?1").unwrap();
                        let db_song = stmt.query_row([&path_str], |row| {
                            Ok(Song {
                                name: path.file_name().unwrap().to_string_lossy().to_string(),
                                path: path_str.clone(),
                                title: row.get(0).unwrap_or_default(),
                                artist: row.get(1).unwrap_or_default(),
                                album: row.get(2).unwrap_or_default(),
                                duration: row.get(3).unwrap_or_default(),
                                cover: row.get(4).unwrap_or_default(),
                            })
                        }).optional().unwrap_or(None);

                        if let Some(s) = db_song {
                            songs.push(s);
                        } else {
                            let mut artist = String::from("未知歌手");
                            let mut album = String::from("未知专辑");
                            let mut title = String::new();
                            let mut duration = 0;
                            
                            if let Ok(tagged_file) = Probe::open(path).map_err(|e| e.to_string()).and_then(|p| p.read().map_err(|e| e.to_string())) {
                                duration = tagged_file.properties().duration().as_secs() as u32;
                                if let Some(tag) = tagged_file.primary_tag() {
                                    if let Some(art) = tag.artist() { artist = art.to_string(); }
                                    if let Some(alb) = tag.album() { album = alb.to_string(); }
                                    if let Some(tit) = tag.title() { title = tit.to_string(); }
                                }
                            }
                            
                            let cover_path = None;
                            
                            conn.execute(
                                "INSERT INTO songs (path, title, artist, album, duration, cover_path) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                                (&path_str, &title, &artist, &album, &duration, &cover_path),
                            ).ok();

                            songs.push(Song {
                                name: path.file_name().unwrap().to_string_lossy().to_string(),
                                path: path_str,
                                title,
                                artist,
                                album,
                                duration,
                                cover: cover_path,
                            });
                        }
                    }
                 }
            }
        }
        Ok::<Vec<Song>, String>(songs)
    }).await.map_err(|e| e.to_string())??;
    
    Ok(result)
}

#[tauri::command]
pub async fn scan_folder_as_playlists(
    root_path: String,
    app: AppHandle,
    db_state: State<'_, DbState>
) -> Result<Vec<GeneratedFolder>, String> {
    let songs = scan_music_folder(root_path.clone(), app, db_state).await?;
    
    let mut map: HashMap<PathBuf, Vec<Song>> = HashMap::new();
    
    for song in songs {
        let p = PathBuf::from(&song.path);
        if let Some(parent) = p.parent() {
            map.entry(parent.to_path_buf()).or_insert_with(Vec::new).push(song);
        }
    }

    let mut result = Vec::new();
    for (folder_path, folder_songs) in map {
        if !folder_songs.is_empty() {
             let folder_name = folder_path.file_name().map(|n| n.to_string_lossy().into_owned()).unwrap_or_else(|| "未知文件夹".to_string());
             result.push(GeneratedFolder {
                 name: folder_name,
                 path: folder_path.to_string_lossy().into_owned(),
                 songs: folder_songs
             });
        }
    }
    result.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(result)
}

#[tauri::command]
pub async fn get_song_lyrics(path: String) -> Result<String, String> {
    if let Ok(tagged_file) = Probe::open(&path).map_err(|e| e.to_string())?.read() {
        if let Some(tag) = tagged_file.primary_tag() {
            if let Some(lyrics) = tag.get_string(&ItemKey::Lyrics) { return Ok(lyrics.to_string()); }
            for item in tag.items() { if item.key() == &ItemKey::Comment { if let Some(text) = item.value().text() { if text.contains("[00:") { return Ok(text.to_string()); } } } }
        }
    }
    let path_obj = Path::new(&path);
    if let Some(stem) = path_obj.file_stem() {
        if let Some(parent) = path_obj.parent() {
            let lrc_path = parent.join(format!("{}.lrc", stem.to_string_lossy()));
            if lrc_path.exists() { if let Ok(content) = fs::read_to_string(lrc_path) { return Ok(content); } }
        }
    }
    Ok(String::new())
}

#[tauri::command]
pub fn batch_move_music_files(paths: Vec<String>, target_folder: String) -> Result<u32, CommandError> { 
    let mut success_count = 0; 
    let target = Path::new(&target_folder); 
    if !target.exists() || !target.is_dir() { 
        return Err(CommandError::new("TARGET_NOT_FOUND", "目标文件夹不存在")); 
    } 
    for path_str in paths { 
        let src = Path::new(&path_str); 
        if let Some(file_name) = src.file_name() { 
            let dest = target.join(file_name); 
            if fs::rename(src, &dest).is_ok() { success_count += 1; } 
        } 
    } 
    Ok(success_count) 
}

#[tauri::command]
pub fn move_music_file(old_path: String, new_path: String) -> Result<(), String> { 
    let src = Path::new(&old_path); 
    let dest = Path::new(&new_path); 
    if !src.exists() { return Err("源文件不存在".to_string()); } 
    if let Some(parent) = dest.parent() { if !parent.exists() { fs::create_dir_all(parent).map_err(|e| e.to_string())?; } } 
    fs::rename(src, dest).map_err(|e| e.to_string())?; 
    Ok(()) 
}

#[tauri::command]
pub fn show_in_folder(path: String) { 
    #[cfg(target_os = "windows")] 
    { Command::new("explorer").args(["/select,", &path]).spawn().unwrap_or_else(|_| { println!("Failed"); child_dummy() }); } 
    #[cfg(target_os = "macos")] 
    { Command::new("open").args(["-R", &path]).spawn().unwrap_or_else(|_| { println!("Failed"); child_dummy() }); } 
    #[cfg(target_os = "linux")] 
    { if let Some(parent) = std::path::Path::new(&path).parent() { Command::new("xdg-open").arg(parent).spawn().ok(); } } 
}

#[cfg(any(target_os = "windows", target_os = "macos"))]
fn child_dummy() -> std::process::Child { Command::new("true").spawn().unwrap() }

#[tauri::command]
pub fn delete_music_file(path: String) -> Result<(), String> { fs::remove_file(path).map_err(|e| e.to_string()) }