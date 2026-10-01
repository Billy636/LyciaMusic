use serde::Serialize;
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, fs, path::Path, time::UNIX_EPOCH};
use tauri::Manager;

static SCAN_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[derive(Serialize)]
pub struct ArtistImageIndex {
    images: BTreeMap<String, String>,
    skipped: usize,
}

/// Read only the explicitly selected directory, never recurse or modify source files.
#[tauri::command]
pub async fn scan_artist_images(
    app: tauri::AppHandle,
    folder: String,
) -> Result<ArtistImageIndex, String> {
    tauri::async_runtime::spawn_blocking(move || {
        // A cancelled selection may still be decoding: serialize cache writers.
        let _guard = SCAN_LOCK.lock().map_err(|e| e.to_string())?;
        let directory = Path::new(&folder);
        if !directory.is_absolute() || !directory.is_dir() {
            return Err("头像文件夹不存在或无法访问".into());
        }
        let cache = app
            .path()
            .app_data_dir()
            .map_err(|e| e.to_string())?
            .join("covers");
        fs::create_dir_all(&cache).map_err(|e| e.to_string())?;
        let mut paths = Vec::new();
        let mut skipped = 0;
        for entry in fs::read_dir(directory).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            if !entry.file_type().map_err(|e| e.to_string())?.is_file() {
                continue;
            }
            let path = entry.path();
            let ext = path
                .extension()
                .and_then(|v| v.to_str())
                .unwrap_or("")
                .to_lowercase();
            if ["jpg", "jpeg", "png", "webp"].contains(&ext.as_str()) {
                paths.push(path);
            }
        }
        // Stable choice when several images have the same artist name.
        paths.sort();
        let mut images = BTreeMap::new();
        for path in paths {
            let name = path
                .file_stem()
                .and_then(|v| v.to_str())
                .unwrap_or("")
                .trim()
                .to_lowercase();
            if name.is_empty() || images.contains_key(&name) {
                skipped += 1;
                continue;
            }
            let prepare = || -> Result<String, String> {
                let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
                if metadata.len() > 20 * 1024 * 1024 {
                    return Err("图片超过 20 MB".into());
                }
                let modified = metadata
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                    .map(|t| t.as_nanos())
                    .unwrap_or(0);
                let key = format!(
                    "artist-folder-v1:{}:{}:{}",
                    path.to_string_lossy(),
                    metadata.len(),
                    modified
                );
                let target = cache.join(format!(
                    "artist-folder-{:x}.png",
                    Sha256::digest(key.as_bytes())
                ));
                if !target.is_file() {
                    let mut reader = image::ImageReader::open(&path)
                        .map_err(|e| e.to_string())?
                        .with_guessed_format()
                        .map_err(|e| e.to_string())?;
                    let mut limits = image::Limits::default();
                    limits.max_image_width = Some(8192);
                    limits.max_image_height = Some(8192);
                    limits.max_alloc = Some(128 * 1024 * 1024);
                    reader.limits(limits);
                    let image = reader.decode().map_err(|e| e.to_string())?;
                    image
                        .thumbnail(320, 320)
                        .save_with_format(&target, image::ImageFormat::Png)
                        .map_err(|e| e.to_string())?;
                }
                Ok(target.to_string_lossy().replace('\\', "/"))
            };
            match prepare() {
                Ok(url) => {
                    images.insert(name, url);
                }
                Err(_) => skipped += 1,
            }
        }
        Ok(ArtistImageIndex { images, skipped })
    })
    .await
    .map_err(|e| e.to_string())?
}
