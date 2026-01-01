use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::fs;
use lofty::probe::Probe;
use lofty::prelude::*;
use regex::Regex;
use walkdir::WalkDir;

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameConfig {
    pub mode: String, // "tags", "rules", "auto"
    pub template: String, // e.g. "{artist} - {title}"
    pub remove_track_prefix: bool,
    pub remove_source_prefix: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenamePreview {
    pub original_path: String,
    pub original_name: String,
    pub new_name: String,
    pub status: String, // "tags" (success via tags), "rules" (cleaned via rules), "skipped" (no change/error)
    pub error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct RenameOperation {
    pub original_path: String,
    pub new_name: String,
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

fn process_file(path: &Path, config: &RenameConfig) -> RenamePreview {
    let original_name = path.file_name().unwrap_or_default().to_string_lossy().to_string();
    let original_path_str = path.to_string_lossy().to_string();
    let ext = path.extension().unwrap_or_default().to_string_lossy().to_string();

    // Mode A: Standardize via Tags
    if config.mode == "tags" || config.mode == "auto" {
        // Explicitly typed probe result handling
        let tagged_file_result = Probe::open(path);
        
        if let Ok(probe) = tagged_file_result {
            if let Ok(tagged_file) = probe.read() {
                if let Some(tag) = tagged_file.primary_tag() {
                    // Fix E0716: Own the strings immediately
                    let title = tag.title().as_deref().unwrap_or("").to_string();
                    let artist = tag.artist().as_deref().unwrap_or("").to_string();
                    let album = tag.album().as_deref().unwrap_or("").to_string();
                    let year = tag.year().map(|y| y.to_string()).unwrap_or_default();
                    let track = tag.track().map(|t| format!("{:02}", t)).unwrap_or_default();

                    if !title.is_empty() { // Assume title is minimum requirement
                        let mut new_name_base = config.template.clone();
                        new_name_base = new_name_base.replace("{title}", &title);
                        new_name_base = new_name_base.replace("{artist}", &artist);
                        new_name_base = new_name_base.replace("{album}", &album);
                        new_name_base = new_name_base.replace("{year}", &year);
                        new_name_base = new_name_base.replace("{track}", &track);

                        let new_name = format!("{}.{}", sanitize_filename(&new_name_base), ext);
                        
                        if new_name != original_name {
                            return RenamePreview {
                                original_path: original_path_str,
                                original_name,
                                new_name,
                                status: "tags".to_string(),
                                error: None,
                            };
                        } else if config.mode == "tags" {
                             return RenamePreview {
                                original_path: original_path_str,
                                original_name: original_name.clone(),
                                new_name: original_name,
                                status: "skipped".to_string(),
                                error: Some("Already named correctly".to_string()),
                            };
                        }
                    }
                }
            }
        }
        
        // If mode is "tags" and we failed, return skipped
        if config.mode == "tags" {
             return RenamePreview {
                original_path: original_path_str,
                original_name: original_name.clone(),
                new_name: original_name,
                status: "skipped".to_string(),
                error: Some("Missing tags".to_string()),
            };
        }
    }

    // Mode B: Clean via Rules (or Auto fallback)
    if config.mode == "rules" || config.mode == "auto" {
        let mut cleaned_name = original_name.clone();
        
        // Apply regex rules only to the stem (filename without extension)
        if let Some(stem) = path.file_stem() {
            let mut stem_str = stem.to_string_lossy().to_string();

            if config.remove_track_prefix {
                let re = Regex::new(r"^\d+[\.\-\s]+").unwrap();
                stem_str = re.replace(&stem_str, "").to_string();
            }

            if config.remove_source_prefix {
                let re = Regex::new(r"^\s*\[.*?\]\s*").unwrap();
                stem_str = re.replace(&stem_str, "").to_string();
            }
            
            cleaned_name = format!("{}.{}", stem_str.trim(), ext);
        }

        if cleaned_name != original_name {
            return RenamePreview {
                original_path: original_path_str,
                original_name,
                new_name: cleaned_name,
                status: "rules".to_string(),
                error: None,
            };
        }
    }

    // Fallback: Skipped
    RenamePreview {
        original_path: original_path_str,
        original_name: original_name.clone(),
        new_name: original_name,
        status: "skipped".to_string(),
        error: Some("No rules matched or missing tags".to_string()),
    }
}

#[tauri::command]
pub fn preview_rename(root_path: String, config: RenameConfig) -> Result<Vec<RenamePreview>, String> {
    let mut results = Vec::new();
    let supported_exts = ["mp3", "flac", "wav", "m4a", "ogg"];

    for entry in WalkDir::new(root_path).max_depth(1).into_iter().filter_map(|e| e.ok()) {
        let path = entry.path();
        if path.is_file() {
            if let Some(ext) = path.extension() {
                if supported_exts.contains(&ext.to_string_lossy().to_lowercase().as_str()) {
                    results.push(process_file(path, &config));
                }
            }
        }
    }
    
    // Sort logic: changed files first
    results.sort_by(|a, b| {
        let a_changed = a.status != "skipped";
        let b_changed = b.status != "skipped";
        if a_changed && !b_changed {
            std::cmp::Ordering::Less
        } else if !a_changed && b_changed {
            std::cmp::Ordering::Greater
        } else {
            a.original_name.cmp(&b.original_name)
        }
    });

    Ok(results)
}

#[tauri::command]
pub fn apply_rename(operations: Vec<RenameOperation>) -> Result<u32, String> {
    let mut success_count = 0;
    
    for op in operations {
        let src = PathBuf::from(&op.original_path);
        if let Some(parent) = src.parent() {
            let dest = parent.join(&op.new_name);
            if fs::rename(&src, &dest).is_ok() {
                success_count += 1;
            } else {
                eprintln!("Failed to rename {:?} to {:?}", src, dest);
            }
        }
    }
    
    Ok(success_count)
}
