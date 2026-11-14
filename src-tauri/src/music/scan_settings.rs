use crate::database::DbState;
use crate::music::utils::{normalize_path, SUPPORTED_LIBRARY_EXTENSIONS};
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::path::Path;
use tauri::State;

pub(crate) const REMOTE_SCAN_EXTENSIONS: &[&str] = &[
    "mp3", "flac", "wav", "m4a", "aac", "ogg", "opus", "aiff", "aif",
];

#[derive(Clone, Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum LibraryScanSource {
    Local {
        path: String,
    },
    Remote {
        #[serde(rename = "sourceId")]
        source_id: String,
    },
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryScanSettings {
    pub included_extensions: Vec<String>,
    pub read_cue: bool,
    pub excluded_directories: Vec<String>,
}

impl LibraryScanSettings {
    pub(crate) fn defaults(remote: bool) -> Self {
        Self {
            included_extensions: allowed_extensions(remote)
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            read_cue: !remote,
            excluded_directories: Vec::new(),
        }
    }

    pub(crate) fn includes_extension(&self, extension: &str) -> bool {
        self.included_extensions
            .iter()
            .any(|value| value.eq_ignore_ascii_case(extension))
    }

    pub(crate) fn excludes_relative_directory(&self, relative: &str, remote: bool) -> bool {
        let relative = relative.replace('\\', "/");
        let relative = relative.trim_matches('/');
        self.excluded_directories
            .iter()
            .any(|excluded| path_is_within(relative, excluded, !remote && cfg!(windows)))
    }
}

fn allowed_extensions(remote: bool) -> &'static [&'static str] {
    if remote {
        REMOTE_SCAN_EXTENSIONS
    } else {
        SUPPORTED_LIBRARY_EXTENSIONS
    }
}

fn path_is_within(path: &str, root: &str, case_insensitive: bool) -> bool {
    let root = root.trim_end_matches('/');
    let path = if case_insensitive {
        path.to_lowercase()
    } else {
        path.to_string()
    };
    let root = if case_insensitive {
        root.to_lowercase()
    } else {
        root.to_string()
    };
    path == root
        || path
            .strip_prefix(&root)
            .is_some_and(|suffix| suffix.starts_with('/'))
}

fn normalized_local_path(path: &str) -> String {
    let normalized = normalize_path(path).replace('\\', "/");
    let trimmed = normalized.trim_end_matches('/');
    if trimmed.is_empty() {
        "/".to_string()
    } else if trimmed.len() == 2 && trimmed.ends_with(':') {
        format!("{trimmed}/")
    } else {
        trimmed.to_string()
    }
}

impl LibraryScanSource {
    fn remote(&self) -> bool {
        matches!(self, Self::Remote { .. })
    }

    fn key(&self) -> Result<String, String> {
        match self {
            Self::Local { path } => {
                if path.trim().is_empty() || !Path::new(path).is_absolute() {
                    return Err("请选择有效的音乐文件夹".to_string());
                }
                let normalized = normalized_local_path(path);
                Ok(format!(
                    "local:{}",
                    if cfg!(windows) {
                        normalized.to_lowercase()
                    } else {
                        normalized
                    }
                ))
            }
            Self::Remote { source_id } => {
                if source_id.trim().is_empty() {
                    return Err("远程音乐源无效".to_string());
                }
                Ok(format!("remote:{source_id}"))
            }
        }
    }
}

fn normalize_settings(
    mut settings: LibraryScanSettings,
    remote: bool,
) -> Result<LibraryScanSettings, String> {
    let mut extensions = Vec::new();
    for raw in settings.included_extensions {
        let extension = raw.trim().trim_start_matches('.').to_ascii_lowercase();
        if !allowed_extensions(remote).contains(&extension.as_str()) {
            return Err(format!("不支持的扫描格式：{raw}"));
        }
        if !extensions.contains(&extension) {
            extensions.push(extension);
        }
    }
    if extensions.is_empty() {
        return Err("请至少选择一种音频格式".to_string());
    }
    let mut directories = Vec::new();
    for raw in settings.excluded_directories {
        let relative = raw.trim().replace('\\', "/");
        if relative.starts_with('/') || relative.contains(':') {
            return Err("排除目录必须相对于音乐源根目录".to_string());
        }
        let parts = relative
            .split('/')
            .filter(|part| !part.is_empty() && *part != ".")
            .collect::<Vec<_>>();
        if parts.is_empty() || parts.contains(&"..") {
            return Err("不能排除根目录或音乐源之外的目录".to_string());
        }
        let relative = parts.join("/");
        if !directories.iter().any(|value: &String| {
            if !remote && cfg!(windows) {
                value.eq_ignore_ascii_case(&relative)
            } else {
                value == &relative
            }
        }) {
            directories.push(relative);
        }
    }
    settings.included_extensions = extensions;
    settings.excluded_directories = directories;
    settings.read_cue &= !remote;
    Ok(settings)
}

fn table_exists(conn: &Connection, table: &str) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )
    .map_err(|error| error.to_string())
}

pub(crate) fn load_settings(
    conn: &Connection,
    source: &LibraryScanSource,
) -> Result<LibraryScanSettings, String> {
    let key = source.key()?;
    if !table_exists(conn, "library_scan_settings")? {
        return Ok(LibraryScanSettings::defaults(source.remote()));
    }
    let json: Option<String> = conn
        .query_row(
            "SELECT settings_json FROM library_scan_settings WHERE source_key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    match json {
        Some(json) => normalize_settings(
            serde_json::from_str(&json).map_err(|error| error.to_string())?,
            source.remote(),
        ),
        None => Ok(LibraryScanSettings::defaults(source.remote())),
    }
}

pub(crate) fn remove_settings(conn: &Connection, source: &LibraryScanSource) -> Result<(), String> {
    if table_exists(conn, "library_scan_settings")? {
        conn.execute(
            "DELETE FROM library_scan_settings WHERE source_key = ?1",
            [source.key()?],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

pub(crate) struct LocalScanRules {
    pub(crate) root: String,
    pub(crate) settings: LibraryScanSettings,
    delegated_roots: Vec<String>,
}

impl LocalScanRules {
    #[cfg(test)]
    pub(crate) fn defaults(root: &str) -> Self {
        Self {
            root: normalized_local_path(root),
            settings: LibraryScanSettings::defaults(false),
            delegated_roots: Vec::new(),
        }
    }

    fn relative_path(&self, path: &Path) -> Option<String> {
        let normalized = normalized_local_path(&path.to_string_lossy());
        if !path_is_within(&normalized, &self.root, cfg!(windows)) {
            return None;
        }
        Some(
            normalized
                .get(self.root.len()..)?
                .trim_start_matches('/')
                .to_string(),
        )
    }

    pub(crate) fn excludes_directory(&self, path: &Path) -> bool {
        self.is_delegated_path(path)
            || self
                .relative_path(path)
                .is_some_and(|relative| self.settings.excludes_relative_directory(&relative, false))
    }

    pub(crate) fn includes_audio(&self, path: &Path) -> bool {
        if self.is_delegated_path(path) {
            return false;
        }
        let Some(relative) = self.relative_path(path) else {
            return false;
        };
        let extension = path
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        self.settings.includes_extension(extension)
            && !self.settings.excludes_relative_directory(&relative, false)
    }

    pub(crate) fn excludes_song(&self, song: &crate::music::types::Song) -> bool {
        if self.is_delegated_song(song) {
            return false;
        }
        if let Some(audio_path) = song.cue_source_path.as_deref() {
            let cue_path = Path::new(song.path.split("::track").next().unwrap_or(&song.path));
            !self.settings.read_cue
                || cue_path
                    .parent()
                    .is_some_and(|parent| self.excludes_directory(parent))
                || !self.includes_audio(Path::new(audio_path))
        } else {
            !self.includes_audio(Path::new(&song.path))
        }
    }

    fn is_delegated_path(&self, path: &Path) -> bool {
        if self.delegated_roots.is_empty() {
            return false;
        }
        let normalized = normalized_local_path(&path.to_string_lossy());
        self.delegated_roots
            .iter()
            .any(|root| path_is_within(&normalized, root, cfg!(windows)))
    }

    pub(crate) fn is_delegated_song(&self, song: &crate::music::types::Song) -> bool {
        self.is_delegated_path(Path::new(
            song.path.split("::track").next().unwrap_or(&song.path),
        ))
    }
}

pub(crate) fn load_local_rules(conn: &Connection, folder: &str) -> Result<LocalScanRules, String> {
    let normalized = normalized_local_path(folder);
    let mut root = normalized.clone();
    let mut roots = Vec::new();
    // Rules can be saved before the add-source dialog registers its first root.
    let has_exact_settings = if table_exists(conn, "library_scan_settings")? {
        let key = LibraryScanSource::Local {
            path: normalized.clone(),
        }
        .key()?;
        conn.query_row(
            "SELECT EXISTS(SELECT 1 FROM library_scan_settings WHERE source_key = ?1)",
            [key],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|error| error.to_string())?
    } else {
        false
    };
    if table_exists(conn, "library_folders")? {
        let mut statement = conn
            .prepare("SELECT path FROM library_folders")
            .map_err(|error| error.to_string())?;
        let rows = statement
            .query_map([], |row| row.get::<_, String>(0))
            .map_err(|error| error.to_string())?;
        let mut longest = if has_exact_settings {
            normalized.len()
        } else {
            0
        };
        for path in rows {
            let candidate = normalized_local_path(&path.map_err(|error| error.to_string())?);
            if candidate.len() >= longest && path_is_within(&normalized, &candidate, cfg!(windows))
            {
                longest = candidate.len();
                root = candidate.clone();
            }
            roots.push(candidate);
        }
    }
    let settings = load_settings(conn, &LibraryScanSource::Local { path: root.clone() })?;
    let delegated_roots = roots
        .into_iter()
        .filter(|candidate| {
            candidate.len() > root.len() && path_is_within(candidate, &root, cfg!(windows))
        })
        .collect();
    Ok(LocalScanRules {
        root,
        settings,
        delegated_roots,
    })
}

#[tauri::command]
pub async fn get_library_scan_settings(
    source: LibraryScanSource,
    db_state: State<'_, DbState>,
) -> Result<LibraryScanSettings, String> {
    let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
    load_settings(&conn, &source)
}

#[tauri::command]
pub async fn set_library_scan_settings(
    source: LibraryScanSource,
    settings: LibraryScanSettings,
    db_state: State<'_, DbState>,
) -> Result<LibraryScanSettings, String> {
    let key = source.key()?;
    let settings = normalize_settings(settings, source.remote())?;
    let json = serde_json::to_string(&settings).map_err(|error| error.to_string())?;
    let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
    conn.execute("INSERT INTO library_scan_settings (source_key, settings_json) VALUES (?1, ?2) ON CONFLICT(source_key) DO UPDATE SET settings_json = excluded.settings_json", params![key, json])
        .map_err(|error| error.to_string())?;
    Ok(settings)
}
