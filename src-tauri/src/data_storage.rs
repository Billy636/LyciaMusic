use serde::{Deserialize, Serialize};
use std::{
    fs,
    io::Write,
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use tauri::{AppHandle, Manager};
use uuid::Uuid;

const IDENTIFIER: &str = "com.lover.lyciaplayer";
const LOCATION_FILE: &str = "storage-location.json";
const MANIFEST_FILE: &str = ".lycia-data.json";
static PORTABLE: OnceLock<bool> = OnceLock::new();

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub(crate) struct DataPaths {
    pub data: PathBuf,
    pub local: PathBuf,
    pub cache: PathBuf,
    pub config: PathBuf,
}

impl DataPaths {
    fn unified(root: PathBuf) -> Self {
        Self {
            local: root.join("local"),
            cache: root.join("local"),
            config: root.clone(),
            data: root,
        }
    }

    fn legacy() -> Result<Self, String> {
        let dir = |path: Option<PathBuf>| {
            path.map(|p| p.join(IDENTIFIER))
                .ok_or("无法获取系统数据目录".to_string())
        };
        Ok(Self {
            data: dir(dirs::data_dir())?,
            local: dir(dirs::data_local_dir())?,
            cache: dir(dirs::cache_dir())?,
            config: dir(dirs::config_dir())?,
        })
    }
}

#[derive(Clone, Deserialize, Serialize)]
struct Migration {
    id: String,
    source: DataPaths,
    target: PathBuf,
    source_exists: bool,
    local_exists: bool,
    previous_pid: u32,
}

#[derive(Clone, Default, Deserialize, Serialize)]
struct Location {
    // Relative paths in portable mode survive moving the entire program folder.
    active: Option<PathBuf>,
    pending: Option<Migration>,
    #[serde(default)]
    use_legacy: bool,
    #[serde(default)]
    cleanup: Option<Migration>,
}

#[derive(Deserialize, Serialize)]
struct CopiedFile {
    path: PathBuf,
    size: u64,
    modified: Option<u128>,
}

fn modified_time(metadata: &fs::Metadata) -> Option<u128> {
    metadata
        .modified()
        .ok()?
        .duration_since(std::time::UNIX_EPOCH)
        .ok()
        .map(|time| time.as_nanos())
}

#[derive(Deserialize, Serialize)]
struct Manifest {
    paths: DataPaths,
    #[serde(default)]
    previous: Vec<DataPaths>,
    migration_id: Option<String>,
    #[serde(default)]
    database_paths: Option<DataPaths>,
    #[serde(default)]
    copied_files: Vec<CopiedFile>,
}

pub(crate) struct DataStorage {
    pub paths: DataPaths,
    pub mappings: Vec<(String, String)>,
    pub needs_database_rebase: bool,
    portable: bool,
    executable_dir: PathBuf,
    location_file: PathBuf,
    location: Mutex<Location>,
    warning: Mutex<Option<String>>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct DataStorageInfo {
    path: String,
    webview_path: String,
    portable: bool,
    pending_path: Option<String>,
    warning: Option<String>,
    path_mappings: Vec<(String, String)>,
}

fn executable_dir() -> Result<PathBuf, String> {
    std::env::current_exe()
        .map_err(|e| e.to_string())?
        .parent()
        .map(Path::to_path_buf)
        .ok_or("无法获取程序目录".into())
}

fn portable_mode(dir: &Path) -> bool {
    dir.join("portable").is_file()
        || (cfg!(target_os = "windows")
            && !cfg!(debug_assertions)
            && !dir.join("uninstall.exe").is_file())
}

pub(crate) fn is_portable() -> bool {
    PORTABLE.get().copied().unwrap_or(false)
}

fn read_json<T: serde::de::DeserializeOwned>(path: &Path) -> Result<T, String> {
    serde_json::from_slice(
        &fs::read(path).map_err(|e| format!("读取 {} 失败: {e}", path.display()))?,
    )
    .map_err(|e| format!("解析 {} 失败: {e}", path.display()))
}

fn write_json(path: &Path, value: &impl Serialize) -> Result<(), String> {
    let parent = path.parent().ok_or("数据路径无效")?;
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    let temp = parent.join(format!(".lycia-write-{}", Uuid::new_v4()));
    let result = (|| {
        let mut file = fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&temp)
            .map_err(|e| e.to_string())?;
        file.write_all(&serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())?;
        file.sync_all().map_err(|e| e.to_string())?;
        drop(file);
        fs::rename(&temp, path).map_err(|e| e.to_string())
    })();
    if result.is_err() {
        let _ = fs::remove_file(temp);
    }
    result
}

fn resolve(dir: &Path, path: &Path) -> PathBuf {
    if path.is_absolute() {
        path.to_path_buf()
    } else {
        dir.join(path)
    }
}

fn stored_path(dir: &Path, path: &Path, portable: bool) -> PathBuf {
    if portable {
        path.strip_prefix(dir).unwrap_or(path).to_path_buf()
    } else {
        path.to_path_buf()
    }
}

fn installed_paths(legacy: &DataPaths) -> Result<DataPaths, String> {
    let config = legacy.config.join(LOCATION_FILE);
    if config.is_file() {
        if let Some(root) = read_json::<Location>(&config)?.active {
            if !root.is_absolute() || !root.join(MANIFEST_FILE).is_file() {
                return Err("原安装版的自定义数据目录不可用，请恢复该目录后重试".into());
            }
            return Ok(DataPaths::unified(root));
        }
    }
    Ok(legacy.clone())
}

pub(crate) fn startup_data_dir() -> Result<PathBuf, String> {
    let dir = executable_dir()?;
    let portable = portable_mode(&dir);
    let legacy = DataPaths::legacy()?;
    let config = if portable {
        dir.join(LOCATION_FILE)
    } else {
        legacy.config.join(LOCATION_FILE)
    };
    let location: Location = if config.exists() {
        read_json(&config)?
    } else {
        Location::default()
    };
    if let Some(path) = location.active {
        return Ok(resolve(&dir, &path));
    }
    if location.use_legacy {
        return Ok(legacy.data);
    }
    let root = dir.join("data");
    if portable && root.join(MANIFEST_FILE).is_file() {
        return Ok(root);
    }
    Ok(if portable {
        installed_paths(&legacy)?.data
    } else {
        legacy.data
    })
}

// Canonicalize selected directories to reject aliases, junctions and nested moves.
fn canonical(path: &Path) -> Result<PathBuf, String> {
    let path = fs::canonicalize(path).map_err(|e| format!("无法访问 {}: {e}", path.display()))?;
    #[cfg(windows)]
    {
        let value = path.to_string_lossy();
        if let Some(rest) = value.strip_prefix(r"\\?\UNC\") {
            return Ok(PathBuf::from(format!(r"\\{rest}")));
        }
        if let Some(rest) = value.strip_prefix(r"\\?\") {
            return Ok(PathBuf::from(rest));
        }
    }
    Ok(path)
}

fn validate_target(target: &Path, source: &DataPaths) -> Result<PathBuf, String> {
    if !target.is_absolute() {
        return Err("请选择绝对路径".into());
    }
    let target = canonical(target)?;
    if !target.is_dir() {
        return Err("请选择文件夹".into());
    }
    for root in [&source.data, &source.local, &source.cache, &source.config] {
        let root = if root.exists() {
            canonical(root)?
        } else {
            root.clone()
        };
        if target.starts_with(&root) || root.starts_with(&target) {
            return Err("新目录不能与现有数据目录相同，也不能互相包含".into());
        }
    }
    if fs::read_dir(&target)
        .map_err(|e| e.to_string())?
        .next()
        .transpose()
        .map_err(|e| e.to_string())?
        .is_some()
    {
        return Err("请选择空文件夹，避免覆盖已有文件".into());
    }
    let probe = target.join(format!(".lycia-write-{}", Uuid::new_v4()));
    let file = fs::OpenOptions::new()
        .create_new(true)
        .write(true)
        .open(&probe)
        .map_err(|e| format!("所选目录不可写: {e}"))?;
    drop(file);
    fs::remove_file(probe).map_err(|e| e.to_string())?;
    Ok(target)
}

fn copy_tree(
    source: &Path,
    target: &Path,
    excluded: &Path,
    copied_files: &mut Vec<CopiedFile>,
) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    for entry in walkdir::WalkDir::new(source).follow_links(false) {
        let entry = entry.map_err(|e| e.to_string())?;
        if entry.path() == excluded || entry.path() == source.join(LOCATION_FILE) {
            continue;
        }
        if entry.path() == source.join(".lycia-migration-owner") {
            let metadata = entry.metadata().map_err(|e| e.to_string())?;
            copied_files.push(CopiedFile {
                path: entry.path().to_path_buf(),
                size: metadata.len(),
                modified: modified_time(&metadata),
            });
            continue;
        }
        if entry.file_type().is_symlink() {
            return Err(format!(
                "数据目录包含符号链接，请先移除: {}",
                entry.path().display()
            ));
        }
        let dest = target.join(
            entry
                .path()
                .strip_prefix(source)
                .map_err(|e| e.to_string())?,
        );
        if entry.file_type().is_dir() {
            fs::create_dir_all(&dest).map_err(|e| e.to_string())?;
        } else if entry.file_type().is_file() {
            let before = entry.metadata().map_err(|e| e.to_string())?;
            // A restarting WebView2 process may need a moment to release its files.
            let mut attempt = 0;
            let copied = loop {
                match fs::copy(entry.path(), &dest) {
                    Ok(size) => break size,
                    Err(error)
                        if error.kind() == std::io::ErrorKind::PermissionDenied && attempt < 30 =>
                    {
                        attempt += 1;
                        std::thread::sleep(std::time::Duration::from_millis(100));
                    }
                    Err(error) => {
                        return Err(format!("复制 {} 失败: {error}", entry.path().display()))
                    }
                }
            };
            let after = entry.metadata().map_err(|e| e.to_string())?;
            if copied != before.len()
                || copied != after.len()
                || modified_time(&before) != modified_time(&after)
            {
                return Err("复制校验失败，原数据已保留".into());
            }
            copied_files.push(CopiedFile {
                path: entry.path().to_path_buf(),
                size: after.len(),
                modified: modified_time(&after),
            });
        }
    }
    Ok(())
}

fn migrate(plan: &Migration, target: &Path, location_file: &Path) -> Result<(), String> {
    Uuid::parse_str(&plan.id).map_err(|_| "迁移标识无效，请重新设置数据目录".to_string())?;
    if (plan.source_exists && !plan.source.data.is_dir())
        || (plan.local_exists && !plan.source.local.is_dir())
    {
        return Err("原数据目录不可访问，请恢复目录后重试".into());
    }
    #[cfg(windows)]
    if plan.previous_pid != std::process::id() {
        use windows_sys::Win32::{
            Foundation::{CloseHandle, WAIT_TIMEOUT},
            System::Threading::{OpenProcess, WaitForSingleObject, PROCESS_SYNCHRONIZE},
        };
        unsafe {
            let process = OpenProcess(PROCESS_SYNCHRONIZE, 0, plan.previous_pid);
            if !process.is_null() {
                let result = WaitForSingleObject(process, 10_000);
                CloseHandle(process);
                if result == WAIT_TIMEOUT {
                    return Err("上次运行的进程尚未退出，请稍后重新启动".into());
                }
            }
        }
    }
    // Recover if copying finished but saving the directory pointer was interrupted.
    if target.join(MANIFEST_FILE).exists() {
        let manifest: Manifest = read_json(&target.join(MANIFEST_FILE))?;
        if manifest.migration_id.as_deref() == Some(&plan.id) {
            return Ok(());
        }
    }
    validate_target(target, &plan.source)?;
    let staging = target.with_file_name(format!(".lycia-migration-{}", plan.id));
    let owner_file = staging.join(".lycia-migration-owner");
    if staging.exists() {
        // Only clean a partial copy created by this exact migration, inside the target's parent.
        let expected_parent = canonical(target.parent().ok_or("目标目录无效")?)?;
        if canonical(&staging)?.parent() != Some(expected_parent.as_path())
            || fs::read_to_string(&owner_file).ok().as_deref() != Some(&plan.id)
        {
            return Err("迁移临时目录已存在且无法确认归属，请重新选择空目录".into());
        }
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    fs::create_dir(&staging).map_err(|e| format!("创建迁移临时目录失败: {e}"))?;
    let result = (|| {
        let mut copied_files = Vec::new();
        fs::write(&owner_file, &plan.id).map_err(|e| e.to_string())?;
        copy_tree(
            &plan.source.data,
            &staging,
            location_file,
            &mut copied_files,
        )?;
        if plan.source.local == plan.source.data
            || !plan.source.local.starts_with(&plan.source.data)
        {
            copy_tree(
                &plan.source.local,
                &staging.join("local"),
                location_file,
                &mut copied_files,
            )?;
        }
        if plan.source.cache != plan.source.local && plan.source.cache != plan.source.data {
            copy_tree(
                &plan.source.cache,
                &staging.join("local"),
                location_file,
                &mut copied_files,
            )?;
        }
        if plan.source.config != plan.source.data {
            let state = plan.source.config.join(".window-state.json");
            if state.exists() {
                let metadata = fs::metadata(&state).map_err(|e| e.to_string())?;
                fs::copy(&state, staging.join(".window-state.json")).map_err(|e| e.to_string())?;
                copied_files.push(CopiedFile {
                    path: state,
                    size: metadata.len(),
                    modified: modified_time(&metadata),
                });
            }
        }
        let mut previous = if plan.source.data.join(MANIFEST_FILE).exists() {
            read_json::<Manifest>(&plan.source.data.join(MANIFEST_FILE))?.previous
        } else {
            Vec::new()
        };
        previous.push(plan.source.clone());
        write_json(
            &staging.join(MANIFEST_FILE),
            &Manifest {
                paths: DataPaths::unified(target.to_path_buf()),
                previous,
                migration_id: Some(plan.id.clone()),
                database_paths: Some(plan.source.clone()),
                copied_files,
            },
        )?;
        // Only remove the selected, still-empty directory; never overwrite its contents.
        fs::remove_dir(target).map_err(|e| e.to_string())?;
        if let Err(error) = fs::rename(&staging, target) {
            let _ = fs::create_dir(target);
            return Err(error.to_string());
        }
        Ok(())
    })();
    if result.is_err() {
        let _ = fs::remove_dir_all(&staging);
    }
    result
}

pub(crate) fn initialize(app: &AppHandle) -> Result<(), String> {
    let executable_dir = executable_dir()?;
    let portable = portable_mode(&executable_dir);
    let legacy = DataPaths::legacy()?;
    let location_file = if portable {
        executable_dir.join(LOCATION_FILE)
    } else {
        legacy.config.join(LOCATION_FILE)
    };
    let mut location: Location = if location_file.exists() {
        read_json(&location_file)?
    } else {
        Location::default()
    };
    let mut warning = None;
    if portable && !location.use_legacy && location.active.is_none() && location.pending.is_none() {
        let target = executable_dir.join("data");
        if target.join(MANIFEST_FILE).exists() {
            location.active = Some(PathBuf::from("data"));
        } else {
            let source = installed_paths(&legacy)?;
            fs::create_dir_all(&target)
                .map_err(|e| format!("无法创建便携数据目录，请将软件移到可写位置: {e}"))?;
            location.pending = Some(Migration {
                id: Uuid::new_v4().to_string(),
                source: source.clone(),
                target: PathBuf::from("data"),
                source_exists: source.data.is_dir(),
                local_exists: source.local.is_dir(),
                previous_pid: std::process::id(),
            });
        }
        write_json(&location_file, &location)?;
    }
    if let Some(plan) = location.pending.clone() {
        let target = resolve(&executable_dir, &plan.target);
        match migrate(&plan, &target, &location_file) {
            Ok(()) => {
                let next = Location {
                    active: Some(stored_path(&executable_dir, &target, portable)),
                    pending: None,
                    use_legacy: false,
                    cleanup: Some(plan.clone()),
                };
                // Do not reopen the source after committing a complete copy: it could diverge from the recoverable target.
                write_json(&location_file, &next).map_err(|e| {
                    format!("数据已复制，保存目录设置失败，请重启重试。原数据已保留: {e}")
                })?;
                location = next;
            }
            Err(e) => warning = Some(format!("数据迁移未完成，继续使用原数据: {e}")),
        }
    }
    let paths = match &location.active {
        Some(root) => {
            let root = resolve(&executable_dir, root);
            if !root.join(MANIFEST_FILE).is_file() {
                return Err(format!(
                    "数据目录不可用，请恢复该目录后重启: {}",
                    root.display()
                ));
            }
            DataPaths::unified(root)
        }
        None => location
            .pending
            .as_ref()
            .map(|p| p.source.clone())
            .unwrap_or(legacy),
    };
    if location.active.is_none() {
        if let Some(plan) = &location.pending {
            if (plan.source_exists && !paths.data.is_dir())
                || (plan.local_exists && !paths.local.is_dir())
            {
                return Err(
                    warning.unwrap_or_else(|| "原数据目录不可访问，请恢复目录后重试".into())
                );
            }
        }
    }
    let _ = PORTABLE.set(portable && location.active.is_some());
    fs::create_dir_all(&paths.data).map_err(|e| e.to_string())?;
    fs::create_dir_all(&paths.local).map_err(|e| e.to_string())?;
    let mut mappings = Vec::new();
    let mut needs_database_rebase = false;
    if paths.data.join(MANIFEST_FILE).exists() {
        let mut manifest: Manifest = read_json(&paths.data.join(MANIFEST_FILE))?;
        needs_database_rebase = manifest.database_paths.as_ref() != Some(&paths);
        if manifest.paths != paths {
            manifest.previous.push(manifest.paths.clone());
        }
        for old in &manifest.previous {
            for (from, to) in [
                (
                    &old.cache,
                    if old.cache == old.data {
                        &paths.data
                    } else {
                        &paths.cache
                    },
                ),
                (
                    &old.local,
                    if old.local == old.data {
                        &paths.data
                    } else {
                        &paths.local
                    },
                ),
                (&old.data, &paths.data),
                (&old.config, &paths.config),
            ] {
                let pair = (
                    from.to_string_lossy().into_owned(),
                    to.to_string_lossy().into_owned(),
                );
                if from != to && !mappings.contains(&pair) {
                    mappings.push(pair);
                }
            }
        }
        // Longest prefix first when legacy local/cache directories overlap data.
        mappings.sort_by_key(|(from, _)| std::cmp::Reverse(from.len()));
        manifest.paths = paths.clone();
        write_json(&paths.data.join(MANIFEST_FILE), &manifest)?;
    }
    app.manage(DataStorage {
        paths,
        mappings,
        needs_database_rebase,
        portable,
        executable_dir,
        location_file,
        location: Mutex::new(location),
        warning: Mutex::new(warning),
    });
    Ok(())
}

pub(crate) fn data_dir(app: &AppHandle) -> PathBuf {
    app.state::<DataStorage>().paths.data.clone()
}
pub(crate) fn cache_dir(app: &AppHandle) -> PathBuf {
    app.state::<DataStorage>().paths.cache.clone()
}
pub(crate) fn webview_dir(app: &AppHandle) -> PathBuf {
    app.state::<DataStorage>().paths.local.clone()
}

pub(crate) fn mark_database_rebased(app: &AppHandle) -> Result<(), String> {
    let state = app.state::<DataStorage>();
    let path = state.paths.data.join(MANIFEST_FILE);
    let mut manifest: Manifest = read_json(&path)?;
    manifest.database_paths = Some(state.paths.clone());
    write_json(&path, &manifest)
}

fn cleanup_source(state: &DataStorage, plan: &Migration) -> Result<(), String> {
    let manifest_file = state.paths.data.join(MANIFEST_FILE);
    let mut manifest: Manifest = read_json(&manifest_file)?;
    if manifest.migration_id.as_deref() != Some(&plan.id)
        || manifest.database_paths.as_ref() != Some(&state.paths)
    {
        return Err("新目录尚未完成初始化".into());
    }
    let active = canonical(&state.paths.data)?;
    let executable = canonical(&state.executable_dir)?;
    let mut roots = Vec::new();
    for root in [
        &plan.source.data,
        &plan.source.local,
        &plan.source.cache,
        &plan.source.config,
    ] {
        if !root.exists() {
            continue;
        }
        let root = canonical(root)?;
        if root.starts_with(&active) || active.starts_with(&root) || executable.starts_with(&root) {
            return Err("原目录与正在使用的目录重叠".into());
        }
        if !roots.contains(&root) {
            roots.push(root);
        }
    }

    // Keep an existing installed copy pointed at the relocated profile, instead of recreating empty data.
    let legacy = DataPaths::legacy()?;
    let legacy_location = legacy.config.join(LOCATION_FILE);
    if legacy_location != state.location_file && installed_paths(&legacy)? == plan.source {
        write_json(
            &legacy_location,
            &Location {
                active: Some(state.paths.data.clone()),
                pending: None,
                use_legacy: false,
                cleanup: None,
            },
        )?;
    }

    let mut incomplete = false;
    for file in &manifest.copied_files {
        if let Ok(relative) = file.path.strip_prefix(&plan.source.data) {
            let name = relative
                .components()
                .next()
                .map(|part| part.as_os_str().to_string_lossy());
            if !matches!(
                name.as_deref(),
                Some(
                    "library.db"
                        | "library.db-wal"
                        | "library.db-shm"
                        | "covers"
                        | "custom-lyrics-fonts"
                        | "local"
                        | "gpu_config.json"
                        | ".window-state.json"
                        | MANIFEST_FILE
                        | ".lycia-migration-owner"
                )
            ) {
                continue;
            }
        }
        let metadata = match fs::symlink_metadata(&file.path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => continue,
            Err(_) => {
                incomplete = true;
                continue;
            }
        };
        let path = canonical(&file.path)?;
        if !roots.iter().any(|root| path.starts_with(root)) || path.starts_with(&active) {
            return Err("原数据文件不在待清理目录内".into());
        }
        // Remove only the original files that were copied, never files added or changed afterward.
        if !metadata.is_file()
            || file.modified.is_none()
            || metadata.len() != file.size
            || modified_time(&metadata) != file.modified
        {
            incomplete = true;
            continue;
        }
        if fs::remove_file(&path).is_err() {
            incomplete = true;
        }
    }
    for root in &roots {
        if !root.exists() {
            continue;
        }
        for entry in walkdir::WalkDir::new(root)
            .follow_links(false)
            .contents_first(true)
        {
            let entry = entry.map_err(|e| e.to_string())?;
            if entry.file_type().is_dir() {
                // Only remove empty directories. The location pointer and unrelated files stay in place.
                match fs::remove_dir(entry.path()) {
                    Ok(()) => {}
                    Err(error) if error.kind() == std::io::ErrorKind::DirectoryNotEmpty => {}
                    Err(_) => incomplete = true,
                }
            }
        }
    }
    if incomplete {
        return Err("部分原数据文件被占用或已发生变化，将在下次启动时重试清理".into());
    }

    {
        let mut location = state.location.lock().map_err(|e| e.to_string())?;
        let next = Location {
            cleanup: None,
            ..location.clone()
        };
        write_json(&state.location_file, &next)?;
        *location = next;
    }
    manifest.copied_files.clear();
    write_json(&manifest_file, &manifest)
}

#[tauri::command]
pub(crate) async fn complete_data_storage_migration(
    app: AppHandle,
) -> Result<DataStorageInfo, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<DataStorage>();
        let cleanup = state
            .location
            .lock()
            .map_err(|e| e.to_string())?
            .cleanup
            .clone();
        if let Some(plan) = cleanup {
            let result = cleanup_source(&state, &plan);
            *state.warning.lock().map_err(|e| e.to_string())? = result
                .err()
                .map(|e| format!("已使用新数据目录，原目录清理未完成: {e}"));
        }
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    get_data_storage_info(app)
}

#[tauri::command]
pub(crate) fn get_data_storage_info(app: AppHandle) -> Result<DataStorageInfo, String> {
    let state = app.state::<DataStorage>();
    let location = state.location.lock().map_err(|e| e.to_string())?;
    let warning = state.warning.lock().map_err(|e| e.to_string())?.clone();
    Ok(DataStorageInfo {
        path: state.paths.data.to_string_lossy().into_owned(),
        webview_path: state.paths.local.to_string_lossy().into_owned(),
        portable: state.portable,
        pending_path: location.pending.as_ref().map(|p| {
            resolve(&state.executable_dir, &p.target)
                .to_string_lossy()
                .into_owned()
        }),
        warning,
        path_mappings: state.mappings.clone(),
    })
}

#[tauri::command]
pub(crate) async fn set_data_storage_directory(
    app: AppHandle,
    path: String,
) -> Result<DataStorageInfo, String> {
    let handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = handle.state::<DataStorage>();
        let target = validate_target(Path::new(&path), &state.paths)?;
        let mut location = state.location.lock().map_err(|e| e.to_string())?;
        if location.cleanup.is_some() {
            return Err("上次迁移的原目录尚未清理完成，请重启后重试".into());
        }
        let next = Location {
            active: location.active.clone(),
            use_legacy: location.use_legacy,
            cleanup: None,
            pending: Some(Migration {
                id: Uuid::new_v4().to_string(),
                source: state.paths.clone(),
                target: stored_path(&state.executable_dir, &target, state.portable),
                source_exists: true,
                local_exists: state.paths.local.is_dir(),
                previous_pid: std::process::id(),
            }),
        };
        write_json(&state.location_file, &next)?;
        *location = next;
        Ok::<(), String>(())
    })
    .await
    .map_err(|e| e.to_string())??;
    get_data_storage_info(app)
}

#[tauri::command]
pub(crate) fn cancel_data_storage_migration(app: AppHandle) -> Result<DataStorageInfo, String> {
    {
        let state = app.state::<DataStorage>();
        let mut location = state.location.lock().map_err(|e| e.to_string())?;
        let active = location.active.clone().or_else(|| {
            state
                .paths
                .data
                .join(MANIFEST_FILE)
                .is_file()
                .then(|| stored_path(&state.executable_dir, &state.paths.data, state.portable))
        });
        let next = Location {
            use_legacy: active.is_none(),
            active,
            pending: None,
            cleanup: location.cleanup.clone(),
        };
        write_json(&state.location_file, &next)?;
        *location = next;
    }
    get_data_storage_info(app)
}

#[tauri::command]
pub(crate) fn restart_app(app: AppHandle) {
    app.request_restart();
}

pub(crate) fn rebase_database(
    conn: &mut rusqlite::Connection,
    mappings: &[(String, String)],
) -> Result<(), String> {
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for (table, column) in [
        ("songs", "cover_path"),
        ("songs", "cover_thumb_path"),
        ("songs", "cache_path"),
        ("artists", "avatar_path"),
    ] {
        // Rebase each value once, so a new root nested under a historical root cannot be rewritten twice.
        let rows = {
            let mut stmt = tx
                .prepare(&format!(
                    "SELECT rowid, {column} FROM {table} WHERE {column} IS NOT NULL"
                ))
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };
        for (id, value) in rows {
            if let Some(next) = rebase_path(&value, mappings) {
                tx.execute(
                    &format!("UPDATE {table} SET {column} = ?1 WHERE rowid = ?2"),
                    rusqlite::params![next, id],
                )
                .map_err(|e| e.to_string())?;
            }
        }
    }
    tx.commit().map_err(|e| e.to_string())
}

fn rebase_path(value: &str, mappings: &[(String, String)]) -> Option<String> {
    let normalized = value.replace('\\', "/");
    for (from, to) in mappings {
        let prefix = format!("{}/", from.replace('\\', "/").trim_end_matches('/'));
        if normalized.starts_with(&prefix) {
            return Some(format!(
                "{}/{}",
                to.replace('\\', "/").trim_end_matches('/'),
                &normalized[prefix.len()..]
            ));
        }
    }
    None
}
