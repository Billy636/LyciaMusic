use super::super::cue;
use super::super::types::Song;
use super::super::utils::{
    descendant_like_patterns, describe_scan_io_error, is_cue_file_extension, is_dot_prefixed_path,
    normalize_path,
};
use super::parser::{
    build_cue_track_song, enrich_album_groups, parse_song_for_scan, preferred_parse_workers,
    song_identity_missing, song_metadata_incomplete,
};
use super::progress::ScanProgressReporter;
use super::{
    clamp_i64_to_u32, deserialize_string_list, i64_to_bool, i64_to_u64_opt, i64_to_u8_opt,
    ScanOptions,
};
use crate::music::scan_settings::LocalScanRules;
use rayon::prelude::*;
use rusqlite::params;
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use walkdir::WalkDir;

pub(super) struct DbSongSnapshot {
    pub(super) song: Song,
    pub(super) file_modified_at: Option<i64>,
    pub(super) file_size: i64,
}

pub(super) struct ScanDiff {
    pub(super) songs: Vec<Song>,
    pub(super) to_add: Vec<Song>,
    pub(super) to_update: Vec<Song>,
    pub(super) to_delete: Vec<String>,
    #[allow(dead_code)]
    pub(super) has_disk_songs: bool,
    pub(super) warnings: Vec<String>,
    pub(super) excluded_paths: Vec<String>,
}

struct DiskCandidate {
    path: PathBuf,
    path_str: String,
    ext: String,
    disk_mtime: Option<i64>,
    disk_size: i64,
    cue_audio_path: Option<String>,
}

struct ParseTask {
    index: usize,
    path: PathBuf,
    path_str: String,
    ext: String,
    change: ChangeKind,
}

#[derive(Clone, Copy, Eq, PartialEq)]
enum ChangeKind {
    Add,
    Update,
}

enum ParsedTaskResult {
    Song {
        index: usize,
        song: Song,
        change: ChangeKind,
    },
    Delete {
        index: usize,
        path: String,
    },
}

fn song_meets_duration_threshold(song: &Song, options: ScanOptions) -> bool {
    options.minimum_duration_seconds == 0 || song.duration >= options.minimum_duration_seconds
}

pub(super) fn load_db_snapshot_for_folder(
    conn: &rusqlite::Connection,
    normalized_folder: &str,
) -> Result<HashMap<String, DbSongSnapshot>, String> {
    let (pattern_forward, pattern_back) = descendant_like_patterns(normalized_folder);
    let mut snapshot = HashMap::new();

    let mut stmt = conn
        .prepare(
                "SELECT id, path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, is_various_artists_album, collapse_artist_credits, duration, cover_thumb_path, bitrate, sample_rate, bit_depth, format, container, codec, file_size, track_number, disc_number, added_at, file_modified_at, cue_source_path, cue_start_offset, cue_end_offset, comment, genre
             FROM songs
             WHERE path = ?1
                OR path LIKE ?2 ESCAPE '^'
                OR path LIKE ?3 ESCAPE '^'",
        )
        .map_err(|error| error.to_string())?;

    let rows = stmt
        .query_map(
            params![normalized_folder, pattern_forward, pattern_back],
            |row| {
                let path: String = row.get(1)?;
                let duration = clamp_i64_to_u32(row.get::<_, Option<i64>>(11)?.unwrap_or(0));
                let cover_thumb_path = row.get::<_, Option<String>>(12)?;
                let bitrate = clamp_i64_to_u32(row.get::<_, Option<i64>>(13)?.unwrap_or(0));
                let sample_rate = clamp_i64_to_u32(row.get::<_, Option<i64>>(14)?.unwrap_or(0));
                let bit_depth = i64_to_u8_opt(row.get::<_, Option<i64>>(15)?);
                let file_size_i64 = row.get::<_, Option<i64>>(19)?.unwrap_or(0).max(0);
                let track_number = row.get::<_, Option<String>>(20)?;
                let disc_number = row.get::<_, Option<String>>(21)?;
                let added_at_i64 = row.get::<_, Option<i64>>(22)?;
                let file_modified_at_i64 = row.get::<_, Option<i64>>(23)?;
                let artist_names = deserialize_string_list(row.get::<_, Option<String>>(4)?);
                let effective_artist_names =
                    deserialize_string_list(row.get::<_, Option<String>>(5)?);

                let name = Path::new(&path)
                    .file_name()
                    .map(|name| name.to_string_lossy().into_owned())
                    .unwrap_or_else(|| path.clone());

                Ok((
                    path.clone(),
                    DbSongSnapshot {
                        file_modified_at: file_modified_at_i64,
                        file_size: file_size_i64,
                        song: Song {
                            id: row.get::<_, i64>(0).ok(),
                            artist_avatar_bytes: None,
                            name,
                            path,
                            title: row.get::<_, Option<String>>(2)?.unwrap_or_default(),
                            artist: row.get::<_, Option<String>>(3)?.unwrap_or_default(),
                            artist_names,
                            effective_artist_names,
                            album: row.get::<_, Option<String>>(6)?.unwrap_or_default(),
                            album_artist: row.get::<_, Option<String>>(7)?.unwrap_or_default(),
                            album_key: row.get::<_, Option<String>>(8)?.unwrap_or_default(),
                            is_various_artists_album: i64_to_bool(row.get::<_, Option<i64>>(9)?),
                            collapse_artist_credits: i64_to_bool(row.get::<_, Option<i64>>(10)?),
                            duration,
                            cover_thumb_path,
                            bitrate,
                            sample_rate,
                            bit_depth,
                            format: row.get::<_, Option<String>>(16)?.unwrap_or_default(),
                            container: row.get::<_, Option<String>>(17)?,
                            codec: row.get::<_, Option<String>>(18)?,
                            file_size: file_size_i64 as u64,
                            track_number,
                            disc_number,
                            added_at: i64_to_u64_opt(added_at_i64),
                            file_modified_at: i64_to_u64_opt(file_modified_at_i64),
                            cue_source_path: row.get::<_, Option<String>>(24)?,
                            cue_start_offset: row.get::<_, Option<i64>>(25)?.map(|v| v as u32),
                            cue_end_offset: row.get::<_, Option<i64>>(26)?.map(|v| v as u32),
                            comment: row.get::<_, Option<String>>(27)?,
                            genre: row.get::<_, Option<String>>(28)?,
                            artist_avatar_path: None,
                        },
                    },
                ))
            },
        )
        .map_err(|error| error.to_string())?;

    for row in rows.flatten() {
        snapshot.insert(row.0, row.1);
    }

    Ok(snapshot)
}

fn collect_disk_candidates(
    normalized_folder: &str,
    reporter: Option<&ScanProgressReporter>,
    rules: &LocalScanRules,
    warnings: &mut Vec<String>,
    preserved_cues: &mut Vec<String>,
    replaced_audio_paths: &mut Vec<String>,
) -> Result<Vec<DiskCandidate>, String> {
    let mut candidates = Vec::new();
    let mut discovered = 0usize;

    if let Some(reporter) = reporter {
        reporter.emit_collecting(0, 0, Some("正在扫描文件夹".to_string()));
    }

    let mut it = WalkDir::new(normalized_folder).into_iter();
    while let Some(entry) = next_visible_walk_entry(&mut it, rules)? {
        let path = entry.path();
        if entry.file_type().is_dir() {
            continue;
        }

        let ext = match path.extension() {
            Some(ext) => ext.to_string_lossy().to_lowercase(),
            None => continue,
        };

        if !rules.includes_audio(path) {
            continue;
        }

        let metadata = match std::fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => return Err(describe_scan_io_error(path, "读取文件信息", &error)),
        };
        if !metadata.is_file() {
            continue;
        }

        let raw_path_str = path.to_string_lossy().to_string();
        let path_str = normalize_path(&raw_path_str);

        discovered += 1;
        candidates.push(DiskCandidate {
            path: path.to_path_buf(),
            path_str,
            ext,
            disk_mtime: metadata
                .modified()
                .ok()
                .and_then(|time| time.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|duration| duration.as_secs() as i64),
            disk_size: metadata.len() as i64,
            cue_audio_path: None,
        });

        if let Some(reporter) = reporter {
            if discovered == 1 || discovered % 200 == 0 {
                reporter.emit_collecting(
                    discovered,
                    0,
                    Some(format!("已发现 {} 首候选歌曲", discovered)),
                );
            }
        }
    }

    // Collect CUE sheet tracks and record referenced audio paths
    let mut cue_referenced_audio: Vec<String> = Vec::new();

    let mut it = WalkDir::new(normalized_folder).into_iter();
    while rules.settings.read_cue {
        let Some(entry) = next_visible_walk_entry(&mut it, rules)? else {
            break;
        };
        let path = entry.path();
        if entry.file_type().is_dir() {
            continue;
        }

        let ext = match path.extension() {
            Some(ext) => ext.to_string_lossy().to_lowercase(),
            None => continue,
        };

        if !is_cue_file_extension(&ext) {
            continue;
        }

        let metadata = match std::fs::metadata(path) {
            Ok(metadata) => metadata,
            Err(error) => {
                warnings.push(describe_scan_io_error(path, "读取 CUE 文件信息", &error));
                preserved_cues.push(normalize_path(&path.to_string_lossy()));
                continue;
            }
        };
        if !metadata.is_file() {
            continue;
        }
        let cue_file_mtime = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64);
        let cue_file_size = metadata.len() as i64;

        let cue_path_str = normalize_path(&path.to_string_lossy().to_string());

        let sheet = match cue::parse_cue_file(path) {
            Ok(sheet) => sheet,
            Err(error) => {
                warnings.push(format!("已跳过 CUE：{}；{error}", path.display()));
                // Only temporary I/O failures preserve old tracks. A confirmed
                // invalid sheet or missing source no longer belongs in the library.
                if matches!(error, cue::CueParseError::Io(_)) {
                    preserved_cues.push(cue_path_str);
                }
                continue;
            }
        };
        if !rules.includes_audio(&sheet.resolved_audio_path) {
            continue;
        }
        let resolved = normalize_path(&sheet.resolved_audio_path.to_string_lossy());
        cue_referenced_audio.push(resolved.clone());

        for track in &sheet.tracks {
            let synthetic_path = format!("{}::track{:02}", cue_path_str, track.track_number);
            candidates.push(DiskCandidate {
                path: PathBuf::from(&synthetic_path),
                path_str: synthetic_path,
                ext: "cue_track".to_string(),
                disk_mtime: cue_file_mtime,
                disk_size: cue_file_size,
                cue_audio_path: Some(resolved.clone()),
            });
        }
    }

    // Filter out audio files that are referenced by CUE sheets
    if !cue_referenced_audio.is_empty() {
        candidates.retain(|c| !cue_referenced_audio.contains(&c.path_str));
    }
    *replaced_audio_paths = cue_referenced_audio;

    if let Some(reporter) = reporter {
        reporter.emit_collecting(
            candidates.len(),
            candidates.len(),
            Some(format!(
                "已完成文件收集，共 {} 首候选歌曲",
                candidates.len()
            )),
        );
    }

    Ok(candidates)
}

fn should_skip_dot_prefixed_child_directory(entry: &walkdir::DirEntry) -> bool {
    entry.depth() > 0 && entry.file_type().is_dir() && is_dot_prefixed_path(entry.path())
}

fn describe_walk_error(error: &walkdir::Error) -> String {
    let path = error.path().unwrap_or_else(|| Path::new(""));
    match error.io_error() {
        Some(error) => describe_scan_io_error(path, "扫描目录", error),
        None => format!("扫描目录失败：{}；{error}", path.display()),
    }
}

fn next_visible_walk_entry(
    iter: &mut walkdir::IntoIter,
    rules: &LocalScanRules,
) -> Result<Option<walkdir::DirEntry>, String> {
    loop {
        let entry = match iter.next() {
            None => return Ok(None),
            Some(Err(error)) => return Err(describe_walk_error(&error)),
            Some(Ok(entry)) => entry,
        };

        if should_skip_dot_prefixed_child_directory(&entry)
            || (entry.file_type().is_dir() && rules.excludes_directory(entry.path()))
        {
            iter.skip_current_dir();
            continue;
        }

        return Ok(Some(entry));
    }
}

fn parse_tasks_in_parallel(
    tasks: Vec<ParseTask>,
    reporter: Option<ScanProgressReporter>,
    options: ScanOptions,
) -> Result<Vec<ParsedTaskResult>, String> {
    if tasks.is_empty() {
        return Ok(Vec::new());
    }

    let total = tasks.len();
    let worker_count = preferred_parse_workers(total);
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(worker_count)
        .build()
        .map_err(|error| error.to_string())?;

    let results = pool.install(|| {
        tasks
            .into_par_iter()
            .map(|task| {
                let parsed = parse_song_for_scan(&task.path, &task.path_str, &task.ext);

                if let Some(reporter) = reporter.as_ref() {
                    reporter.advance_parsing(total);
                }

                let parsed = parsed?;
                if parsed.is_none()
                    && task.change == ChangeKind::Update
                    && options.force_metadata_refresh
                {
                    return Err(format!("无法重新读取歌曲信息：{}", task.path_str));
                }

                Ok(parsed.and_then(|song| {
                    if song_meets_duration_threshold(&song, options) {
                        return Some(ParsedTaskResult::Song {
                            index: task.index,
                            song,
                            change: task.change,
                        });
                    }

                    (task.change == ChangeKind::Update).then(|| ParsedTaskResult::Delete {
                        index: task.index,
                        path: task.path_str,
                    })
                }))
            })
            .collect::<Result<Vec<Option<ParsedTaskResult>>, String>>()
    });

    Ok(results?.into_iter().flatten().collect())
}

fn probe_audio_duration_ms(path: &Path) -> Result<Option<u32>, String> {
    use symphonia::core::codecs::CODEC_TYPE_NULL;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path)
        .map_err(|error| describe_scan_io_error(path, "读取 CUE 音源", &error))?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = match symphonia::default::get_probe().format(
        &hint,
        media_source,
        &FormatOptions::default(),
        &MetadataOptions::default(),
    ) {
        Ok(probed) => probed,
        Err(symphonia::core::errors::Error::IoError(error))
            if error.kind() != std::io::ErrorKind::UnexpectedEof =>
        {
            return Err(describe_scan_io_error(path, "解析 CUE 音源", &error))
        }
        Err(_) => return Ok(None),
    };
    let Some(track) = probed
        .format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)
    else {
        return Ok(None);
    };
    let seconds = if let (Some(time_base), Some(frames)) =
        (track.codec_params.time_base, track.codec_params.n_frames)
    {
        if frames > 0 {
            let time = time_base.calc_time(frames);
            time.seconds.saturating_add(u64::from(time.frac > 0.0))
        } else {
            0
        }
    } else {
        0
    };

    let seconds = if seconds == 0 {
        if crate::music::tags::is_mp4_path(path) {
            crate::music::tags::probe_mp4_duration(path).unwrap_or(0) as u64
        } else {
            0
        }
    } else {
        seconds
    };

    if seconds > 0 {
        Ok(Some((seconds.min(u32::MAX as u64) * 1000) as u32))
    } else {
        Ok(None)
    }
}

fn process_cue_parse_tasks(
    tasks: &[ParseTask],
    options: ScanOptions,
    warnings: &mut Vec<String>,
    rules: &LocalScanRules,
    excluded_paths: &mut Vec<String>,
) -> Result<Vec<ParsedTaskResult>, String> {
    if tasks.is_empty() {
        return Ok(Vec::new());
    }

    let mut grouped: HashMap<String, Vec<&ParseTask>> = HashMap::new();
    for task in tasks {
        // Extract CUE file path from synthetic path: "{cue_path}::track{NN}"
        if let Some(cue_path) = task.path_str.split("::track").next() {
            grouped.entry(cue_path.to_string()).or_default().push(task);
        }
    }

    let mut results = Vec::new();
    for (cue_path, group_tasks) in grouped {
        let cue_path_buf = PathBuf::from(&cue_path);
        let sheet = match cue::parse_cue_file(&cue_path_buf) {
            Ok(s) => s,
            Err(error) => {
                warnings.push(format!("已跳过 CUE：{cue_path}；{error}"));
                if !matches!(error, cue::CueParseError::Io(_)) {
                    for task in group_tasks {
                        if task.change == ChangeKind::Update {
                            results.push(ParsedTaskResult::Delete {
                                index: task.index,
                                path: task.path_str.clone(),
                            });
                        }
                    }
                }
                continue;
            }
        };
        if !rules.includes_audio(&sheet.resolved_audio_path) {
            for task in group_tasks {
                if task.change == ChangeKind::Update {
                    excluded_paths.push(task.path_str.clone());
                    results.push(ParsedTaskResult::Delete {
                        index: task.index,
                        path: task.path_str.clone(),
                    });
                }
            }
            continue;
        }
        let flac_path = sheet.resolved_audio_path.to_string_lossy().to_string();
        let flac_duration_ms = match probe_audio_duration_ms(&sheet.resolved_audio_path) {
            Ok(duration) => duration.unwrap_or(0),
            Err(error) => {
                warnings.push(format!("已跳过 CUE：{cue_path}；{error}"));
                continue;
            }
        };
        let cue_path_normalized = normalize_path(&cue_path);
        let mut warned_track_change = false;

        for task in group_tasks {
            // Extract track number from synthetic path
            let track_number: u32 = task
                .path_str
                .rsplit("::track")
                .next()
                .and_then(|s| s.parse().ok())
                .unwrap_or(0);

            let track = match sheet.tracks.iter().find(|t| t.track_number == track_number) {
                Some(t) => t,
                None => {
                    if !warned_track_change {
                        warnings.push(format!("扫描过程中 CUE 曲目发生变化：{cue_path}"));
                        warned_track_change = true;
                    }
                    if task.change == ChangeKind::Update {
                        results.push(ParsedTaskResult::Delete {
                            index: task.index,
                            path: task.path_str.clone(),
                        });
                    }
                    continue;
                }
            };

            if let Some(song) = build_cue_track_song(
                &cue_path_normalized,
                &flac_path,
                track,
                sheet.album_title.as_deref(),
                sheet.album_performer.as_deref(),
                flac_duration_ms,
            ) {
                if song_meets_duration_threshold(&song, options) {
                    results.push(ParsedTaskResult::Song {
                        index: task.index,
                        song,
                        change: task.change,
                    });
                } else if task.change == ChangeKind::Update {
                    results.push(ParsedTaskResult::Delete {
                        index: task.index,
                        path: task.path_str.clone(),
                    });
                }
            }
        }
    }

    Ok(results)
}

#[cfg(test)]
pub(super) fn collect_scan_diff(
    normalized_folder: &str,
    db_snapshot: HashMap<String, DbSongSnapshot>,
    reporter: Option<&ScanProgressReporter>,
    options: ScanOptions,
) -> Result<ScanDiff, String> {
    collect_scan_diff_with_rules(
        normalized_folder,
        db_snapshot,
        reporter,
        options,
        &LocalScanRules::defaults(normalized_folder),
    )
}

pub(super) fn collect_scan_diff_with_rules(
    normalized_folder: &str,
    mut db_snapshot: HashMap<String, DbSongSnapshot>,
    reporter: Option<&ScanProgressReporter>,
    options: ScanOptions,
    rules: &LocalScanRules,
) -> Result<ScanDiff, String> {
    let mut warnings = Vec::new();
    let mut preserved_cues = Vec::new();
    let mut replaced_audio_paths = Vec::new();
    let candidates = collect_disk_candidates(
        normalized_folder,
        reporter,
        rules,
        &mut warnings,
        &mut preserved_cues,
        &mut replaced_audio_paths,
    )?;
    let has_disk_songs = !candidates.is_empty();
    let mut excluded_paths = db_snapshot
        .iter()
        .filter(|(path, snapshot)| {
            rules.excludes_song(&snapshot.song) || replaced_audio_paths.contains(path)
        })
        .map(|(path, _)| path.clone())
        .collect::<Vec<_>>();
    let mut songs_by_index: Vec<Option<Song>> = vec![None; candidates.len()];
    let mut changes_by_index = vec![None; candidates.len()];
    let mut parse_tasks = Vec::new();
    let mut to_delete = Vec::new();

    let preserved_paths = db_snapshot
        .iter()
        .filter(|(path, snapshot)| {
            rules.is_delegated_song(&snapshot.song)
                || (path.split("::track").next().is_some_and(|cue| {
                    preserved_cues.iter().any(|preserved| {
                        if cfg!(windows) {
                            cue.eq_ignore_ascii_case(preserved)
                        } else {
                            cue == preserved
                        }
                    })
                }) && !excluded_paths.contains(path))
        })
        .map(|(path, _)| path.clone())
        .collect::<Vec<_>>();
    for path in preserved_paths {
        if let Some(snapshot) = db_snapshot.remove(&path) {
            songs_by_index.push(Some(snapshot.song));
            changes_by_index.push(None);
        }
    }

    for (candidate_index, candidate) in candidates.into_iter().enumerate() {
        if let Some(db_info) = db_snapshot.remove(&candidate.path_str) {
            let needs_parse = options.force_metadata_refresh
                || db_info.song.cue_source_path != candidate.cue_audio_path
                || db_info.file_modified_at != candidate.disk_mtime
                || db_info.file_size != candidate.disk_size
                || song_identity_missing(&db_info.song)
                || song_metadata_incomplete(&db_info.song)
                // NULL 流派表示旧版本扫描的存量歌曲，借机回填一次流派标签。
                || db_info.song.genre.is_none();

            if needs_parse {
                // Retain the persisted identity and keep the existing record if an
                // incremental scan cannot parse this file. Successful parsing replaces it.
                songs_by_index[candidate_index] = Some(db_info.song);
                parse_tasks.push(ParseTask {
                    index: candidate_index,
                    path: candidate.path,
                    path_str: candidate.path_str,
                    ext: candidate.ext,
                    change: ChangeKind::Update,
                });
            } else if song_meets_duration_threshold(&db_info.song, options) {
                songs_by_index[candidate_index] = Some(db_info.song);
            } else {
                to_delete.push(candidate.path_str);
            }
        } else {
            parse_tasks.push(ParseTask {
                index: candidate_index,
                path: candidate.path,
                path_str: candidate.path_str,
                ext: candidate.ext,
                change: ChangeKind::Add,
            });
        }
    }

    // Separate CUE-track tasks from regular audio tasks
    let (cue_tasks, audio_tasks): (Vec<ParseTask>, Vec<ParseTask>) =
        parse_tasks.into_iter().partition(|t| t.ext == "cue_track");
    parse_tasks = audio_tasks;

    // Process CUE tasks: group by CUE file, parse once, build all track songs
    let cue_results = process_cue_parse_tasks(
        &cue_tasks,
        options,
        &mut warnings,
        rules,
        &mut excluded_paths,
    )?;

    if let Some(reporter) = reporter {
        reporter.start_parsing(parse_tasks.len());
    }

    let parsed_results = parse_tasks_in_parallel(parse_tasks, reporter.cloned(), options)?;

    for result in parsed_results {
        match result {
            ParsedTaskResult::Song {
                index,
                mut song,
                change,
            } => {
                if let Some(existing) = songs_by_index[index].as_ref() {
                    song.id = existing.id;
                }
                songs_by_index[index] = Some(song);
                changes_by_index[index] = Some(change);
            }
            ParsedTaskResult::Delete { index, path } => {
                songs_by_index[index] = None;
                to_delete.push(path);
            }
        }
    }

    // Merge CUE track results
    for result in cue_results {
        match result {
            ParsedTaskResult::Song {
                index,
                mut song,
                change,
            } => {
                if let Some(existing) = songs_by_index[index].as_ref() {
                    song.id = existing.id;
                }
                songs_by_index[index] = Some(song);
                changes_by_index[index] = Some(change);
            }
            ParsedTaskResult::Delete { index, path } => {
                songs_by_index[index] = None;
                to_delete.push(path);
            }
        }
    }

    let mut songs = Vec::with_capacity(songs_by_index.len());
    let mut changes = Vec::with_capacity(songs_by_index.len());
    for (index, song) in songs_by_index.into_iter().enumerate() {
        if let Some(song) = song {
            songs.push(song);
            changes.push(changes_by_index[index]);
        }
    }
    to_delete.extend(db_snapshot.keys().cloned());

    enrich_album_groups(&mut songs);

    let mut to_add = Vec::new();
    let mut to_update = Vec::new();
    for (song, change) in songs.iter_mut().zip(&changes) {
        let target = match change {
            Some(ChangeKind::Add) => Some(&mut to_add),
            Some(ChangeKind::Update) => Some(&mut to_update),
            None => None,
        };
        if let Some(target) = target {
            target.push(song.clone());
            // Avatar bytes are only needed by the database-write copy. Avoid
            // retaining them again in the full scan result.
            let _ = song.artist_avatar_bytes.take();
        }
    }

    Ok(ScanDiff {
        songs,
        to_add,
        to_update,
        to_delete,
        has_disk_songs,
        warnings,
        excluded_paths,
    })
}
