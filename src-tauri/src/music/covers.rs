// music/covers.rs - 封面缓存与缩略图生成

use super::tags::{find_embedded_picture, read_tagged_file_from_path};
use super::types::{FullCoverImageConcurrencyLimit, ThumbnailImageConcurrencyLimit};
use super::utils::normalize_path;
use crate::database::DbState;
use crate::remote::cache::{ensure_cached_path, is_remote_uri};
use image::{DynamicImage, ImageFormat};
use lofty::picture::MimeType;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::{AppHandle, Manager, State};

const COVER_CACHE_MAX_SIZE_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GB
const THUMBNAIL_EDGE_PX: u32 = 150;
const FULL_COVER_EDGE_PX: u32 = 800;
const FULL_COVER_CACHE_VERSION: &str = "v3";
const FULL_COVER_FALLBACK_EXT: &str = "png";
const FULL_COVER_CACHE_EXTENSIONS: [&str; 5] = ["jpg", "png", "webp", "gif", "bmp"];
const CACHE_ALIAS_EXT: &str = "ref";

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn full_cover_edge_is_capped_for_now_playing_memory() {
        assert_eq!(FULL_COVER_EDGE_PX, 800);
    }
}

pub fn get_cover_cache_dir(app: &AppHandle) -> PathBuf {
    let dir = app.path().app_data_dir().unwrap().join("covers");
    if !dir.exists() {
        let _ = fs::create_dir_all(&dir);
    }
    dir
}

#[tauri::command]
pub fn run_cache_cleanup(app: &AppHandle) {
    let cache_dir = get_cover_cache_dir(app);
    let max_size = COVER_CACHE_MAX_SIZE_BYTES;

    std::thread::spawn(move || {
        if let Ok(read_dir) = fs::read_dir(&cache_dir) {
            let mut files: Vec<_> = read_dir
                .filter_map(|entry| entry.ok())
                .filter_map(|entry| {
                    let metadata = entry.metadata().ok()?;
                    let len = metadata.len();
                    let accessed = metadata
                        .accessed()
                        .or(metadata.modified())
                        .unwrap_or(SystemTime::now());
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

fn remove_cache_dir_contents(cache_dir: &Path) -> Result<(), String> {
    if !cache_dir.exists() {
        return Ok(());
    }

    let read_dir = fs::read_dir(cache_dir).map_err(|error| error.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path();
        if path.is_file() {
            fs::remove_file(&path).map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

#[tauri::command]
pub fn clear_cover_cache(app: AppHandle) -> Result<(), String> {
    let cache_dir = get_cover_cache_dir(&app);
    remove_cache_dir_contents(&cache_dir)
}

fn generate_source_hash(path: &Path) -> String {
    let mut hasher = Sha256::new();
    let normalized_path = normalize_path(&path.to_string_lossy());
    hasher.update(normalized_path.as_bytes());

    if let Ok(metadata) = fs::metadata(path) {
        let len = metadata.len();
        let mtime_nanos = metadata
            .modified()
            .unwrap_or(SystemTime::now())
            .duration_since(SystemTime::UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();

        hasher.update(len.to_be_bytes());
        hasher.update(mtime_nanos.to_be_bytes());
    }

    hex::encode(hasher.finalize())
}

fn generate_content_hash(bytes: &[u8]) -> String {
    let mut hasher = Sha256::new();
    hasher.update(bytes);
    hex::encode(hasher.finalize())
}

fn is_cached_cover_valid(path: &Path) -> bool {
    fs::metadata(path)
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
}

fn is_cache_image_decodable(path: &Path) -> bool {
    image::open(path).is_ok()
}

fn create_temp_cache_path(cache_path: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(SystemTime::UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let file_name = cache_path.file_name().unwrap_or_default().to_string_lossy();
    cache_path.with_file_name(format!("{file_name}.{nonce}.tmp"))
}

fn persist_bytes_atomically(bytes: &[u8], cache_path: &Path) -> Option<String> {
    let temp_path = create_temp_cache_path(cache_path);
    let file = fs::File::create(&temp_path).ok()?;
    let mut writer = BufWriter::new(file);

    if writer.write_all(bytes).is_err() || writer.flush().is_err() {
        let _ = fs::remove_file(&temp_path);
        return None;
    }
    drop(writer);

    if cache_path.exists() {
        if is_cache_image_decodable(cache_path) {
            let _ = fs::remove_file(&temp_path);
            return Some(cache_path.to_string_lossy().into_owned());
        }
        let _ = fs::remove_file(cache_path);
    }

    if fs::rename(&temp_path, cache_path).is_err() {
        let _ = fs::remove_file(&temp_path);
        if is_cache_image_decodable(cache_path) {
            return Some(cache_path.to_string_lossy().into_owned());
        }
        return None;
    }

    Some(cache_path.to_string_lossy().into_owned())
}

fn persist_image_atomically(
    img: &DynamicImage,
    format: ImageFormat,
    cache_path: &Path,
) -> Option<String> {
    let temp_path = create_temp_cache_path(cache_path);
    let file = fs::File::create(&temp_path).ok()?;
    let mut writer = BufWriter::new(file);

    if img.write_to(&mut writer, format).is_err() || writer.flush().is_err() {
        let _ = fs::remove_file(&temp_path);
        return None;
    }
    drop(writer);

    if cache_path.exists() {
        if is_cache_image_decodable(cache_path) {
            let _ = fs::remove_file(&temp_path);
            return Some(cache_path.to_string_lossy().into_owned());
        }
        let _ = fs::remove_file(cache_path);
    }

    if fs::rename(&temp_path, cache_path).is_err() {
        let _ = fs::remove_file(&temp_path);
        if is_cache_image_decodable(cache_path) {
            return Some(cache_path.to_string_lossy().into_owned());
        }
        return None;
    }

    Some(cache_path.to_string_lossy().into_owned())
}

fn full_cover_cache_stem(hash: &str) -> String {
    format!("{hash}_full_{FULL_COVER_CACHE_VERSION}")
}

fn thumbnail_cache_stem(hash: &str) -> String {
    format!("{hash}_thumb_{THUMBNAIL_EDGE_PX}")
}

fn thumbnail_alias_path(cache_dir: &Path, source_hash: &str) -> PathBuf {
    cache_dir.join(format!(
        "{source_hash}_thumb_{THUMBNAIL_EDGE_PX}.{CACHE_ALIAS_EXT}"
    ))
}

fn full_cover_alias_path(cache_dir: &Path, source_hash: &str) -> PathBuf {
    cache_dir.join(format!(
        "{source_hash}_full_{FULL_COVER_CACHE_VERSION}.{CACHE_ALIAS_EXT}"
    ))
}

fn full_cover_extension_from_mime(mime: Option<&MimeType>) -> Option<&'static str> {
    match mime {
        Some(MimeType::Jpeg) => Some("jpg"),
        Some(MimeType::Png) => Some("png"),
        Some(MimeType::Gif) => Some("gif"),
        Some(MimeType::Bmp) => Some("bmp"),
        Some(MimeType::Unknown(value)) if value.eq_ignore_ascii_case("image/webp") => Some("webp"),
        _ => None,
    }
}

fn resolve_alias_target(cache_dir: &Path, alias_path: &Path) -> Option<String> {
    let file_name = fs::read_to_string(alias_path).ok()?;
    let trimmed = file_name.trim();
    if trimmed.is_empty() {
        let _ = fs::remove_file(alias_path);
        return None;
    }

    let target_path = cache_dir.join(trimmed);
    if is_cached_cover_valid(&target_path) {
        return Some(target_path.to_string_lossy().into_owned());
    }

    let _ = fs::remove_file(alias_path);
    if target_path.exists() {
        let _ = fs::remove_file(target_path);
    }
    None
}

fn persist_alias_target(alias_path: &Path, target_path: &Path) -> Option<()> {
    let file_name = target_path.file_name()?.to_string_lossy().into_owned();
    persist_bytes_atomically(file_name.as_bytes(), alias_path)?;
    Some(())
}

fn cleanup_invalid_full_cover_variants(cache_dir: &Path, stem: &str) {
    for ext in FULL_COVER_CACHE_EXTENSIONS {
        let candidate = cache_dir.join(format!("{stem}.{ext}"));
        if candidate.exists() && !is_cache_image_decodable(&candidate) {
            let _ = fs::remove_file(candidate);
        }
    }
}

fn find_cached_full_cover(cache_dir: &Path, stem: &str) -> Option<String> {
    for ext in FULL_COVER_CACHE_EXTENSIONS {
        let candidate = cache_dir.join(format!("{stem}.{ext}"));
        if !candidate.exists() {
            continue;
        }

        if is_cached_cover_valid(&candidate) {
            return Some(candidate.to_string_lossy().into_owned());
        }

        let _ = fs::remove_file(candidate);
    }

    None
}

pub fn get_or_create_thumbnail(path: &Path, app: &AppHandle) -> Option<String> {
    let source_hash = generate_source_hash(path);
    let cache_dir = get_cover_cache_dir(app);
    let alias_path = thumbnail_alias_path(&cache_dir, &source_hash);

    if let Some(existing) = resolve_alias_target(&cache_dir, &alias_path) {
        return Some(existing);
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(path) {
        if let Some(pic) = find_embedded_picture(&tagged_file) {
            let shared_hash = generate_content_hash(pic.data());
            let cache_path = cache_dir.join(format!("{}.jpg", thumbnail_cache_stem(&shared_hash)));

            if is_cached_cover_valid(&cache_path) {
                let _ = persist_alias_target(&alias_path, &cache_path);
                return Some(cache_path.to_string_lossy().into_owned());
            }
            if cache_path.exists() {
                let _ = fs::remove_file(&cache_path);
            }

            if let Ok(img) = image::load_from_memory(pic.data()) {
                let resized = img.resize(
                    THUMBNAIL_EDGE_PX,
                    THUMBNAIL_EDGE_PX,
                    image::imageops::FilterType::Triangle,
                );
                let persisted = persist_image_atomically(&resized, ImageFormat::Jpeg, &cache_path)?;
                let _ = persist_alias_target(&alias_path, &cache_path);
                return Some(persisted);
            }
        }
    }

    // --- Sidecar image lookup: check for external image files with same name ---
    if let Some(parent) = path.parent() {
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            const SIDECAR_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];
            // Try stem.ext first (e.g. song.jpg)
            for &ext in SIDECAR_EXTENSIONS {
                let candidate = parent.join(format!("{}.{}", stem, ext));
                if candidate.is_file() {
                    if let Ok(img) = image::open(&candidate) {
                        let resized = img.resize(
                            THUMBNAIL_EDGE_PX,
                            THUMBNAIL_EDGE_PX,
                            image::imageops::FilterType::Triangle,
                        );
                        let cache_path = cache_dir.join(format!("{}.jpg", thumbnail_cache_stem(&source_hash)));
                        if let Some(persisted) = persist_image_atomically(&resized, ImageFormat::Jpeg, &cache_path) {
                            let _ = persist_alias_target(&alias_path, &cache_path);
                            return Some(persisted);
                        }
                    }
                }
            }
            // Try filename.ext pattern (e.g. song.mp3.jpg, song.flac.jpg)
            if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
                for &ext in SIDECAR_EXTENSIONS {
                    let candidate = parent.join(format!("{}.{}", file_name, ext));
                    if candidate.is_file() {
                        if let Ok(img) = image::open(&candidate) {
                            let resized = img.resize(
                                THUMBNAIL_EDGE_PX,
                                THUMBNAIL_EDGE_PX,
                                image::imageops::FilterType::Triangle,
                            );
                            let cache_path = cache_dir.join(format!("{}.jpg", thumbnail_cache_stem(&source_hash)));
                            if let Some(persisted) = persist_image_atomically(&resized, ImageFormat::Jpeg, &cache_path) {
                                let _ = persist_alias_target(&alias_path, &cache_path);
                                return Some(persisted);
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

pub fn get_or_create_full_cover(path: &Path, app: &AppHandle) -> Option<String> {
    let source_hash = generate_source_hash(path);
    let cache_dir = get_cover_cache_dir(app);
    let alias_path = full_cover_alias_path(&cache_dir, &source_hash);

    if let Some(existing) = resolve_alias_target(&cache_dir, &alias_path) {
        return Some(existing);
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(path) {
        if let Some(pic) = find_embedded_picture(&tagged_file) {
            let shared_hash = generate_content_hash(pic.data());
            let cache_stem = full_cover_cache_stem(&shared_hash);

            if let Some(existing) = find_cached_full_cover(&cache_dir, &cache_stem) {
                let existing_path = Path::new(&existing);
                let _ = persist_alias_target(&alias_path, existing_path);
                return Some(existing);
            }

            cleanup_invalid_full_cover_variants(&cache_dir, &cache_stem);

            if let Ok(img) = image::load_from_memory(pic.data()) {
                let should_resize =
                    img.width() > FULL_COVER_EDGE_PX || img.height() > FULL_COVER_EDGE_PX;

                if !should_resize {
                    if let Some(ext) = full_cover_extension_from_mime(pic.mime_type()) {
                        let cache_path = cache_dir.join(format!("{cache_stem}.{ext}"));
                        let persisted = persist_bytes_atomically(pic.data(), &cache_path)?;
                        let _ = persist_alias_target(&alias_path, &cache_path);
                        return Some(persisted);
                    }
                }

                // Clamp display covers to a high-quality edge length so the
                // now-playing detail view stays sharp without decoding the
                // original multi-thousand-pixel artwork into memory.
                let display_img = if should_resize {
                    img.resize(
                        FULL_COVER_EDGE_PX,
                        FULL_COVER_EDGE_PX,
                        image::imageops::FilterType::Lanczos3,
                    )
                } else {
                    img
                };

                let cache_path = cache_dir.join(format!("{cache_stem}.{FULL_COVER_FALLBACK_EXT}"));
                let persisted =
                    persist_image_atomically(&display_img, ImageFormat::Png, &cache_path)?;
                let _ = persist_alias_target(&alias_path, &cache_path);
                return Some(persisted);
            }

            if let Some(ext) = full_cover_extension_from_mime(pic.mime_type()) {
                let cache_path = cache_dir.join(format!("{cache_stem}.{ext}"));
                let persisted = persist_bytes_atomically(pic.data(), &cache_path)?;
                let _ = persist_alias_target(&alias_path, &cache_path);
                return Some(persisted);
            }
        }
    }

    // --- Sidecar image lookup: check for external image files with same name ---
    if let Some(parent) = path.parent() {
        if let Some(stem) = path.file_stem().and_then(|s| s.to_str()) {
            const SIDECAR_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];
            // Try stem.ext first (e.g. song.jpg)
            for &ext in SIDECAR_EXTENSIONS {
                let candidate = parent.join(format!("{}.{}", stem, ext));
                if candidate.is_file() {
                    if let Ok(img) = image::open(&candidate) {
                        let should_resize =
                            img.width() > FULL_COVER_EDGE_PX || img.height() > FULL_COVER_EDGE_PX;
                        let display_img = if should_resize {
                            img.resize(
                                FULL_COVER_EDGE_PX,
                                FULL_COVER_EDGE_PX,
                                image::imageops::FilterType::Lanczos3,
                            )
                        } else {
                            img
                        };
                        let cache_stem = full_cover_cache_stem(&source_hash);
                        let cache_path = cache_dir.join(format!("{cache_stem}.{FULL_COVER_FALLBACK_EXT}"));
                        if let Some(persisted) = persist_image_atomically(&display_img, ImageFormat::Png, &cache_path) {
                            let _ = persist_alias_target(&alias_path, &cache_path);
                            return Some(persisted);
                        }
                    }
                }
            }
            // Try filename.ext pattern (e.g. song.mp3.jpg, song.flac.jpg)
            if let Some(file_name) = path.file_name().and_then(|s| s.to_str()) {
                for &ext in SIDECAR_EXTENSIONS {
                    let candidate = parent.join(format!("{}.{}", file_name, ext));
                    if candidate.is_file() {
                        if let Ok(img) = image::open(&candidate) {
                            let should_resize =
                                img.width() > FULL_COVER_EDGE_PX || img.height() > FULL_COVER_EDGE_PX;
                            let display_img = if should_resize {
                                img.resize(
                                    FULL_COVER_EDGE_PX,
                                    FULL_COVER_EDGE_PX,
                                    image::imageops::FilterType::Lanczos3,
                                )
                            } else {
                                img
                            };
                            let cache_stem = full_cover_cache_stem(&source_hash);
                            let cache_path = cache_dir.join(format!("{cache_stem}.{FULL_COVER_FALLBACK_EXT}"));
                            if let Some(persisted) = persist_image_atomically(&display_img, ImageFormat::Png, &cache_path) {
                                let _ = persist_alias_target(&alias_path, &cache_path);
                                return Some(persisted);
                            }
                        }
                    }
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn get_song_cover_thumbnail(
    path: String,
    app: AppHandle,
    semaphore: State<'_, ThumbnailImageConcurrencyLimit>,
    db_state: State<'_, DbState>,
) -> Result<String, String> {
    let _permit = semaphore.0.acquire().await.map_err(|e| e.to_string())?;
    let source_path = if is_remote_uri(&path) {
        ensure_cached_path(&app, &db_state, &path).await?
    } else {
        path.clone()
    };

    let p = Path::new(&source_path);
    let app_clone = app.clone();
    let p_buf = p.to_path_buf();

    let result =
        tauri::async_runtime::spawn_blocking(move || get_or_create_thumbnail(&p_buf, &app_clone))
            .await
            .map_err(|e| e.to_string())?;

    if let Some(cache_path_str) = result {
        if !cache_path_str.is_empty() {
            if let Ok(conn) = db_state.conn.lock() {
                let _ = conn.execute(
                    "UPDATE songs SET cover_thumb_path = ?1 WHERE path = ?2",
                    rusqlite::params![&cache_path_str, &path],
                );
            }
        }
        return Ok(cache_path_str);
    }
    Ok(String::new())
}

#[tauri::command]
pub async fn get_song_cover(
    path: String,
    app: AppHandle,
    semaphore: State<'_, FullCoverImageConcurrencyLimit>,
    db_state: State<'_, DbState>,
) -> Result<String, String> {
    let _permit = semaphore.0.acquire().await.map_err(|e| e.to_string())?;
    let source_path = if is_remote_uri(&path) {
        ensure_cached_path(&app, &db_state, &path).await?
    } else {
        path.clone()
    };

    let p = Path::new(&source_path);
    let app_clone = app.clone();
    let p_buf = p.to_path_buf();

    let result =
        tauri::async_runtime::spawn_blocking(move || get_or_create_full_cover(&p_buf, &app_clone))
            .await
            .map_err(|e| e.to_string())?;

    if let Some(cache_path_str) = result {
        return Ok(cache_path_str);
    }
    Ok(String::new())
}

pub fn save_artist_avatar_auto(bytes: &[u8], covers_dir: &std::path::Path) -> Option<String> {
    let ext = if bytes.starts_with(&[0xFF, 0xD8, 0xFF]) {
        Some("jpg")
    } else if bytes.starts_with(&[0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A]) {
        Some("png")
    } else if bytes.starts_with(b"RIFF") && bytes.len() >= 12 && &bytes[8..12] == b"WEBP" {
        Some("webp")
    } else {
        None
    };

    let Some(ext) = ext else {
        eprintln!("[头像缓存] 警告：不支持的图片格式，跳过提取。");
        return None;
    };

    let sha256_hex = generate_content_hash(bytes);
    let target_filename = format!("artist-avatar-auto-{}.{}", sha256_hex, ext);
    let target_path = covers_dir.join(target_filename);

    if !covers_dir.exists() {
        if let Err(e) = std::fs::create_dir_all(covers_dir) {
            eprintln!("[头像缓存] 警告：创建缓存目录失败: {}, 路径: {:?}", e, covers_dir);
            return None;
        }
    }

    if let Some(path_str) = persist_bytes_atomically(bytes, &target_path) {
        Some(normalize_path(&path_str))
    } else {
        None
    }
}

