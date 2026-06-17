// music/utils.rs - 辅助函数

use std::fs;

pub const SUPPORTED_LIBRARY_EXTENSIONS: &[&str] = &[
    "aac", "aif", "aiff", "flac", "m4a", "m4b", "mp3", "mp4", "oga", "ogg", "wav",
];

pub const CUE_FILE_EXTENSIONS: &[&str] = &["cue"];

/// 路径标准化
pub fn normalize_path(path_str: &str) -> String {
    if let Ok(p) = fs::canonicalize(path_str) {
        let mut s = p.to_string_lossy().into_owned();
        if cfg!(windows) && s.starts_with(r"\\?\") {
            s = s[4..].to_string();
        }
        return s;
    }
    let mut s = path_str.to_string();
    if cfg!(windows) {
        s = s.replace("/", "\\");
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
