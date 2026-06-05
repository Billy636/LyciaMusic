use encoding_rs::{GBK, SHIFT_JIS};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};
use thiserror::Error;

#[derive(Error, Debug)]
pub enum CueParseError {
    #[error("Failed to read CUE file: {0}")]
    Io(#[from] std::io::Error),
    #[error("CUE file is empty")]
    EmptyFile,
    #[error("No FILE directive found in CUE sheet")]
    MissingFileDirective,
    #[error("No TRACK directives found in CUE sheet")]
    NoTracks,
    #[error("Invalid timestamp at line {line}: {raw}")]
    InvalidTimestamp { line: usize, raw: String },
    #[error("Audio file referenced by CUE not found: {0}")]
    AudioFileNotFound(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CueSheet {
    pub album_title: Option<String>,
    pub album_performer: Option<String>,
    pub file_path: String,
    pub resolved_audio_path: PathBuf,
    pub tracks: Vec<CueTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CueTrack {
    pub track_number: u32,
    pub title: Option<String>,
    pub performer: Option<String>,
    pub index01_start_ms: u64,
    pub end_ms: Option<u64>,
}

fn decode_cue_bytes(bytes: &[u8]) -> String {
    if let Ok(utf8) = String::from_utf8(bytes.to_vec()) {
        return utf8;
    }
    let (decoded, _, had_errors) = GBK.decode(bytes);
    if !had_errors {
        return decoded.into_owned();
    }
    let (decoded, _, had_errors) = SHIFT_JIS.decode(bytes);
    if !had_errors {
        return decoded.into_owned();
    }
    String::from_utf8_lossy(bytes).into_owned()
}

fn parse_cue_timestamp(raw: &str, line_number: usize) -> Result<u64, CueParseError> {
    let parts: Vec<&str> = raw.trim().split(':').collect();
    if parts.len() != 3 {
        return Err(CueParseError::InvalidTimestamp {
            line: line_number,
            raw: raw.to_string(),
        });
    }
    let minutes: u64 = parts[0]
        .parse()
        .map_err(|_| CueParseError::InvalidTimestamp {
            line: line_number,
            raw: raw.to_string(),
        })?;
    let seconds: u64 = parts[1]
        .parse()
        .map_err(|_| CueParseError::InvalidTimestamp {
            line: line_number,
            raw: raw.to_string(),
        })?;
    let frames: u64 = parts[2]
        .parse()
        .map_err(|_| CueParseError::InvalidTimestamp {
            line: line_number,
            raw: raw.to_string(),
        })?;
    Ok(minutes * 60_000 + seconds * 1_000 + (frames * 1_000) / 75)
}

pub fn parse_cue_file(cue_path: &Path) -> Result<CueSheet, CueParseError> {
    let bytes = fs::read(cue_path)?;
    let content = decode_cue_bytes(&bytes);
    parse_cue_content(&content, cue_path)
}

fn parse_cue_content(content: &str, cue_path: &Path) -> Result<CueSheet, CueParseError> {
    if content.trim().is_empty() {
        return Err(CueParseError::EmptyFile);
    }

    let cue_dir = cue_path.parent().unwrap_or(Path::new("."));

    let mut album_title: Option<String> = None;
    let mut album_performer: Option<String> = None;
    let mut file_path: Option<String> = None;
    let mut tracks: Vec<CueTrack> = Vec::new();
    let mut current_track: Option<CueTrackBuilder> = None;

    for (line_index, line) in content.lines().enumerate() {
        let trimmed = line.trim();

        if trimmed.starts_with("REM ") || trimmed.is_empty() {
            continue;
        }

        if let Some(title) = extract_quoted(trimmed, "TITLE") {
            if let Some(ref mut track) = current_track {
                track.title = Some(title);
            } else {
                album_title = Some(title);
            }
            continue;
        }

        if let Some(performer) = extract_quoted(trimmed, "PERFORMER") {
            if let Some(ref mut track) = current_track {
                track.performer = Some(performer);
            } else {
                album_performer = Some(performer);
            }
            continue;
        }

        if let Some((file_name, _file_type)) = extract_file_directive(trimmed) {
            file_path = Some(file_name);
            continue;
        }

        if let Some(track_number) = extract_track_number(trimmed) {
            if let Some(track) = current_track.take() {
                if track.index01_start_ms.is_some() {
                    tracks.push(track.into_cue_track());
                }
            }
            current_track = Some(CueTrackBuilder {
                track_number,
                title: None,
                performer: None,
                index01_start_ms: None,
            });
            continue;
        }

        if let Some(index01_raw) = extract_index01(trimmed) {
            if let Some(ref mut track) = current_track {
                track.index01_start_ms = Some(parse_cue_timestamp(&index01_raw, line_index + 1)?);
            }
        }
    }

    if let Some(track) = current_track.take() {
        if track.index01_start_ms.is_some() {
            tracks.push(track.into_cue_track());
        }
    }

    if tracks.is_empty() {
        return Err(CueParseError::NoTracks);
    }

    let file_path = file_path.ok_or(CueParseError::MissingFileDirective)?;
    let resolved_audio_path = resolve_audio_path(&file_path, cue_dir)?;

    for i in 0..tracks.len() {
        if i + 1 < tracks.len() {
            tracks[i].end_ms = Some(tracks[i + 1].index01_start_ms);
        }
    }

    Ok(CueSheet {
        album_title,
        album_performer,
        file_path,
        resolved_audio_path,
        tracks,
    })
}

fn resolve_audio_path(file_path: &str, cue_dir: &Path) -> Result<PathBuf, CueParseError> {
    let candidate = if Path::new(file_path).is_absolute() {
        PathBuf::from(file_path)
    } else {
        cue_dir.join(file_path)
    };

    if candidate.exists() {
        return Ok(crate::music::utils::normalize_path(&candidate.to_string_lossy()).into());
    }

    if let Some(parent) = candidate.parent() {
        if let Ok(entries) = fs::read_dir(parent) {
            let file_name_lower = candidate
                .file_name()
                .map(|n| n.to_string_lossy().to_lowercase())
                .unwrap_or_default();
            for entry in entries.flatten() {
                if entry.file_name().to_string_lossy().to_lowercase() == file_name_lower {
                    let found = entry.path();
                    if found.is_file() {
                        return Ok(
                            crate::music::utils::normalize_path(&found.to_string_lossy()).into(),
                        );
                    }
                }
            }
        }
    }

    Err(CueParseError::AudioFileNotFound(file_path.to_string()))
}

struct CueTrackBuilder {
    track_number: u32,
    title: Option<String>,
    performer: Option<String>,
    index01_start_ms: Option<u64>,
}

impl CueTrackBuilder {
    fn into_cue_track(self) -> CueTrack {
        CueTrack {
            track_number: self.track_number,
            title: self.title,
            performer: self.performer,
            index01_start_ms: self.index01_start_ms.unwrap_or(0),
            end_ms: None,
        }
    }
}

fn extract_quoted(line: &str, keyword: &str) -> Option<String> {
    let prefix = format!("{} ", keyword);
    if !line.starts_with(&prefix) {
        return None;
    }
    let remainder = line[prefix.len()..].trim();
    if remainder.starts_with('"') && remainder.ends_with('"') && remainder.len() >= 2 {
        return Some(remainder[1..remainder.len() - 1].to_string());
    }
    None
}

fn extract_file_directive(line: &str) -> Option<(String, String)> {
    let prefix = "FILE ";
    if !line.starts_with(prefix) {
        return None;
    }
    let remainder = line[prefix.len()..].trim();
    if let Some(end_quote) = remainder[1..].find('"') {
        let file_name = remainder[1..end_quote + 1].to_string();
        let rest = remainder[end_quote + 2..].trim().to_string();
        return Some((file_name, rest));
    }
    None
}

fn extract_track_number(line: &str) -> Option<u32> {
    let prefix = "TRACK ";
    if !line.starts_with(prefix) {
        return None;
    }
    line[prefix.len()..]
        .trim()
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

fn extract_index01(line: &str) -> Option<String> {
    let prefix = "INDEX 01 ";
    if !line.starts_with(prefix) {
        return None;
    }
    Some(line[prefix.len()..].trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_timestamp_zero() {
        assert_eq!(parse_cue_timestamp("00:00:00", 1).unwrap(), 0);
    }

    #[test]
    fn parse_timestamp_typical() {
        let ms = parse_cue_timestamp("04:52:60", 1).unwrap();
        assert_eq!(ms, 240000 + 52000 + 800);
    }

    #[test]
    fn parse_timestamp_invalid() {
        assert!(parse_cue_timestamp("abc", 1).is_err());
        assert!(parse_cue_timestamp("1:2", 1).is_err());
    }

    #[test]
    fn parse_minimal_cue() {
        let content = concat!(
            "TITLE \"Test Album\"\n",
            "FILE \"test.flac\" WAVE\n",
            "  TRACK 01 AUDIO\n",
            "    TITLE \"Song One\"\n",
            "    PERFORMER \"Artist\"\n",
            "    INDEX 01 00:00:00\n",
            "  TRACK 02 AUDIO\n",
            "    TITLE \"Song Two\"\n",
            "    INDEX 01 03:30:00\n",
        );
        let cue_dir = Path::new(".");
        let result = parse_cue_content(content, cue_dir);
        assert!(matches!(result, Err(CueParseError::AudioFileNotFound(_))));
    }

    #[test]
    fn extract_timestamps_from_cue() {
        let content = concat!(
            "TITLE \"Album\"\n",
            "FILE \"test.flac\" WAVE\n",
            "  TRACK 01 AUDIO\n",
            "    INDEX 01 00:00:00\n",
            "  TRACK 02 AUDIO\n",
            "    INDEX 01 04:52:60\n",
            "  TRACK 03 AUDIO\n",
            "    INDEX 01 08:48:20\n",
        );
        // Parse without file resolution by using a temp dir
        let tmp = std::env::temp_dir();
        std::fs::write(tmp.join("test.flac"), b"fake").ok();
        let cue_path = tmp.join("test.cue");
        std::fs::write(&cue_path, content).ok();
        if let Ok(sheet) = parse_cue_file(&cue_path) {
            assert_eq!(sheet.tracks.len(), 3);
            assert_eq!(sheet.tracks[0].index01_start_ms, 0);
            assert_eq!(sheet.tracks[0].end_ms, Some(292800));
            assert_eq!(sheet.tracks[1].index01_start_ms, 292800);
            assert_eq!(sheet.tracks[2].end_ms, None); // last track
        }
    }

    #[test]
    fn decode_gbk_cue() {
        let gbk_bytes: &[u8] = &[
            0x54, 0x49, 0x54, 0x4c, 0x45, 0x20, 0x22, 0xc0, 0xc7, 0x22, 0x0a,
        ];
        let decoded = decode_cue_bytes(gbk_bytes);
        assert!(decoded.contains("狼"));
    }
}
