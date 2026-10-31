// music/covers.rs - 封面缓存与缩略图生成

use super::tags::{find_embedded_picture, read_tagged_file_from_path};
use super::types::{FullCoverImageConcurrencyLimit, ThumbnailImageConcurrencyLimit};
use super::utils::normalize_path;
use crate::database::DbState;
use crate::remote::cache::{ensure_cached_path, is_remote_uri};
use image::{codecs::jpeg::JpegEncoder, DynamicImage, ImageFormat};
use lofty::picture::MimeType;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::SystemTime;
use tauri::{AppHandle, State};

const COVER_CACHE_MAX_SIZE_BYTES: u64 = 4 * 1024 * 1024 * 1024; // 4 GB
const THUMBNAIL_EDGE_PX: u32 = 150;
const THUMBNAIL_EDGES_PX: [u32; 4] = [150, 256, 384, 512];
const THUMBNAIL_CACHE_VERSION: &str = "v2";
const THUMBNAIL_JPEG_QUALITY: u8 = 90;
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
    let dir = crate::data_storage::data_dir(app).join("covers");
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
pub async fn clear_cover_cache(app: AppHandle) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cache_dir = get_cover_cache_dir(&app);
        remove_cache_dir_contents(&cache_dir)?;
        crate::custom_background::clear_custom_background_cache(&app)
    })
    .await
    .map_err(|error| format!("缓存清理任务失败：{error}"))?
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

    let encoded = if format == ImageFormat::Jpeg {
        JpegEncoder::new_with_quality(&mut writer, THUMBNAIL_JPEG_QUALITY)
            .encode_image(&img.to_rgb8())
    } else {
        img.write_to(&mut writer, format)
    };
    if encoded.is_err() || writer.flush().is_err() {
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

fn normalized_thumbnail_edge(edge: Option<u32>) -> u32 {
    let requested = edge.unwrap_or(THUMBNAIL_EDGE_PX);
    THUMBNAIL_EDGES_PX
        .into_iter()
        .find(|&candidate| requested <= candidate)
        .unwrap_or(512)
}

fn thumbnail_cache_stem(hash: &str, edge: u32) -> String {
    format!("{hash}_thumb_{edge}_{THUMBNAIL_CACHE_VERSION}")
}

fn thumbnail_alias_path(cache_dir: &Path, source_hash: &str, edge: u32) -> PathBuf {
    cache_dir.join(format!(
        "{}.{CACHE_ALIAS_EXT}",
        thumbnail_cache_stem(source_hash, edge)
    ))
}

fn full_cover_alias_path(cache_dir: &Path, source_hash: &str) -> PathBuf {
    cache_dir.join(format!(
        "{source_hash}_full_{FULL_COVER_CACHE_VERSION}.{CACHE_ALIAS_EXT}"
    ))
}

pub(crate) fn invalidate_song_cover_cache(path: &Path, app: &AppHandle) -> Result<(), String> {
    let cache_dir = get_cover_cache_dir(app);
    let images = external_cover_images(path);
    for source_hash in [
        generate_source_hash(path),
        cover_source_hash(path, false, &images),
        cover_source_hash(path, true, &images),
    ] {
        // Only discard source aliases. Their content-addressed targets may also be
        // used by other songs or artist avatars and must remain untouched.
        let thumbnail_aliases = THUMBNAIL_EDGES_PX
            .into_iter()
            .map(|edge| thumbnail_alias_path(&cache_dir, &source_hash, edge));
        for alias_path in thumbnail_aliases.chain([
            cache_dir.join(format!(
                "{source_hash}_thumb_{THUMBNAIL_EDGE_PX}.{CACHE_ALIAS_EXT}"
            )),
            full_cover_alias_path(&cache_dir, &source_hash),
        ]) {
            if let Err(error) = fs::remove_file(&alias_path) {
                if error.kind() != std::io::ErrorKind::NotFound {
                    return Err(format!("刷新歌曲封面缓存失败：{}；{error}", path.display()));
                }
            }
        }
    }
    Ok(())
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

const SIDECAR_EXTENSIONS: &[&str] = &["jpg", "jpeg", "png", "webp", "gif", "bmp"];
const FOLDER_COVER_NAMES: &[&str] = &["cover", "folder", "front"];

struct ExternalCoverImages {
    sidecars: Vec<PathBuf>,
    folder: Vec<PathBuf>,
}

fn external_cover_images(path: &Path) -> ExternalCoverImages {
    let mut images = ExternalCoverImages {
        sidecars: Vec::new(),
        folder: Vec::new(),
    };
    let Some(parent) = path.parent() else {
        return images;
    };
    #[cfg(not(windows))]
    let mut files: Vec<PathBuf> = fs::read_dir(parent)
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.is_file())
        .collect();
    #[cfg(not(windows))]
    files.sort();
    let find = |bases: &[&str]| -> Vec<PathBuf> {
        let mut result = Vec::new();
        for base in bases {
            for ext in SIDECAR_EXTENSIONS {
                let name = format!("{base}.{ext}");
                #[cfg(windows)]
                let candidate = parent.join(&name);
                #[cfg(not(windows))]
                let candidate = files
                    .iter()
                    .find(|file| {
                        file.file_name()
                            .and_then(|name| name.to_str())
                            .is_some_and(|value| value.eq_ignore_ascii_case(&name))
                    })
                    .cloned()
                    .unwrap_or_else(|| parent.join(&name));
                if candidate.is_file() && !result.contains(&candidate) {
                    result.push(candidate);
                }
            }
        }
        result
    };
    let bases: Vec<&str> = [path.file_stem(), path.file_name()]
        .into_iter()
        .flatten()
        .filter_map(|name| name.to_str())
        .collect();
    images.sidecars = find(&bases);
    images.folder = find(FOLDER_COVER_NAMES);
    images
}

fn cover_source_hash(path: &Path, prefer_folder: bool, images: &ExternalCoverImages) -> String {
    let mut hasher = Sha256::new();
    hasher.update(b"external-covers-v1");
    hasher.update(generate_source_hash(path).as_bytes());
    hasher.update([u8::from(prefer_folder)]);
    for image in images.sidecars.iter().chain(&images.folder) {
        hasher.update(generate_source_hash(image).as_bytes());
    }
    hex::encode(hasher.finalize())
}

fn cache_thumbnail_from_bytes(
    bytes: &[u8],
    cache_dir: &Path,
    alias_path: &Path,
    edge: u32,
) -> Option<String> {
    let content_hash = generate_content_hash(bytes);
    let cache_path = cache_dir.join(format!("{}.jpg", thumbnail_cache_stem(&content_hash, edge)));

    // Albums often embed identical artwork in every track. Reuse each size
    // before decoding the source image or generating another thumbnail.
    if is_cached_cover_valid(&cache_path) {
        let _ = persist_alias_target(alias_path, &cache_path);
        return Some(cache_path.to_string_lossy().into_owned());
    }
    if cache_path.exists() {
        let _ = fs::remove_file(&cache_path);
    }

    let img = image::load_from_memory(bytes).ok()?;
    let thumbnail = if img.width() > edge || img.height() > edge {
        img.resize(edge, edge, image::imageops::FilterType::Lanczos3)
    } else {
        img
    };
    let persisted = persist_image_atomically(&thumbnail, ImageFormat::Jpeg, &cache_path)?;
    let _ = persist_alias_target(alias_path, &cache_path);
    Some(persisted)
}

fn get_or_create_thumbnail_for_edge(
    path: &Path,
    app: &AppHandle,
    edge: u32,
    prefer_folder: bool,
    allow_folder: bool,
) -> Option<String> {
    let mut images = external_cover_images(path);
    if !allow_folder {
        images.folder.clear();
    }
    let source_hash = cover_source_hash(path, prefer_folder, &images);
    let cache_dir = get_cover_cache_dir(app);
    let alias_path = thumbnail_alias_path(&cache_dir, &source_hash, edge);

    if let Some(existing) = resolve_alias_target(&cache_dir, &alias_path) {
        return Some(existing);
    }

    if prefer_folder {
        for image in &images.folder {
            if let Some(cover) = fs::read(image)
                .ok()
                .and_then(|bytes| cache_thumbnail_from_bytes(&bytes, &cache_dir, &alias_path, edge))
            {
                return Some(cover);
            }
        }
    }

    if let Ok(tagged_file) = read_tagged_file_from_path(path) {
        if let Some(pic) = find_embedded_picture(&tagged_file) {
            if let Some(persisted) =
                cache_thumbnail_from_bytes(pic.data(), &cache_dir, &alias_path, edge)
            {
                return Some(persisted);
            }
        }
    }

    // 内嵌封面缺失时回退到同名外部图片（如 song.mp3 旁的 song.jpg）
    for image in images
        .sidecars
        .iter()
        .chain(images.folder.iter().filter(|_| !prefer_folder))
    {
        if let Some(cover) = fs::read(image)
            .ok()
            .and_then(|bytes| cache_thumbnail_from_bytes(&bytes, &cache_dir, &alias_path, edge))
        {
            return Some(cover);
        }
    }
    None
}

pub fn get_or_create_full_cover(
    path: &Path,
    app: &AppHandle,
    prefer_folder: bool,
    allow_folder: bool,
) -> Option<String> {
    let mut images = external_cover_images(path);
    if !allow_folder {
        images.folder.clear();
    }
    let source_hash = cover_source_hash(path, prefer_folder, &images);
    let cache_dir = get_cover_cache_dir(app);
    let alias_path = full_cover_alias_path(&cache_dir, &source_hash);

    if let Some(existing) = resolve_alias_target(&cache_dir, &alias_path) {
        return Some(existing);
    }

    if prefer_folder {
        for image in &images.folder {
            if let Some(cover) = cache_external_full_cover(image, &cache_dir, &alias_path) {
                return Some(cover);
            }
        }
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

    // 内嵌封面缺失时回退到同名外部图片（如 song.mp3 旁的 song.jpg）
    for image in images
        .sidecars
        .iter()
        .chain(images.folder.iter().filter(|_| !prefer_folder))
    {
        if let Some(cover) = cache_external_full_cover(image, &cache_dir, &alias_path) {
            return Some(cover);
        }
    }
    None
}

fn cache_external_full_cover(path: &Path, cache_dir: &Path, alias_path: &Path) -> Option<String> {
    let bytes = fs::read(path).ok()?;
    let content_hash = generate_content_hash(&bytes);
    let cache_stem = full_cover_cache_stem(&content_hash);
    if let Some(existing) = find_cached_full_cover(cache_dir, &cache_stem) {
        let _ = persist_alias_target(alias_path, Path::new(&existing));
        return Some(existing);
    }
    let img = image::load_from_memory(&bytes).ok()?;
    let should_resize = img.width() > FULL_COVER_EDGE_PX || img.height() > FULL_COVER_EDGE_PX;
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
    if let Some(persisted) = persist_image_atomically(&display_img, ImageFormat::Png, &cache_path) {
        let _ = persist_alias_target(&alias_path, &cache_path);
        return Some(persisted);
    }
    None
}

fn local_cover_audio_path(path: &str, db_state: &DbState) -> String {
    if path.contains("::track") {
        if let Ok(conn) = db_state.conn.lock() {
            if let Ok(Some(source)) = conn.query_row(
                "SELECT cue_source_path FROM songs WHERE path = ?1",
                [path],
                |row| row.get::<_, Option<String>>(0),
            ) {
                return source;
            }
        }
    }
    path.to_string()
}

#[tauri::command]
pub async fn get_song_cover_thumbnail(
    path: String,
    edge: Option<u32>,
    prefer_folder_cover: Option<bool>,
    app: AppHandle,
    semaphore: State<'_, ThumbnailImageConcurrencyLimit>,
    db_state: State<'_, DbState>,
) -> Result<String, String> {
    let edge = normalized_thumbnail_edge(edge);
    let _permit = semaphore.0.acquire().await.map_err(|e| e.to_string())?;
    let allow_folder = !is_remote_uri(&path);
    let source_path = if !allow_folder {
        ensure_cached_path(&app, &db_state, &path).await?
    } else {
        local_cover_audio_path(&path, &db_state)
    };

    let p = Path::new(&source_path);
    let app_clone = app.clone();
    let p_buf = p.to_path_buf();

    let result = tauri::async_runtime::spawn_blocking(move || {
        get_or_create_thumbnail_for_edge(
            &p_buf,
            &app_clone,
            edge,
            prefer_folder_cover.unwrap_or(false),
            allow_folder,
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    if let Some(cache_path_str) = result {
        if edge == THUMBNAIL_EDGE_PX
            && !prefer_folder_cover.unwrap_or(false)
            && !cache_path_str.is_empty()
        {
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
    prefer_folder_cover: Option<bool>,
    app: AppHandle,
    semaphore: State<'_, FullCoverImageConcurrencyLimit>,
    db_state: State<'_, DbState>,
) -> Result<String, String> {
    let _permit = semaphore.0.acquire().await.map_err(|e| e.to_string())?;
    let allow_folder = !is_remote_uri(&path);
    let source_path = if !allow_folder {
        ensure_cached_path(&app, &db_state, &path).await?
    } else {
        local_cover_audio_path(&path, &db_state)
    };

    let p = Path::new(&source_path);
    let app_clone = app.clone();
    let p_buf = p.to_path_buf();

    let result = tauri::async_runtime::spawn_blocking(move || {
        get_or_create_full_cover(
            &p_buf,
            &app_clone,
            prefer_folder_cover.unwrap_or(false),
            allow_folder,
        )
    })
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
            eprintln!(
                "[头像缓存] 警告：创建缓存目录失败: {}, 路径: {:?}",
                e, covers_dir
            );
            return None;
        }
    }

    if let Some(path_str) = persist_bytes_atomically(bytes, &target_path) {
        Some(normalize_path(&path_str))
    } else {
        None
    }
}
