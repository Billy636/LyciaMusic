use crate::music::tags::{extract_text_metadata, read_tagged_file_from_path_for_scan};
use crate::music::utils::is_supported_library_extension;
use lofty::prelude::*;
use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use walkdir::WalkDir;

/// 工具箱工作台的预览配置：命名模板 + 文件名清理规则 + 冲突处理策略。
#[derive(Debug, Serialize, Deserialize)]
#[serde(default)]
pub struct ToolboxPreviewConfig {
    pub template: String, // e.g. "{artist} - {title}"
    pub remove_track_prefix: bool,
    pub remove_source_prefix: bool,
    pub replace_underscore: bool,
    pub collapse_spaces: bool,
    pub resolve_conflicts: bool,
}

impl Default for ToolboxPreviewConfig {
    fn default() -> Self {
        Self {
            template: "{title} - {artist}".to_string(),
            remove_track_prefix: false,
            remove_source_prefix: false,
            replace_underscore: false,
            collapse_spaces: false,
            resolve_conflicts: false,
        }
    }
}

/// 单个文件的预览结果。cleaned_name 是清理规则的结果，tag_name 是标签模板的结果；
/// final_name 是工作台将实际应用的名字（标签优先，缺标签时退回清理结果）。
/// conflict_reason: "duplicate"（与批内其他文件的目标名相同）或 "occupied"（目标名已被
/// 现有文件占用且该文件不会在本批被改名让出）。
#[derive(Debug, Clone, Serialize)]
pub struct ToolboxPreviewItem {
    pub original_path: String,
    pub original_name: String,
    pub cleaned_name: String,
    pub tag_name: Option<String>,
    pub missing_fields: Vec<String>,
    pub final_name: String,
    pub will_change: bool,
    pub conflict: bool,
    pub conflict_reason: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct RenameOperation {
    pub original_path: String,
    pub new_name: String,
}

#[derive(Debug, Serialize)]
pub struct RenameFailure {
    pub original_path: String,
    pub new_name: String,
    pub error: String,
}

#[derive(Debug, Serialize)]
pub struct RenameApplyResult {
    pub success_count: u32,
    pub failures: Vec<RenameFailure>,
}

fn sanitize_filename(name: &str) -> String {
    let invalid_chars = ['<', '>', ':', '"', '/', '\\', '|', '?', '*'];
    let mut sanitized = String::new();
    for c in name.chars() {
        if invalid_chars.contains(&c) {
            sanitized.push('_');
        } else {
            sanitized.push(c);
        }
    }
    sanitized.trim().to_string()
}

fn render_template(
    template: &str,
    title: &str,
    artist: &str,
    album: &str,
    year: &str,
    track: &str,
) -> String {
    template
        .replace("{title}", title)
        .replace("{artist}", artist)
        .replace("{album}", album)
        .replace("{year}", year)
        .replace("{track}", track)
}

/// 预览一批文件前统一编译一次正则，避免逐文件重复编译。
struct CleanupRules {
    track_prefix_re: Option<Regex>,
    source_prefix_re: Option<Regex>,
    collapse_spaces_re: Option<Regex>,
    replace_underscore: bool,
}

impl CleanupRules {
    fn new(config: &ToolboxPreviewConfig) -> Self {
        Self {
            track_prefix_re: config
                .remove_track_prefix
                .then(|| Regex::new(r"^\d+[.\-\s]+").unwrap()),
            source_prefix_re: config
                .remove_source_prefix
                .then(|| Regex::new(r"^\s*\[[^\]]*\]\s*").unwrap()),
            collapse_spaces_re: config
                .collapse_spaces
                .then(|| Regex::new(r"\s{2,}").unwrap()),
            replace_underscore: config.replace_underscore,
        }
    }

    fn is_enabled(&self) -> bool {
        self.track_prefix_re.is_some()
            || self.source_prefix_re.is_some()
            || self.collapse_spaces_re.is_some()
            || self.replace_underscore
    }

    fn apply(&self, stem: &str) -> String {
        let mut s = stem.to_string();
        if let Some(re) = &self.track_prefix_re {
            s = re.replace(&s, "").to_string();
        }
        if let Some(re) = &self.source_prefix_re {
            s = re.replace(&s, "").to_string();
        }
        if self.replace_underscore {
            s = s.replace('_', " ");
        }
        if let Some(re) = &self.collapse_spaces_re {
            s = re.replace(&s, " ").to_string();
        }
        s.trim().to_string()
    }
}

fn build_preview_item(
    path: &Path,
    config: &ToolboxPreviewConfig,
    rules: &CleanupRules,
) -> ToolboxPreviewItem {
    let original_name = path
        .file_name()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let ext = path
        .extension()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();

    // 清理规则只作用于主文件名（不含扩展名）；清空或未命中时保持原名
    let cleaned_name = match path.file_stem() {
        Some(stem) if rules.is_enabled() => {
            let cleaned = rules.apply(&stem.to_string_lossy());
            if cleaned.is_empty() || cleaned == stem.to_string_lossy() {
                original_name.clone()
            } else {
                format!("{}.{}", cleaned, ext)
            }
        }
        _ => original_name.clone(),
    };

    // 标签模板要求标题存在；歌手缺失时记录但不阻塞生成
    let mut missing_fields: Vec<String> = Vec::new();
    let tag_name = match read_tagged_file_from_path_for_scan(path) {
        Ok(tagged_file) => {
            let metadata = extract_text_metadata(&tagged_file);
            let title = metadata.title.unwrap_or_default();
            let artist = metadata.artist.unwrap_or_default();
            let album = metadata.album.unwrap_or_default();

            if title.trim().is_empty() {
                missing_fields.push("title".to_string());
                None
            } else {
                if artist.trim().is_empty() {
                    missing_fields.push("artist".to_string());
                }
                let year = tagged_file
                    .primary_tag()
                    .and_then(|tag| tag.year())
                    .map(|y| y.to_string())
                    .unwrap_or_default();
                let track = tagged_file
                    .primary_tag()
                    .and_then(|tag| tag.track())
                    .map(|t| format!("{:02}", t))
                    .unwrap_or_default();
                let base = sanitize_filename(&render_template(
                    &config.template, &title, &artist, &album, &year, &track,
                ));
                if base.is_empty() {
                    None
                } else {
                    Some(format!("{}.{}", base, ext))
                }
            }
        }
        Err(_) => {
            missing_fields.push("title".to_string());
            None
        }
    };

    let final_name = tag_name.clone().unwrap_or_else(|| cleaned_name.clone());
    let will_change = final_name != original_name;

    ToolboxPreviewItem {
        original_path: path.to_string_lossy().to_string(),
        original_name,
        cleaned_name,
        tag_name,
        missing_fields,
        final_name,
        will_change,
        conflict: false,
        conflict_reason: None,
    }
}

/// 按确定性顺序为目标名登记归属。批内重名标记为 duplicate，目标名被现有文件占用（且该文件
/// 不会在本批被改名让出）标记为 occupied。开启 resolve_conflicts 时为冲突项追加 "(2)"、"(3)"
/// 序号后缀直到找到未占用名，无法解决时仍标记冲突。items 需已按 original_name 排序，
/// 保证后缀分配结果是确定性的。
fn assign_final_names(
    items: &mut [ToolboxPreviewItem],
    folder_names: &HashMap<String, usize>,
    resolve_conflicts: bool,
) {
    let renaming_away: HashSet<String> = items
        .iter()
        .filter(|item| item.will_change)
        .map(|item| item.original_name.to_lowercase())
        .collect();

    let is_taken = |candidate: &str, claimed_finals: &HashSet<String>| -> bool {
        let key = candidate.to_lowercase();
        claimed_finals.contains(&key)
            || (folder_names.contains_key(&key) && !renaming_away.contains(&key))
    };

    let mut claimed_finals: HashSet<String> = HashSet::new();

    for item in items.iter_mut() {
        if !item.will_change {
            continue;
        }

        let reason = if claimed_finals.contains(&item.final_name.to_lowercase()) {
            Some("duplicate")
        } else if is_taken(&item.final_name, &claimed_finals) {
            Some("occupied")
        } else {
            None
        };

        if let Some(reason) = reason {
            if !resolve_conflicts {
                item.conflict = true;
                item.conflict_reason = Some(reason.to_string());
                continue;
            }

            let (stem, ext) = match item.final_name.rsplit_once('.') {
                Some((stem, ext)) => (stem.to_string(), ext.to_string()),
                None => (item.final_name.clone(), String::new()),
            };

            let mut resolved = false;
            for n in 2..=99 {
                let candidate = format!("{} ({}).{}", stem, n, ext);
                if !is_taken(&candidate, &claimed_finals) {
                    item.final_name = candidate;
                    resolved = true;
                    break;
                }
            }

            if !resolved {
                item.conflict = true;
                item.conflict_reason = Some(reason.to_string());
                continue;
            }
        }

        item.conflict = false;
        item.conflict_reason = None;
        claimed_finals.insert(item.final_name.to_lowercase());
    }
}

#[tauri::command]
pub fn preview_toolbox(
    root_path: String,
    config: ToolboxPreviewConfig,
) -> Result<Vec<ToolboxPreviewItem>, String> {
    let root = PathBuf::from(&root_path);
    if !root.is_dir() {
        return Err(format!("文件夹不存在: {}", root_path));
    }

    // 先收集文件夹里的全部文件名，供“目标名已被占用”检测使用
    let mut folder_names: HashMap<String, usize> = HashMap::new();
    let mut audio_paths: Vec<PathBuf> = Vec::new();
    for entry in WalkDir::new(&root)
        .max_depth(1)
        .into_iter()
        .filter_map(|e| e.ok())
    {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        if let Some(name) = path.file_name() {
            *folder_names
                .entry(name.to_string_lossy().to_lowercase())
                .or_default() += 1;
        }
        let Some(ext) = path.extension() else {
            continue;
        };
        let ext = ext.to_string_lossy().to_lowercase();
        if is_supported_library_extension(&ext) {
            audio_paths.push(path.to_path_buf());
        }
    }

    let rules = CleanupRules::new(&config);
    let mut items: Vec<ToolboxPreviewItem> = audio_paths
        .iter()
        .map(|path| build_preview_item(path, &config, &rules))
        .collect();

    // 先排序再做目标名分配，保证同名结果的后缀（(2)、(3)…）是确定性的
    items.sort_by(|a, b| {
        a.original_name
            .to_lowercase()
            .cmp(&b.original_name.to_lowercase())
    });

    assign_final_names(&mut items, &folder_names, config.resolve_conflicts);

    Ok(items)
}

#[tauri::command]
pub fn apply_rename(operations: Vec<RenameOperation>) -> Result<RenameApplyResult, String> {
    let mut result = RenameApplyResult {
        success_count: 0,
        failures: Vec::new(),
    };

    // 预检：批内目标重名（Windows 文件系统大小写不敏感）
    let mut seen_targets: HashMap<String, String> = HashMap::new();
    let mut blocked_paths: HashSet<String> = HashSet::new();
    for op in &operations {
        let key = match Path::new(&op.original_path).parent() {
            Some(parent) => format!(
                "{}|{}",
                parent.to_string_lossy().to_lowercase(),
                op.new_name.to_lowercase()
            ),
            None => op.new_name.to_lowercase(),
        };
        match seen_targets.get(&key) {
            Some(first_path) => {
                blocked_paths.insert(op.original_path.clone());
                result.failures.push(RenameFailure {
                    original_path: op.original_path.clone(),
                    new_name: op.new_name.clone(),
                    error: format!("批内重名，与 {} 的目标相同", first_path),
                });
            }
            None => {
                seen_targets.insert(key, op.original_path.clone());
            }
        }
    }

    // 本批将被改走的源文件名：允许把名字让给其他文件（链式改名）
    let renaming_away: HashSet<String> = operations
        .iter()
        .map(|op| {
            Path::new(&op.original_path)
                .file_name()
                .unwrap_or_default()
                .to_string_lossy()
                .to_lowercase()
        })
        .collect();

    for op in operations {
        if blocked_paths.contains(&op.original_path) {
            continue;
        }

        let src = PathBuf::from(&op.original_path);
        if !src.is_file() {
            result.failures.push(RenameFailure {
                original_path: op.original_path.clone(),
                new_name: op.new_name.clone(),
                error: "源文件不存在或已被移动".to_string(),
            });
            continue;
        }

        let Some(parent) = src.parent() else {
            result.failures.push(RenameFailure {
                original_path: op.original_path.clone(),
                new_name: op.new_name.clone(),
                error: "无法解析所在文件夹".to_string(),
            });
            continue;
        };

        let dest = parent.join(&op.new_name);
        if dest.exists() && !renaming_away.contains(&op.new_name.to_lowercase()) {
            result.failures.push(RenameFailure {
                original_path: op.original_path.clone(),
                new_name: op.new_name.clone(),
                error: "目标文件名已被占用".to_string(),
            });
            continue;
        }

        match fs::rename(&src, &dest) {
            Ok(()) => result.success_count += 1,
            Err(e) => result.failures.push(RenameFailure {
                original_path: op.original_path.clone(),
                new_name: op.new_name.clone(),
                error: e.to_string(),
            }),
        }
    }

    Ok(result)
}

#[tauri::command]
pub fn open_external_program(path: String, args: Vec<String>) -> Result<(), String> {
    use std::process::Command;

    let mut cmd = Command::new(&path);
    for arg in args {
        cmd.arg(arg);
    }

    cmd.spawn()
        .map_err(|e| format!("Failed to launch program: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn refresh_folder_songs(
    folder_path: String,
    minimum_duration_seconds: Option<u32>,
    db_state: tauri::State<'_, crate::database::DbState>,
) -> Result<Vec<crate::music::types::Song>, String> {
    // 复用现有的扫描逻辑
    crate::music::scanner::scan_single_directory_internal(
        folder_path,
        db_state.conn.clone(),
        None,
        1,
        1,
        crate::music::scanner::ScanOptions::from_minimum_duration_seconds(minimum_duration_seconds),
    )
}

#[tauri::command]
pub fn file_exists(path: String) -> bool {
    std::path::Path::new(&path).is_file()
}

const APP_IDENTIFIER: &str = "com.lover.lyciaplayer";
const GPU_CONFIG_FILE: &str = "gpu_config.json";

#[derive(Debug, Serialize, Deserialize)]
struct GpuConfig {
    gpu_acceleration: bool,
}

#[cfg(target_os = "windows")]
pub fn gpu_config_path() -> Result<PathBuf, String> {
    std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .map(|dir| dir.join(APP_IDENTIFIER).join(GPU_CONFIG_FILE))
        .ok_or_else(|| "APPDATA environment variable not found".to_string())
}

#[cfg(target_os = "windows")]
pub fn should_disable_gpu_for_startup() -> bool {
    let Ok(path) = gpu_config_path() else {
        return false;
    };

    if !path.exists() {
        return false;
    }

    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };

    match serde_json::from_str::<GpuConfig>(&content) {
        Ok(config) => !config.gpu_acceleration,
        Err(_) => false,
    }
}

#[cfg(target_os = "windows")]
pub fn append_webview2_browser_arg(arg: &str) {
    const KEY: &str = "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS";

    let current = std::env::var(KEY).unwrap_or_default();

    if current.split_whitespace().any(|item| item == arg) {
        return;
    }

    let next = if current.trim().is_empty() {
        arg.to_string()
    } else {
        format!("{} {}", current.trim(), arg)
    };

    std::env::set_var(KEY, next);
}

#[tauri::command]
pub fn set_gpu_acceleration(app_handle: tauri::AppHandle, enabled: bool) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    use tauri::Manager;

    #[cfg(target_os = "windows")]
    let path = {
        let _ = app_handle;
        gpu_config_path()?
    };

    #[cfg(not(target_os = "windows"))]
    let path = app_handle
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .join(GPU_CONFIG_FILE);

    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let config = GpuConfig {
        gpu_acceleration: enabled,
    };

    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;

    std::fs::write(path, content).map_err(|e| e.to_string())?;

    Ok(())
}

use std::time::Duration;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UpdateSource {
    Official,
    Github,
}

#[tauri::command]
pub async fn check_update_by_rust(source: UpdateSource) -> Result<String, String> {
    let url = match source {
        UpdateSource::Official => "https://lycia.prettyboy.fun/latest.json",
        UpdateSource::Github => "https://api.github.com/repos/Billy636/LyciaMusic/releases/latest",
    };

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(10))
        .user_agent("LyciaPlayer-Updater")
        .build()
        .map_err(|e| format!("创建更新请求失败: {e}"))?;

    client
        .get(url)
        .header("Accept", "application/json")
        .send()
        .await
        .map_err(|e| format!("请求更新接口失败: {e}"))?
        .error_for_status()
        .map_err(|e| format!("更新接口返回错误状态: {e}"))?
        .text()
        .await
        .map_err(|e| format!("读取更新数据失败: {e}"))
}

#[derive(Debug, Clone, serde::Serialize)]
pub struct DownloadProgress {
    pub progress: f64,
    pub downloaded: u64,
    pub total: u64,
    pub speed: f64,
}

#[tauri::command]
pub async fn download_update_file(
    app_handle: tauri::AppHandle,
    url: String,
) -> Result<String, String> {
    use std::time::Instant;
    use tauri::{Emitter, Manager};
    use tokio::fs::File;
    use tokio::io::AsyncWriteExt;

    let client = reqwest::Client::builder()
        .timeout(Duration::from_secs(300))
        .user_agent("LyciaPlayer-Updater")
        .build()
        .map_err(|e| format!("创建下载请求客户端失败: {e}"))?;

    let mut download_url = url.clone();
    if download_url.contains("github.com") {
        download_url = format!("https://gh-proxy.com/{}", download_url);
    }

    let response = client
        .get(&download_url)
        .send()
        .await
        .map_err(|e| format!("发送下载请求失败: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("下载服务器返回错误状态: {}", response.status()));
    }

    let total_size = response.content_length().unwrap_or(0);
    let download_dir = app_handle
        .path()
        .download_dir()
        .map_err(|e| e.to_string())?;

    let filename = if url.ends_with(".exe") {
        if url.contains("portable") {
            "Lycia.Player_Setup_Portable.exe"
        } else {
            "Lycia.Player_Setup_Standard.exe"
        }
    } else {
        "Lycia.Player_Setup.exe"
    };
    let dest_path = download_dir.join(filename);

    let mut file = File::create(&dest_path)
        .await
        .map_err(|e| format!("创建目标文件失败: {e}"))?;
    let mut downloaded: u64 = 0;
    let start_time = Instant::now();
    let mut last_emit = Instant::now();

    let mut response = response;
    while let Some(chunk) = response
        .chunk()
        .await
        .map_err(|e| format!("下载数据分块失败: {e}"))?
    {
        file.write_all(&chunk)
            .await
            .map_err(|e| format!("写入文件失败: {e}"))?;
        downloaded += chunk.len() as u64;

        let now = Instant::now();
        if now.duration_since(last_emit).as_millis() >= 100 || downloaded == total_size {
            let elapsed = start_time.elapsed().as_secs_f64();
            let speed = if elapsed > 0.0 {
                downloaded as f64 / elapsed
            } else {
                0.0
            };
            let progress = if total_size > 0 {
                (downloaded as f64 / total_size as f64) * 100.0
            } else {
                0.0
            };

            let payload = DownloadProgress {
                progress,
                downloaded,
                total: total_size,
                speed,
            };
            let _ = app_handle.emit("update-download-progress", payload);
            last_emit = now;
        }
    }

    file.flush()
        .await
        .map_err(|e| format!("刷新文件缓存失败: {e}"))?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn run_installer(path: String) -> Result<(), String> {
    use std::process::Command;

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .args(&["/C", "start", "", &path])
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {e}"))?;
    }

    #[cfg(not(target_os = "windows"))]
    {
        Command::new(&path)
            .spawn()
            .map_err(|e| format!("启动安装程序失败: {e}"))?;
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        apply_rename, preview_toolbox, render_template, sanitize_filename, CleanupRules,
        RenameOperation, ToolboxPreviewConfig,
    };
    use id3::TagLike;
    use std::fs;
    use std::path::{Path, PathBuf};
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_dir(label: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "lycia_toolbox_{}_{}_{}",
            label,
            std::process::id(),
            SystemTime::now().duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    /// 构造一个带 ID3v2 头的最小 mp3（仿 tags.rs 的测试夹具）
    fn write_mp3(dir: &Path, filename: &str, title: Option<&str>, artist: Option<&str>) {
        let mut tag = id3::Tag::new();
        if let Some(t) = title {
            tag.set_title(t);
        }
        if let Some(a) = artist {
            tag.set_artist(a);
        }

        let mut bytes = Vec::new();
        tag.write_to(&mut bytes, id3::Version::Id3v23)
            .expect("id3 tag should serialize");
        bytes.extend_from_slice(&[0xFF, 0xFB, 0x90, 0x64]);
        bytes.extend(std::iter::repeat(0u8).take(413));

        fs::write(dir.join(filename), bytes).unwrap();
    }

    fn find_item<'a>(
        items: &'a [super::ToolboxPreviewItem],
        name: &str,
    ) -> &'a super::ToolboxPreviewItem {
        items
            .iter()
            .find(|item| item.original_name == name)
            .unwrap_or_else(|| panic!("preview should contain {name}"))
    }

    #[test]
    fn sanitize_filename_replaces_invalid_chars_and_trims() {
        assert_eq!(sanitize_filename("a<b>c:d"), "a_b_c_d");
        assert_eq!(sanitize_filename("  name  "), "name");
        assert_eq!(sanitize_filename("普通-name.mp3"), "普通-name.mp3");
    }

    #[test]
    fn render_template_replaces_all_variables() {
        assert_eq!(
            render_template("{track}. {title} ({year})", "歌", "人", "专辑", "2024", "07"),
            "07. 歌 (2024)"
        );
        assert_eq!(render_template("{artist} - {album}", "", "", "专辑", "", ""), " - 专辑");
    }

    #[test]
    fn apply_rules_combines_all_rules_in_order() {
        let config = ToolboxPreviewConfig {
            remove_track_prefix: true,
            remove_source_prefix: true,
            replace_underscore: true,
            collapse_spaces: true,
            resolve_conflicts: false,
            template: String::new(),
        };
        let rules = CleanupRules::new(&config);

        assert_eq!(rules.apply("02. [网易云] track_one  name"), "track one name");
        assert_eq!(rules.apply("no__match"), "no match");
    }

    #[test]
    fn cleanup_rules_disabled_reports_not_enabled() {
        let config = ToolboxPreviewConfig::default();
        let rules = CleanupRules::new(&config);
        assert!(!rules.is_enabled());
        assert_eq!(rules.apply("01. song"), "01. song");
    }

    #[test]
    fn preview_toolbox_reports_tags_rules_missing_and_conflicts() {
        let dir = temp_dir("preview");
        write_mp3(&dir, "01. 爱琴海.mp3", Some("爱琴海"), Some("班得瑞"));
        write_mp3(&dir, "a.mp3", Some("爱琴海"), Some("周杰伦"));
        write_mp3(&dir, "b.mp3", Some("爱琴海"), Some("周杰伦"));
        write_mp3(&dir, "notag.mp3", None, None);
        write_mp3(&dir, "02. [网易云] track_one.mp3", None, None);

        let config = ToolboxPreviewConfig {
            template: "{title} - {artist}".to_string(),
            remove_track_prefix: true,
            remove_source_prefix: true,
            replace_underscore: true,
            collapse_spaces: true,
            resolve_conflicts: false,
        };

        let items = preview_toolbox(dir.to_string_lossy().to_string(), config).unwrap();

        let tagged = find_item(&items, "01. 爱琴海.mp3");
        assert_eq!(tagged.tag_name.as_deref(), Some("爱琴海 - 班得瑞.mp3"));
        assert_eq!(tagged.final_name, "爱琴海 - 班得瑞.mp3");
        assert!(tagged.will_change);
        assert!(!tagged.conflict);
        assert!(tagged.missing_fields.is_empty());

        // a/b 标签渲染出同一个目标名：字母序靠前的 a 先认领，b 被标记批内重名
        let claimant = find_item(&items, "a.mp3");
        assert_eq!(claimant.tag_name.as_deref(), Some("爱琴海 - 周杰伦.mp3"));
        assert!(!claimant.conflict);
        assert!(claimant.will_change);

        let duplicate = find_item(&items, "b.mp3");
        assert_eq!(duplicate.final_name, "爱琴海 - 周杰伦.mp3");
        assert!(duplicate.conflict, "b.mp3 should be conflicting");
        assert_eq!(duplicate.conflict_reason.as_deref(), Some("duplicate"));

        let notag = find_item(&items, "notag.mp3");
        assert!(notag.tag_name.is_none());
        assert!(notag.missing_fields.iter().any(|f| f == "title"));
        assert!(!notag.will_change);

        let cleaned = find_item(&items, "02. [网易云] track_one.mp3");
        assert!(cleaned.tag_name.is_none());
        assert_eq!(cleaned.cleaned_name, "track one.mp3");
        assert_eq!(cleaned.final_name, "track one.mp3");
        assert!(cleaned.will_change);
        assert!(!cleaned.conflict);
    }

    #[test]
    fn preview_toolbox_flags_target_occupied_by_untouched_file() {
        let dir = temp_dir("occupied");
        // 该文件命名已符合模板，本身不会变
        write_mp3(
            &dir,
            "晴天 - 周杰伦.mp3",
            Some("晴天"),
            Some("周杰伦"),
        );
        // 该文件的标签会渲染出同名目标 → 与既有文件冲突
        write_mp3(&dir, "q.mp3", Some("晴天"), Some("周杰伦"));

        let items = preview_toolbox(
            dir.to_string_lossy().to_string(),
            ToolboxPreviewConfig::default(),
        )
        .unwrap();

        let untouched = find_item(&items, "晴天 - 周杰伦.mp3");
        assert!(!untouched.will_change);
        assert!(!untouched.conflict);

        let mover = find_item(&items, "q.mp3");
        assert_eq!(mover.final_name, "晴天 - 周杰伦.mp3");
        assert!(mover.conflict);
        assert_eq!(mover.conflict_reason.as_deref(), Some("occupied"));
    }

    #[test]
    fn preview_toolbox_suffixes_duplicates_when_resolving() {
        let dir = temp_dir("suffix_dup");
        write_mp3(&dir, "a.mp3", Some("晴天"), Some("周杰伦"));
        write_mp3(&dir, "b.mp3", Some("晴天"), Some("周杰伦"));
        write_mp3(&dir, "c.mp3", Some("晴天"), Some("周杰伦"));

        let config = ToolboxPreviewConfig {
            resolve_conflicts: true,
            ..ToolboxPreviewConfig::default()
        };
        let items = preview_toolbox(dir.to_string_lossy().to_string(), config).unwrap();

        let first = find_item(&items, "a.mp3");
        assert_eq!(first.final_name, "晴天 - 周杰伦.mp3");
        assert!(!first.conflict);

        let second = find_item(&items, "b.mp3");
        assert_eq!(second.final_name, "晴天 - 周杰伦 (2).mp3");
        assert!(second.will_change);
        assert!(!second.conflict);
        assert!(second.conflict_reason.is_none());

        let third = find_item(&items, "c.mp3");
        assert_eq!(third.final_name, "晴天 - 周杰伦 (3).mp3");
        assert!(!third.conflict);
    }

    #[test]
    fn preview_toolbox_suffix_skips_already_taken_suffix() {
        let dir = temp_dir("suffix_skip");
        // 已符合模板命名的文件（无变化，持续占用原名）
        write_mp3(&dir, "晴天 - 周杰伦.mp3", Some("晴天"), Some("周杰伦"));
        // 无标签的 "(2)" 文件保持原名，占用 "(2)" 后缀位
        write_mp3(&dir, "晴天 - 周杰伦 (2).mp3", None, None);
        write_mp3(&dir, "q.mp3", Some("晴天"), Some("周杰伦"));

        let config = ToolboxPreviewConfig {
            resolve_conflicts: true,
            ..ToolboxPreviewConfig::default()
        };
        let items = preview_toolbox(dir.to_string_lossy().to_string(), config).unwrap();

        let mover = find_item(&items, "q.mp3");
        assert_eq!(mover.final_name, "晴天 - 周杰伦 (3).mp3");
        assert!(!mover.conflict);
        assert!(mover.will_change);
    }

    #[test]
    fn preview_toolbox_rejects_missing_folder() {
        let result = preview_toolbox(
            "Z:/definitely/not/exist_toolbox_test".to_string(),
            ToolboxPreviewConfig::default(),
        );
        assert!(result.is_err());
    }

    #[test]
    fn apply_rename_reports_per_file_results_without_aborting() {
        let dir = temp_dir("apply");
        let f1 = dir.join("old_name.txt");
        fs::write(&f1, b"1").unwrap();
        let f2 = dir.join("second.txt");
        fs::write(&f2, b"2").unwrap();
        let f3 = dir.join("third.txt");
        fs::write(&f3, b"3").unwrap();
        let f4 = dir.join("fourth.txt");
        fs::write(&f4, b"4").unwrap();
        fs::write(dir.join("occupied.txt"), b"o").unwrap();

        let ops = vec![
            RenameOperation {
                original_path: f1.to_string_lossy().to_string(),
                new_name: "new_name.txt".to_string(),
            },
            RenameOperation {
                original_path: f2.to_string_lossy().to_string(),
                new_name: "occupied.txt".to_string(),
            },
            RenameOperation {
                original_path: f3.to_string_lossy().to_string(),
                new_name: "dup.txt".to_string(),
            },
            // 大小写不同但 Windows 下同名 → 预检拦截
            RenameOperation {
                original_path: f4.to_string_lossy().to_string(),
                new_name: "DUP.txt".to_string(),
            },
            RenameOperation {
                original_path: dir.join("ghost.txt").to_string_lossy().to_string(),
                new_name: "whatever.txt".to_string(),
            },
        ];

        let result = apply_rename(ops).unwrap();

        assert_eq!(result.success_count, 2);
        assert_eq!(result.failures.len(), 3);

        assert!(dir.join("new_name.txt").is_file());
        assert!(dir.join("dup.txt").is_file());

        let errors: Vec<&str> = result
            .failures
            .iter()
            .map(|f| f.error.as_str())
            .collect();
        assert!(errors.iter().any(|e| e.contains("目标文件名已被占用")));
        assert!(errors.iter().any(|e| e.contains("批内重名")));
        assert!(errors.iter().any(|e| e.contains("源文件不存在")));
    }
}
