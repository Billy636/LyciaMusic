// music/utils.rs - 辅助函数

use std::fs;
use std::path::Path;

pub const SUPPORTED_LIBRARY_EXTENSIONS: &[&str] = &[
    "aac", "aif", "aiff", "flac", "m4a", "m4b", "mp3", "mp4", "oga", "ogg", "wav",
];

pub const CUE_FILE_EXTENSIONS: &[&str] = &["cue"];

/// 路径标准化
pub fn normalize_path(path_str: &str) -> String {
    if let Ok(p) = fs::canonicalize(path_str) {
        return normalize_windows_prefix(&p.to_string_lossy());
    }
    let mut s = normalize_windows_prefix(path_str);
    if cfg!(windows) {
        s = normalize_windows_prefix(&s.replace("/", "\\"));
        if s.len() >= 2 {
            let first_char = s.chars().next().unwrap();
            let second_char = s.chars().nth(1).unwrap();
            if first_char.is_ascii_alphabetic() && second_char == ':' {
                let upper_drive = first_char.to_ascii_uppercase();
                s = format!("{}{}", upper_drive, &s[1..]);
            }
        }
    }
    s
}

fn normalize_windows_prefix(path: &str) -> String {
    if cfg!(windows) {
        // Extended UNC paths must keep their leading double backslash. Merely
        // stripping \\?\ turns a share into the relative path UNC\server\share.
        if path
            .get(..8)
            .is_some_and(|prefix| prefix.eq_ignore_ascii_case(r"\\?\UNC\"))
        {
            return format!(r"\\{}", &path[8..]);
        }
        if let Some(path) = path.strip_prefix(r"\\?\") {
            return path.to_string();
        }
    }
    path.to_string()
}

pub fn describe_scan_io_error(path: &Path, action: &str, error: &std::io::Error) -> String {
    use std::io::ErrorKind;
    let is_share = path.to_string_lossy().starts_with(r"\\");
    let reason = match error.kind() {
        ErrorKind::PermissionDenied => "访问被拒绝，请检查共享权限或当前 Windows 登录凭据",
        ErrorKind::TimedOut
        | ErrorKind::ConnectionAborted
        | ErrorKind::ConnectionReset
        | ErrorKind::NotConnected => "连接中断或超时，请检查网络及共享连接",
        ErrorKind::NotFound if is_share => "共享目录不可访问，请检查 NAS 地址、共享名称及连接状态",
        ErrorKind::NotFound => "路径不存在或驱动器暂时不可访问",
        _ if matches!(
            error.raw_os_error(),
            Some(53 | 54 | 59 | 64 | 67 | 121 | 1231 | 1232)
        ) =>
        {
            "网络共享不可访问或连接中断，请检查网络及共享连接"
        }
        _ => "文件或目录暂时不可读取",
    };
    format!(
        "{action}失败：{}；{reason}。系统原因：{error}",
        path.display()
    )
}

/// Escape special characters for SQL LIKE pattern with `ESCAPE '^'`.
pub fn escape_like(input: &str) -> String {
    input
        .replace('^', "^^")
        .replace('%', "^%")
        .replace('_', "^_")
}

/// Build forward/backward descendant LIKE patterns for a folder path.
/// Caller should use:
/// `path = ?1 OR path LIKE ?2 ESCAPE '^' OR path LIKE ?3 ESCAPE '^'`
pub fn descendant_like_patterns(folder_path: &str) -> (String, String) {
    let forward_base = if folder_path.ends_with('/') || folder_path.ends_with('\\') {
        folder_path.to_string()
    } else {
        format!("{folder_path}/")
    };

    let backward_base = if folder_path.ends_with('/') || folder_path.ends_with('\\') {
        folder_path.to_string()
    } else {
        format!("{folder_path}\\")
    };

    (
        format!("{}%", escape_like(&forward_base)),
        format!("{}%", escape_like(&backward_base)),
    )
}

pub fn is_dot_prefixed_path(path: &Path) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .map_or(false, |name| name.starts_with('.'))
}

pub fn is_supported_library_extension(ext: &str) -> bool {
    SUPPORTED_LIBRARY_EXTENSIONS.contains(&ext)
}

pub fn is_cue_file_extension(ext: &str) -> bool {
    CUE_FILE_EXTENSIONS.contains(&ext)
}

pub fn is_lossless_audio(codec: Option<&str>, format: &str) -> bool {
    let normalized = codec.unwrap_or(format).to_lowercase();
    matches!(
        normalized.as_str(),
        "aif" | "aiff" | "alac" | "ape" | "dsd" | "flac" | "pcm" | "wav" | "wv"
    )
}

pub fn format_distribution_bucket(
    container: Option<&str>,
    codec: Option<&str>,
    format: &str,
) -> &'static str {
    let codec = codec.unwrap_or_default().to_lowercase();
    let container = container.unwrap_or_default().to_lowercase();
    let format = format.to_lowercase();

    match codec.as_str() {
        "flac" => return "flac",
        "mp3" => return "mp3",
        "alac" => return "alac",
        "aac" => return "aac",
        "vorbis" => return "ogg",
        _ => {}
    }

    match container.as_str() {
        "wav" => "wav",
        "aiff" => "aiff",
        "ogg" => "ogg",
        "mp4" => "aac",
        _ => match format.as_str() {
            "flac" => "flac",
            "mp3" => "mp3",
            "wav" => "wav",
            "alac" => "alac",
            "aif" | "aiff" => "aiff",
            "aac" | "m4a" | "m4b" | "mp4" => "aac",
            "ogg" | "oga" => "ogg",
            _ => "other",
        },
    }
}
