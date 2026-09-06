use image::codecs::jpeg::JpegEncoder;
use image::imageops::FilterType;
use image::ImageReader;
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs;
use std::io::{BufWriter, Write};
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Manager};

const CUSTOM_BACKGROUND_CACHE_VERSION: &str = "v1";
const CUSTOM_BACKGROUND_CACHE_MAX_BYTES: u64 = 128 * 1024 * 1024;
// The cached image is already rendered at the physical screen size and blur is
// baked into it, so extra texture overscan only increases GPU memory.
const CUSTOM_BACKGROUND_RENDER_OVERSCAN: f64 = 1.0;
const CUSTOM_BACKGROUND_MAX_EDGE_PX: u32 = 3840;
const CUSTOM_BACKGROUND_JPEG_QUALITY: u8 = 90;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PreparedCustomBackgroundImage {
    pub display_path: String,
    pub source_width: u32,
    pub source_height: u32,
    pub display_width: u32,
    pub display_height: u32,
}

pub fn get_custom_background_cache_dir(app: &AppHandle) -> Result<PathBuf, String> {
    let dir = app
        .path()
        .app_cache_dir()
        .map_err(|error| error.to_string())?
        .join("custom-backgrounds");
    fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    Ok(dir)
}

fn source_signature(path: &Path) -> Result<String, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("背景图片不存在".to_string());
    }

    let modified_nanos = metadata
        .modified()
        .unwrap_or(UNIX_EPOCH)
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    let canonical = fs::canonicalize(path).unwrap_or_else(|_| path.to_path_buf());
    let mut hasher = Sha256::new();
    hasher.update(canonical.to_string_lossy().as_bytes());
    hasher.update(metadata.len().to_be_bytes());
    hasher.update(modified_nanos.to_be_bytes());
    Ok(hex::encode(hasher.finalize()))
}

fn calculate_display_dimensions(
    source_width: u32,
    source_height: u32,
    target_width: u32,
    target_height: u32,
) -> (u32, u32) {
    if source_width == 0 || source_height == 0 {
        return (0, 0);
    }

    let safe_target_width = target_width.max(1) as f64;
    let safe_target_height = target_height.max(1) as f64;
    let cover_scale =
        (safe_target_width / source_width as f64).max(safe_target_height / source_height as f64);
    let requested_scale = (cover_scale * CUSTOM_BACKGROUND_RENDER_OVERSCAN).min(1.0);
    let edge_scale =
        (CUSTOM_BACKGROUND_MAX_EDGE_PX as f64 / source_width.max(source_height) as f64).min(1.0);
    let scale = requested_scale.min(edge_scale);

    (
        ((source_width as f64 * scale).round() as u32).max(1),
        ((source_height as f64 * scale).round() as u32).max(1),
    )
}

fn cache_stem(
    source_signature: &str,
    display_width: u32,
    display_height: u32,
    blur_radius: f32,
) -> String {
    let blur_tenths = (blur_radius.max(0.0) * 10.0).round() as u32;
    format!(
        "{source_signature}_{CUSTOM_BACKGROUND_CACHE_VERSION}_{display_width}x{display_height}_b{blur_tenths}"
    )
}

fn touch_path(cache_path: &Path) -> PathBuf {
    cache_path.with_extension("touch")
}

fn touch_cache_entry(cache_path: &Path) {
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .to_string();
    let _ = fs::write(touch_path(cache_path), timestamp);
}

fn cache_entry_access_time(path: &Path) -> SystemTime {
    fs::metadata(touch_path(path))
        .and_then(|metadata| metadata.modified())
        .or_else(|_| fs::metadata(path).and_then(|metadata| metadata.modified()))
        .unwrap_or(UNIX_EPOCH)
}

fn cleanup_custom_background_cache(cache_dir: &Path, protected_path: Option<&Path>) {
    let Ok(entries) = fs::read_dir(cache_dir) else {
        return;
    };

    let mut images: Vec<(PathBuf, u64, SystemTime)> = entries
        .filter_map(Result::ok)
        .map(|entry| entry.path())
        .filter(|path| path.extension().is_some_and(|extension| extension == "jpg"))
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok()?;
            Some((path.clone(), metadata.len(), cache_entry_access_time(&path)))
        })
        .collect();
    let mut total_bytes = images.iter().map(|(_, len, _)| *len).sum::<u64>();
    if total_bytes <= CUSTOM_BACKGROUND_CACHE_MAX_BYTES {
        return;
    }

    images.sort_by_key(|(_, _, accessed)| *accessed);
    for (path, len, _) in images {
        if total_bytes <= CUSTOM_BACKGROUND_CACHE_MAX_BYTES {
            break;
        }
        if protected_path.is_some_and(|protected| protected == path) {
            continue;
        }
        if fs::remove_file(&path).is_ok() {
            let _ = fs::remove_file(touch_path(&path));
            total_bytes = total_bytes.saturating_sub(len);
        }
    }
}

fn temporary_cache_path(cache_path: &Path) -> PathBuf {
    let nonce = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    cache_path.with_extension(format!("{nonce}.tmp"))
}

fn prepare_image(
    app: &AppHandle,
    source_path: &Path,
    target_width: u32,
    target_height: u32,
    blur_radius: f32,
) -> Result<PreparedCustomBackgroundImage, String> {
    let reader = ImageReader::open(source_path)
        .map_err(|error| format!("无法打开背景图片：{error}"))?
        .with_guessed_format()
        .map_err(|error| format!("无法识别背景图片格式：{error}"))?;
    let (source_width, source_height) = reader
        .into_dimensions()
        .map_err(|error| format!("无法读取背景图片尺寸：{error}"))?;
    let (display_width, display_height) =
        calculate_display_dimensions(source_width, source_height, target_width, target_height);
    if display_width == 0 || display_height == 0 {
        return Err("背景图片尺寸无效".to_string());
    }

    let signature = source_signature(source_path)?;
    let cache_dir = get_custom_background_cache_dir(app)?;
    let stem = cache_stem(&signature, display_width, display_height, blur_radius);
    let cache_path = cache_dir.join(format!("{stem}.jpg"));

    if fs::metadata(&cache_path)
        .map(|metadata| metadata.is_file() && metadata.len() > 0)
        .unwrap_or(false)
    {
        touch_cache_entry(&cache_path);
        cleanup_custom_background_cache(&cache_dir, Some(&cache_path));
        return Ok(PreparedCustomBackgroundImage {
            display_path: cache_path.to_string_lossy().into_owned(),
            source_width,
            source_height,
            display_width,
            display_height,
        });
    }

    let decoded = image::open(source_path).map_err(|error| format!("无法解码背景图片：{error}"))?;
    let resized = decoded.resize_exact(display_width, display_height, FilterType::Lanczos3);
    drop(decoded);
    let rendered = if blur_radius > 0.05 {
        resized.blur(blur_radius)
    } else {
        resized
    };

    let temp_path = temporary_cache_path(&cache_path);
    let file = fs::File::create(&temp_path).map_err(|error| error.to_string())?;
    let mut writer = BufWriter::new(file);
    let mut encoder = JpegEncoder::new_with_quality(&mut writer, CUSTOM_BACKGROUND_JPEG_QUALITY);
    if let Err(error) = encoder.encode_image(&rendered) {
        let _ = fs::remove_file(&temp_path);
        return Err(format!("无法写入背景缓存：{error}"));
    }
    writer.flush().map_err(|error| error.to_string())?;
    drop(writer);
    drop(rendered);

    if cache_path.exists() {
        let _ = fs::remove_file(&cache_path);
    }
    fs::rename(&temp_path, &cache_path).map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        error.to_string()
    })?;
    touch_cache_entry(&cache_path);
    cleanup_custom_background_cache(&cache_dir, Some(&cache_path));

    Ok(PreparedCustomBackgroundImage {
        display_path: cache_path.to_string_lossy().into_owned(),
        source_width,
        source_height,
        display_width,
        display_height,
    })
}

#[tauri::command]
pub async fn prepare_custom_background_image(
    app: AppHandle,
    source_path: String,
    target_width: u32,
    target_height: u32,
    blur_radius: f32,
) -> Result<PreparedCustomBackgroundImage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        prepare_image(
            &app,
            Path::new(&source_path),
            target_width,
            target_height,
            blur_radius,
        )
    })
    .await
    .map_err(|error| error.to_string())?
}

pub fn clear_custom_background_cache(app: &AppHandle) -> Result<(), String> {
    let cache_dir = get_custom_background_cache_dir(app)?;
    if !cache_dir.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(cache_dir).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_file() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn downscales_eight_k_images_for_a_high_dpi_window() {
        assert_eq!(
            calculate_display_dimensions(8256, 6192, 2400, 1600),
            (2400, 1800)
        );
    }

    #[test]
    fn caps_the_longest_edge_at_four_k() {
        assert_eq!(
            calculate_display_dimensions(7680, 4320, 3840, 2160),
            (3840, 2160)
        );
    }

    #[test]
    fn never_upscales_small_sources() {
        assert_eq!(
            calculate_display_dimensions(1280, 720, 2400, 1600),
            (1280, 720)
        );
    }
}
