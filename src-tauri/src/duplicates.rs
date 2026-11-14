use crate::music::tags::{extract_text_metadata, read_tagged_file_from_path_for_scan};
use crate::music::utils::{describe_scan_io_error, is_supported_library_extension, normalize_path};
use lofty::file::FileType;
use lofty::prelude::*;
use rusqlite::{Connection, TransactionBehavior};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Read;
use std::path::{Component, Path, PathBuf};
use std::time::UNIX_EPOCH;
use symphonia::core::codecs::CODEC_TYPE_NULL;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{Limit, MetadataOptions};
use symphonia::core::probe::Hint;
use walkdir::WalkDir;

const MAX_WARNINGS: usize = 30;

#[derive(Serialize)]
pub struct DuplicateSong {
    path: String,
    name: String,
    title: String,
    artist: String,
    album: String,
    duration: f64,
    format: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    codec: Option<String>,
    bitrate: u32,
    sample_rate: u32,
    bit_depth: u8,
    file_size: u64,
    modified_at_ms: Option<u64>,
}

#[derive(Default, Serialize)]
pub struct DuplicateScanResult {
    songs: Vec<DuplicateSong>,
    // Unique supported physical files, including files with a read failure.
    scanned_count: usize,
    skipped_count: usize,
    warnings: Vec<String>,
}

fn path_key(path: &Path) -> PathBuf {
    if cfg!(windows) {
        PathBuf::from(path.to_string_lossy().to_lowercase())
    } else {
        path.to_path_buf()
    }
}

fn supported_extension(path: &Path) -> Option<String> {
    let extension = path.extension()?.to_str()?.to_ascii_lowercase();
    is_supported_library_extension(&extension).then_some(extension)
}

fn validated_roots(root_paths: Vec<String>, recursive: bool) -> Result<Vec<PathBuf>, String> {
    if root_paths.is_empty() {
        return Err("请先选择要分析的文件夹".to_string());
    }

    let mut roots = Vec::new();
    let mut keys = HashSet::new();
    for raw_path in root_paths {
        let path = Path::new(&raw_path);
        if !path.is_absolute() {
            return Err(format!("请选择完整的本地文件夹路径：{raw_path}"));
        }
        let root = fs::canonicalize(path)
            .map_err(|error| describe_scan_io_error(path, "访问扫描文件夹", &error))?;
        let metadata = fs::metadata(&root)
            .map_err(|error| describe_scan_io_error(path, "读取文件夹信息", &error))?;
        if !metadata.is_dir() {
            return Err(format!("扫描路径不是文件夹：{raw_path}"));
        }
        // Validate every requested root, including roots later covered by another root.
        fs::read_dir(&root)
            .map_err(|error| describe_scan_io_error(path, "打开扫描文件夹", &error))?;
        if keys.insert(path_key(&root)) {
            roots.push(root);
        }
    }

    roots.sort_by_key(|root| root.components().count());
    if recursive {
        let mut included: Vec<PathBuf> = Vec::new();
        roots.retain(|root| {
            let key = path_key(root);
            if included.iter().any(|parent| key.starts_with(parent)) {
                false
            } else {
                included.push(key);
                true
            }
        });
    }
    Ok(roots)
}

fn codec_from_file_type(file_type: FileType) -> Option<String> {
    // Containers such as MP4/WAV/AIFF do not by themselves imply a codec.
    let codec = match file_type {
        FileType::Aac => "aac",
        FileType::Flac => "flac",
        FileType::Mpeg => "mp3",
        FileType::Vorbis => "vorbis",
        FileType::Opus => "opus",
        FileType::Speex => "speex",
        _ => return None,
    };
    Some(codec.to_string())
}

fn fill_audio_properties(path: &Path, song: &mut DuplicateSong) {
    let Ok(file) = fs::File::open(path) else {
        return;
    };
    let mut hint = Hint::new();
    hint.with_extension(&song.format);
    let Ok(probed) = symphonia::default::get_probe().format(
        &hint,
        MediaSourceStream::new(Box::new(file), Default::default()),
        &FormatOptions::default(),
        &MetadataOptions {
            limit_visual_bytes: Limit::Maximum(0),
            ..Default::default()
        },
    ) else {
        return;
    };
    let Some(track) = probed
        .format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
    else {
        return;
    };
    let params = &track.codec_params;
    if song.duration == 0.0 {
        if let (Some(time_base), Some(frames)) = (params.time_base, params.n_frames) {
            let time = time_base.calc_time(frames);
            song.duration = time.seconds as f64 + time.frac;
        }
    }
    if song.sample_rate == 0 {
        song.sample_rate = params.sample_rate.unwrap_or(0);
    }
    if song.bit_depth == 0 {
        song.bit_depth = params
            .bits_per_sample
            .or(params.bits_per_coded_sample)
            .and_then(|depth| u8::try_from(depth).ok())
            .unwrap_or(0);
    }
    if let Some(descriptor) = symphonia::default::get_codecs().get_codec(params.codec) {
        let codec = descriptor.short_name.to_ascii_lowercase();
        song.codec = Some(if codec.starts_with("pcm_") {
            "pcm".to_string()
        } else if codec.starts_with("adpcm_") {
            "adpcm".to_string()
        } else {
            codec
        });
    }
}

fn file_modified_at_ms(metadata: &fs::Metadata) -> Option<u64> {
    metadata
        .modified()
        .ok()?
        .duration_since(UNIX_EPOCH)
        .ok()?
        .as_millis()
        .try_into()
        .ok()
}

fn read_song(path: &Path, extension: String) -> Result<DuplicateSong, String> {
    let metadata =
        fs::metadata(path).map_err(|error| describe_scan_io_error(path, "读取文件信息", &error))?;
    // Shared scan parser explicitly disables cover-art loading and never writes tags.
    let tagged_file = read_tagged_file_from_path_for_scan(path)
        .map_err(|error| format!("读取歌曲失败：{}；{error}", path.display()))?;
    let text = extract_text_metadata(&tagged_file);
    let properties = tagged_file.properties();
    let mut song = DuplicateSong {
        path: normalize_path(&path.to_string_lossy()),
        name: path
            .file_name()
            .unwrap_or_default()
            .to_string_lossy()
            .into(),
        title: text.title.unwrap_or_default(),
        artist: text.artist.unwrap_or_default(),
        album: text.album.unwrap_or_default(),
        duration: properties.duration().as_secs_f64(),
        format: extension,
        codec: codec_from_file_type(tagged_file.file_type()),
        bitrate: properties.audio_bitrate().unwrap_or(0),
        sample_rate: properties.sample_rate().unwrap_or(0),
        bit_depth: properties.bit_depth().unwrap_or(0),
        file_size: metadata.len(),
        modified_at_ms: file_modified_at_ms(&metadata),
    };
    if song.codec.is_none() || song.duration == 0.0 || song.sample_rate == 0 {
        fill_audio_properties(path, &mut song);
    }
    Ok(song)
}

fn scan_roots(root_paths: Vec<String>, recursive: bool) -> Result<DuplicateScanResult, String> {
    let roots = validated_roots(root_paths, recursive)?;
    let mut result = DuplicateScanResult::default();
    let mut seen_files = HashSet::new();
    let mut warning_count = 0usize;
    let mut add_warning = |result: &mut DuplicateScanResult, warning: String| {
        warning_count += 1;
        if result.warnings.len() < MAX_WARNINGS {
            result.warnings.push(warning);
        }
    };

    for root in roots {
        let walker = WalkDir::new(&root)
            .follow_links(false)
            .max_depth(if recursive { usize::MAX } else { 1 });
        for entry in walker {
            let entry = match entry {
                Ok(entry) => entry,
                Err(error) => {
                    if error.depth() == 0 {
                        return Err(format!("无法读取扫描文件夹：{}；{error}", root.display()));
                    }
                    // A failed subdirectory has an unknown file count; report it, not an
                    // invented number of skipped songs.
                    if error
                        .path()
                        .is_some_and(|path| path.is_file() && supported_extension(path).is_some())
                    {
                        result.scanned_count += 1;
                        result.skipped_count += 1;
                    }
                    add_warning(&mut result, format!("无法读取扫描项目：{error}"));
                    continue;
                }
            };
            // Do not follow file symlinks either. CUE sheets/virtual tracks are excluded
            // by the same supported-audio extension list as the tag toolbox.
            if !entry.file_type().is_file() {
                continue;
            }
            let Some(extension) = supported_extension(entry.path()) else {
                continue;
            };
            let path = match fs::canonicalize(entry.path()) {
                Ok(path) => path,
                Err(error) => {
                    result.scanned_count += 1;
                    result.skipped_count += 1;
                    add_warning(
                        &mut result,
                        describe_scan_io_error(entry.path(), "访问歌曲", &error),
                    );
                    continue;
                }
            };
            if !seen_files.insert(path_key(&path)) {
                continue;
            }
            result.scanned_count += 1;
            match read_song(&path, extension) {
                Ok(song) => result.songs.push(song),
                Err(error) => {
                    result.skipped_count += 1;
                    add_warning(&mut result, error);
                }
            }
        }
    }
    if warning_count > MAX_WARNINGS {
        result.warnings.push(format!(
            "另有 {} 条读取警告未展开显示",
            warning_count - MAX_WARNINGS
        ));
    }
    result.songs.sort_unstable_by(|a, b| a.path.cmp(&b.path));
    Ok(result)
}

/// Read-only inventory of explicit folders: no library writes, cover generation or
/// file operations. File I/O stays off the UI/async executor thread.
#[tauri::command]
pub async fn scan_duplicate_songs(
    root_paths: Vec<String>,
    recursive: bool,
) -> Result<DuplicateScanResult, String> {
    tauri::async_runtime::spawn_blocking(move || scan_roots(root_paths, recursive))
        .await
        .map_err(|error| format!("重复歌曲扫描任务失败：{error}"))?
}

#[derive(Deserialize)]
pub struct DuplicateDeleteFile {
    path: String,
    expected_size: u64,
    expected_modified_at_ms: Option<u64>,
}

#[derive(Deserialize)]
pub struct DuplicateDeleteGroup {
    delete_files: Vec<DuplicateDeleteFile>,
    retained_files: Vec<DuplicateDeleteFile>,
}

#[derive(Serialize)]
pub struct DuplicateDeleteFailure {
    path: String,
    reason: String,
}

#[derive(Default, Serialize)]
pub struct DuplicateDeleteResult {
    deleted_paths: Vec<String>,
    missing_paths: Vec<String>,
    failures: Vec<DuplicateDeleteFailure>,
    warnings: Vec<String>,
}

struct PlannedDeleteFile {
    request: DuplicateDeleteFile,
    path: PathBuf,
    key: PathBuf,
    group_indexes: Vec<usize>,
    preflight_error: Option<String>,
}

struct DuplicateDeletePlan {
    files: Vec<PlannedDeleteFile>,
    retained_groups: Vec<Vec<DuplicateDeleteFile>>,
    delete_keys: HashSet<PathBuf>,
}

struct RegularAudioFile {
    path: PathBuf,
    size: u64,
    modified_at_ms: Option<u64>,
}

#[cfg(target_os = "windows")]
const DELETE_SONG_SQL: &str = "DELETE FROM songs WHERE path = ?1 COLLATE NOCASE";
#[cfg(not(target_os = "windows"))]
const DELETE_SONG_SQL: &str = "DELETE FROM songs WHERE path = ?1";

#[cfg(target_os = "windows")]
const CUE_REFERENCE_SQL: &str = "SELECT EXISTS(SELECT 1 FROM songs WHERE cue_source_path = ?1 COLLATE NOCASE OR (path = ?1 COLLATE NOCASE AND cue_source_path IS NOT NULL))";
#[cfg(not(target_os = "windows"))]
const CUE_REFERENCE_SQL: &str = "SELECT EXISTS(SELECT 1 FROM songs WHERE cue_source_path = ?1 OR (path = ?1 AND cue_source_path IS NOT NULL))";

const DELETE_UNUSED_ARTISTS_SQL: &str =
    "DELETE FROM artists WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)";

fn delete_path_key(path: &Path) -> PathBuf {
    path_key(Path::new(&normalize_path(&path.to_string_lossy())))
}

fn local_audio_path(raw: &str) -> Result<PathBuf, String> {
    let path = Path::new(raw);
    if !path.is_absolute()
        || raw.contains("://")
        || raw.contains("::track")
        || raw.contains('\0')
        || supported_extension(path).is_none()
        || path
            .components()
            .any(|component| matches!(component, Component::ParentDir))
    {
        return Err(format!(
            "只能删除完整路径指向的本地音频文件，不支持远程地址或 CUE 分轨：{raw}"
        ));
    }
    #[cfg(windows)]
    {
        use std::path::Prefix;
        if !matches!(
            path.components().next(),
            Some(Component::Prefix(prefix))
                if matches!(prefix.kind(), Prefix::Disk(_) | Prefix::VerbatimDisk(_))
        ) || path.components().any(|component| {
            matches!(component, Component::Normal(name) if name.to_string_lossy().contains(':'))
        }) {
            return Err(format!("不支持删除网络共享、设备路径或备用数据流：{raw}"));
        }
    }
    Ok(path.to_path_buf())
}

fn reject_link_metadata(path: &Path, metadata: &fs::Metadata) -> Result<(), String> {
    let is_link = metadata.file_type().is_symlink();
    #[cfg(windows)]
    let is_link = {
        use std::os::windows::fs::MetadataExt;
        is_link || metadata.file_attributes() & 0x400 != 0
    };
    if is_link {
        return Err(format!(
            "不支持删除或保留符号链接、连接点及重解析点：{}",
            path.display()
        ));
    }
    Ok(())
}

fn inspect_regular_audio(path: &Path) -> Result<Option<RegularAudioFile>, String> {
    // Check parents too: a directory junction must not redirect an old scan path.
    for parent in path.ancestors().skip(1) {
        match fs::symlink_metadata(parent) {
            Ok(metadata) => reject_link_metadata(parent, &metadata)?,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(describe_scan_io_error(parent, "检查歌曲路径", &error)),
        }
    }
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(describe_scan_io_error(path, "检查歌曲", &error)),
    };
    reject_link_metadata(path, &metadata)?;
    if !metadata.is_file() || supported_extension(path).is_none() {
        return Err(format!("不是支持的常规音频文件：{}", path.display()));
    }
    let canonical = fs::canonicalize(path)
        .map_err(|error| describe_scan_io_error(path, "确认歌曲路径", &error))?;
    Ok(Some(RegularAudioFile {
        path: canonical,
        size: metadata.len(),
        modified_at_ms: file_modified_at_ms(&metadata),
    }))
}

fn prepare_duplicate_delete_plan(
    groups: Vec<DuplicateDeleteGroup>,
) -> Result<DuplicateDeletePlan, String> {
    if groups.is_empty() {
        return Err("没有选中要删除的重复歌曲".to_string());
    }
    let mut files: Vec<PlannedDeleteFile> = Vec::new();
    let mut file_indexes: HashMap<PathBuf, usize> = HashMap::new();
    let mut retained_groups = Vec::new();
    for (group_index, group) in groups.into_iter().enumerate() {
        if group.delete_files.is_empty() || group.retained_files.is_empty() {
            return Err("删除计划无效：每组必须有待删除文件并明确保留至少一个版本".to_string());
        }
        for retained in &group.retained_files {
            local_audio_path(&retained.path)?;
        }
        retained_groups.push(group.retained_files);
        for request in group.delete_files {
            let requested_path = local_audio_path(&request.path)?;
            let key = delete_path_key(&requested_path);
            if let Some(index) = file_indexes.get(&key).copied() {
                if files[index].request.expected_size != request.expected_size
                    || files[index].request.expected_modified_at_ms
                        != request.expected_modified_at_ms
                {
                    return Err("同一文件出现了冲突的扫描信息，请重新扫描后再删除".to_string());
                }
                if !files[index].group_indexes.contains(&group_index) {
                    files[index].group_indexes.push(group_index);
                }
                continue;
            }
            let (path, mut preflight_error) = match inspect_regular_audio(&requested_path) {
                Ok(Some(file)) => (
                    file.path,
                    file.modified_at_ms.is_none().then(|| {
                        "无法取得文件修改时间，文件未删除；请重新扫描后再操作".to_string()
                    }),
                ),
                Ok(None) => (requested_path, None),
                Err(error) => (requested_path, Some(error)),
            };
            if request.expected_modified_at_ms.is_none() {
                preflight_error =
                    Some("扫描结果缺少文件修改时间，文件未删除；请重新扫描后再操作".into());
            }
            file_indexes.insert(key.clone(), files.len());
            files.push(PlannedDeleteFile {
                request,
                path,
                key,
                group_indexes: vec![group_index],
                preflight_error,
            });
        }
    }
    let delete_keys: HashSet<PathBuf> = file_indexes.into_keys().collect();
    if retained_groups
        .iter()
        .flatten()
        .any(|file| delete_keys.contains(&delete_path_key(Path::new(&file.path))))
    {
        return Err("删除计划无效：保留文件也出现在待删除列表中，所有文件均未删除".to_string());
    }
    Ok(DuplicateDeletePlan {
        files,
        retained_groups,
        delete_keys,
    })
}

fn decode_cue_reference_text(bytes: &[u8]) -> Result<String, String> {
    if bytes.starts_with(&[0xff, 0xfe]) || bytes.starts_with(&[0xfe, 0xff]) {
        let decoder = if bytes.starts_with(&[0xff, 0xfe]) {
            encoding_rs::UTF_16LE
        } else {
            encoding_rs::UTF_16BE
        };
        let (text, _, invalid) = decoder.decode(bytes);
        return if invalid {
            Err("CUE 编码无效".into())
        } else {
            Ok(text.into_owned())
        };
    }
    if let Ok(text) = std::str::from_utf8(bytes) {
        return Ok(text.to_string());
    }
    for decoder in [encoding_rs::GBK, encoding_rs::SHIFT_JIS] {
        let (text, _, invalid) = decoder.decode(bytes);
        if !invalid {
            return Ok(text.into_owned());
        }
    }
    Err("无法可靠解析 CUE 文件编码".into())
}

fn reject_adjacent_cue_reference(audio_path: &Path) -> Result<(), String> {
    const MAX_CUE_BYTES: u64 = 1024 * 1024;
    let parent = audio_path.parent().ok_or("音频文件缺少父文件夹")?;
    let entries = fs::read_dir(parent)
        .map_err(|error| describe_scan_io_error(parent, "检查 CUE 引用", &error))?;
    let audio_key = delete_path_key(audio_path);
    for entry in entries {
        let entry = entry.map_err(|error| format!("无法检查同目录 CUE 引用：{error}"))?;
        let cue_path = entry.path();
        if !cue_path
            .extension()
            .is_some_and(|ext| ext.eq_ignore_ascii_case("cue"))
        {
            continue;
        }
        let check = || -> Result<(), String> {
            let metadata = fs::symlink_metadata(&cue_path).map_err(|error| error.to_string())?;
            // A directory called *.cue is not a sidecar file.
            if metadata.is_dir() && !metadata.file_type().is_symlink() {
                return Ok(());
            }
            reject_link_metadata(&cue_path, &metadata)?;
            if !metadata.is_file() || metadata.len() > MAX_CUE_BYTES {
                return Err("CUE 不是可安全读取的常规文件或文件过大".into());
            }
            let mut bytes = Vec::new();
            fs::File::open(&cue_path)
                .map_err(|error| error.to_string())?
                .take(MAX_CUE_BYTES + 1)
                .read_to_end(&mut bytes)
                .map_err(|error| error.to_string())?;
            if bytes.len() as u64 > MAX_CUE_BYTES {
                return Err("CUE 文件过大".into());
            }
            let text = decode_cue_reference_text(&bytes)?;
            let mut file_directives = 0;
            // The library CUE parser stores only its final FILE directive. Inspect all
            // references here so a multi-file sheet cannot bypass deletion protection.
            for line in text.lines() {
                let line = line.trim().trim_start_matches('\u{feff}');
                let keyword_end = line.find(char::is_whitespace).unwrap_or(line.len());
                if !line[..keyword_end].eq_ignore_ascii_case("FILE") {
                    continue;
                }
                file_directives += 1;
                let rest = line[keyword_end..].trim();
                let quoted = rest
                    .strip_prefix('"')
                    .ok_or("CUE FILE 指令格式无法可靠解析")?;
                let quote_end = quoted.find('"').ok_or("CUE FILE 指令缺少闭引号")?;
                let name = &quoted[..quote_end];
                if name.is_empty() || quoted[quote_end + 1..].trim().is_empty() {
                    return Err("CUE FILE 指令不完整".into());
                }
                let referenced = parent.join(name);
                let canonical = fs::canonicalize(&referenced).map_err(|error| {
                    format!("无法确认 CUE 引用文件 {}：{error}", referenced.display())
                })?;
                if delete_path_key(&canonical) == audio_key {
                    return Err("音频被 CUE 分轨引用，请按整张专辑管理，不可单独删除".into());
                }
            }
            if file_directives == 0 {
                return Err("CUE 缺少可识别的 FILE 指令".into());
            }
            Ok(())
        };
        check().map_err(|reason| {
            format!(
                "为保护 CUE 分轨已跳过此音频（{}）：{reason}",
                cue_path.display()
            )
        })?;
    }
    Ok(())
}

fn hold_retained_audio(
    files: &[DuplicateDeleteFile],
    delete_keys: &HashSet<PathBuf>,
) -> Result<fs::File, String> {
    for expected in files {
        let Some(expected_modified_at_ms) = expected.expected_modified_at_ms else {
            continue;
        };
        let Ok(Some(file)) = inspect_regular_audio(Path::new(&expected.path)) else {
            continue;
        };
        if file.size == 0
            || file.size != expected.expected_size
            || file.modified_at_ms != Some(expected_modified_at_ms)
            || delete_keys.contains(&delete_path_key(&file.path))
        {
            continue;
        }
        let mut options = fs::OpenOptions::new();
        options.read(true);
        #[cfg(windows)]
        {
            use std::os::windows::fs::OpenOptionsExt;
            // Allow listening, but hold the preserved copy against modification or
            // removal until this deletion finishes. Pause alone would not do this.
            options.share_mode(0x1);
        }
        let Ok(handle) = options.open(&file.path) else {
            continue;
        };
        // Opening the Windows handle acquires the preservation lock. Revalidate its
        // metadata, not another pathname lookup, to cover replacement before opening.
        let Ok(held_metadata) = handle.metadata() else {
            continue;
        };
        if !held_metadata.is_file()
            || held_metadata.len() != expected.expected_size
            || file_modified_at_ms(&held_metadata) != Some(expected_modified_at_ms)
        {
            continue;
        }
        let Some(extension) = supported_extension(&file.path) else {
            continue;
        };
        let Ok(song) = read_song(&file.path, extension) else {
            continue;
        };
        if song.file_size == expected.expected_size
            && song.modified_at_ms == Some(expected_modified_at_ms)
            && (song.duration > 0.0 || song.sample_rate > 0)
        {
            return Ok(handle);
        }
    }
    Err("本组没有与扫描快照一致的可读保留音频，文件可能已变化、丢失、损坏或被占用；请重新扫描后再删除".into())
}

enum PhysicalDeleteOutcome {
    Deleted,
    Missing,
}

fn delete_planned_file(
    conn: &Connection,
    file: &PlannedDeleteFile,
    retained_groups: &[Vec<DuplicateDeleteFile>],
    delete_keys: &HashSet<PathBuf>,
) -> Result<PhysicalDeleteOutcome, String> {
    let expected_modified_at_ms = file
        .request
        .expected_modified_at_ms
        .ok_or("扫描结果缺少文件修改时间，文件未删除；请重新扫描后再操作")?;
    let Some(current) = inspect_regular_audio(&file.path)? else {
        return Ok(PhysicalDeleteOutcome::Missing);
    };
    if current.modified_at_ms.is_none() {
        return Err("无法取得文件修改时间，文件未删除；请重新扫描后再操作".into());
    }
    if current.size != file.request.expected_size
        || current.modified_at_ms != Some(expected_modified_at_ms)
        || delete_path_key(&current.path) != file.key
    {
        return Err("文件大小、修改时间或实际路径已变化，请重新扫描后再删除".into());
    }
    let normalized = normalize_path(&current.path.to_string_lossy());
    let cue_reference: bool = conn
        .query_row(CUE_REFERENCE_SQL, [&normalized], |row| row.get(0))
        .map_err(|error| format!("无法确认音乐库中的 CUE 引用，文件未删除：{error}"))?;
    if cue_reference {
        return Err("音频被音乐库中的 CUE 分轨引用，请按整张专辑管理，不可单独删除".into());
    }
    let mut retained_handles = Vec::new();
    for index in &file.group_indexes {
        retained_handles.push(hold_retained_audio(&retained_groups[*index], delete_keys)?);
    }
    reject_adjacent_cue_reference(&current.path)?;
    // Recheck immediately before unlink, after potentially slow tag/CUE reads.
    let Some(latest) = inspect_regular_audio(&file.path)? else {
        return Ok(PhysicalDeleteOutcome::Missing);
    };
    if latest.modified_at_ms.is_none() {
        return Err("删除前无法取得文件修改时间，文件未删除；请重新扫描后再操作".into());
    }
    if latest.size != file.request.expected_size
        || latest.modified_at_ms != Some(expected_modified_at_ms)
        || delete_path_key(&latest.path) != file.key
    {
        return Err("删除前检测到文件大小、修改时间或路径变化，请重新扫描后再删除".into());
    }
    let outcome = match fs::remove_file(&latest.path) {
        Ok(()) => Ok(PhysicalDeleteOutcome::Deleted),
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            Ok(PhysicalDeleteOutcome::Missing)
        }
        Err(error) => Err(describe_scan_io_error(&latest.path, "删除音频文件", &error)),
    };
    drop(retained_handles);
    outcome
}

fn apply_duplicate_delete_plan(
    conn: &mut Connection,
    plan: DuplicateDeletePlan,
) -> Result<DuplicateDeleteResult, String> {
    // SQL/schema failures must be discovered before touching any physical files.
    for sql in [
        CUE_REFERENCE_SQL,
        DELETE_SONG_SQL,
        DELETE_UNUSED_ARTISTS_SQL,
    ] {
        conn.prepare(sql)
            .map_err(|error| format!("数据库预检失败，所有文件均未删除：{error}"))?;
    }
    let mut result = DuplicateDeleteResult::default();
    let mut database_healthy = true;
    for file in &plan.files {
        let preflight_error = file.preflight_error.clone().or_else(|| {
            (!database_healthy).then(|| "数据库同步失败，已停止后续删除；请刷新音乐库后重试".into())
        });
        if let Some(reason) = preflight_error {
            result.failures.push(DuplicateDeleteFailure {
                path: file.request.path.clone(),
                reason,
            });
            continue;
        }
        let tx = match conn.transaction_with_behavior(TransactionBehavior::Immediate) {
            Ok(tx) => tx,
            Err(error) => {
                database_healthy = false;
                result.failures.push(DuplicateDeleteFailure {
                    path: file.request.path.clone(),
                    reason: format!("数据库写入预检失败，文件未删除：{error}"),
                });
                continue;
            }
        };
        match delete_planned_file(&tx, file, &plan.retained_groups, &plan.delete_keys) {
            Ok(PhysicalDeleteOutcome::Deleted) => {
                result.deleted_paths.push(file.request.path.clone())
            }
            Ok(PhysicalDeleteOutcome::Missing) => {
                result.missing_paths.push(file.request.path.clone())
            }
            Err(reason) => {
                result.failures.push(DuplicateDeleteFailure {
                    path: file.request.path.clone(),
                    reason,
                });
                continue;
            }
        }
        let normalized = normalize_path(&file.path.to_string_lossy());
        let synchronization = tx
            .execute(DELETE_SONG_SQL, [&normalized])
            .and_then(|_| tx.commit());
        if let Err(error) = synchronization {
            database_healthy = false;
            // Never pretend that a permanently removed file survived a database error.
            result.warnings.push(format!(
                "文件已不在原位置，但音乐库记录清理失败（{}）：{error}；已停止后续删除，请刷新音乐库",
                file.request.path
            ));
        }
    }
    if !result.deleted_paths.is_empty() || !result.missing_paths.is_empty() {
        if let Err(error) = conn.execute(DELETE_UNUSED_ARTISTS_SQL, []) {
            result.warnings.push(format!(
                "文件处理已完成，但歌手目录清理失败：{error}；请刷新音乐库"
            ));
        }
    }
    Ok(result)
}

/// Irreversible deletion is isolated from the scan and from the legacy single-file
/// command. Every reported success is a physical outcome, independent of DB cleanup.
#[tauri::command]
pub async fn delete_duplicate_songs(
    groups: Vec<DuplicateDeleteGroup>,
    db_state: tauri::State<'_, crate::database::DbState>,
) -> Result<DuplicateDeleteResult, String> {
    let connection = db_state.conn.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let plan = prepare_duplicate_delete_plan(groups)?;
        let mut conn = connection
            .lock()
            .map_err(|error| format!("无法取得音乐库连接，所有文件均未删除：{error}"))?;
        apply_duplicate_delete_plan(&mut conn, plan)
    })
    .await
    .map_err(|error| format!("删除任务返回异常，请重新扫描确认文件状态：{error}"))?
}
