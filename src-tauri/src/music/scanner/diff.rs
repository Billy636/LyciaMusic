use super::super::cue;
use super::super::types::Song;
use super::super::utils::{
    descendant_like_patterns, is_cue_file_extension, is_dot_prefixed_path,
    is_supported_library_extension, normalize_path,
};
use super::parser::{
    build_cue_track_song, enrich_album_groups, parse_song_from_file, preferred_parse_workers,
    song_identity_missing, song_metadata_incomplete,
};
use super::progress::ScanProgressReporter;
use super::{
    clamp_i64_to_u32, deserialize_string_list, i64_to_bool, i64_to_u64_opt, i64_to_u8_opt,
    ScanOptions,
};
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
}

struct DiskCandidate {
    path: PathBuf,
    path_str: String,
    ext: String,
    disk_mtime: Option<i64>,
    disk_size: i64,
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
                "SELECT id, path, title, artist, artist_names, effective_artist_names, album, album_artist, album_key, is_various_artists_album, collapse_artist_credits, duration, cover_thumb_path, bitrate, sample_rate, bit_depth, format, container, codec, file_size, track_number, disc_number, added_at, file_modified_at, cue_source_path, cue_start_offset, cue_end_offset, comment
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
) -> Vec<DiskCandidate> {
    let mut candidates = Vec::new();
    let mut discovered = 0usize;

    if let Some(reporter) = reporter {
        reporter.emit_collecting(0, 0, Some("正在扫描文件夹".to_string()));
    }

    let mut it = WalkDir::new(normalized_folder).into_iter();
    while let Some(entry) = next_visible_walk_entry(&mut it) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = match path.extension() {
            Some(ext) => ext.to_string_lossy().to_lowercase(),
            None => continue,
        };

        if !is_supported_library_extension(&ext) {
            continue;
        }

        let metadata = match entry.metadata() {
            Ok(metadata) => metadata,
            Err(_) => continue,
        };

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
    while let Some(entry) = next_visible_walk_entry(&mut it) {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }

        let ext = match path.extension() {
            Some(ext) => ext.to_string_lossy().to_lowercase(),
            None => continue,
        };

        if !is_cue_file_extension(&ext) {
            continue;
        }

        let cue_file_mtime = entry
            .metadata()
            .ok()
            .and_then(|m| m.modified().ok())
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64);
        let cue_file_size = entry.metadata().map(|m| m.len() as i64).unwrap_or(0);

        let cue_path_str = normalize_path(&path.to_string_lossy().to_string());

        if let Ok(sheet) = cue::parse_cue_file(path) {
            let resolved = normalize_path(&sheet.resolved_audio_path.to_string_lossy());
            cue_referenced_audio.push(resolved);

            for track in &sheet.tracks {
                let synthetic_path = format!("{}::track{:02}", cue_path_str, track.track_number);
                candidates.push(DiskCandidate {
                    path: PathBuf::from(&synthetic_path),
                    path_str: synthetic_path,
                    ext: "cue_track".to_string(),
                    disk_mtime: cue_file_mtime,
                    disk_size: cue_file_size,
                });
            }
        }
    }

    // Filter out audio files that are referenced by CUE sheets
    if !cue_referenced_audio.is_empty() {
        candidates.retain(|c| !cue_referenced_audio.contains(&c.path_str));
    }

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

    candidates
}

fn should_skip_dot_prefixed_child_directory(entry: &walkdir::DirEntry) -> bool {
    entry.depth() > 0 && entry.file_type().is_dir() && is_dot_prefixed_path(entry.path())
}

fn next_visible_walk_entry(iter: &mut walkdir::IntoIter) -> Option<walkdir::DirEntry> {
    loop {
        let entry = match iter.next()? {
            Ok(entry) => entry,
            Err(_) => continue,
        };

        if should_skip_dot_prefixed_child_directory(&entry) {
            iter.skip_current_dir();
            continue;
        }

        return Some(entry);
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
            .filter_map(|task| {
                let parsed = parse_song_from_file(&task.path, &task.path_str, &task.ext);

                if let Some(reporter) = reporter.as_ref() {
                    reporter.advance_parsing(total);
                }

                parsed.and_then(|song| {
                    if song_meets_duration_threshold(&song, options) {
                        return Some(ParsedTaskResult::Song {
                            index: task.index,
                            song,
                            change: task.change,
                        });
                    }

                    (task.change == ChangeKind::Update).then(|| ParsedTaskResult::Delete {
                        path: task.path_str,
                    })
                })
            })
            .collect()
    });

    Ok(results)
}

fn probe_audio_duration_ms(path: &Path) -> Option<u32> {
    use symphonia::core::codecs::CODEC_TYPE_NULL;
    use symphonia::core::formats::FormatOptions;
    use symphonia::core::io::MediaSourceStream;
    use symphonia::core::meta::MetadataOptions;
    use symphonia::core::probe::Hint;

    let file = std::fs::File::open(path).ok()?;
    let media_source = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    if let Some(ext) = path.extension().and_then(|e| e.to_str()) {
        hint.with_extension(ext);
    }
    let probed = symphonia::default::get_probe()
        .format(
            &hint,
            media_source,
            &FormatOptions::default(),
            &MetadataOptions::default(),
        )
        .ok()?;
    let track = probed
        .format
        .tracks()
        .iter()
        .find(|t| t.codec_params.codec != CODEC_TYPE_NULL)?;
    let seconds = if let (Some(time_base), Some(frames)) = (track.codec_params.time_base, track.codec_params.n_frames) {
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
        Some((seconds.min(u32::MAX as u64) * 1000) as u32)
    } else {
        None
    }
}

fn process_cue_parse_tasks(tasks: &[ParseTask], options: ScanOptions) -> Vec<ParsedTaskResult> {
    if tasks.is_empty() {
        return Vec::new();
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
            Err(_) => continue,
        };
        let flac_path = sheet.resolved_audio_path.to_string_lossy().to_string();
        let flac_duration_ms = probe_audio_duration_ms(&sheet.resolved_audio_path).unwrap_or(0);
        let cue_path_normalized = normalize_path(&cue_path);

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
                None => continue,
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
                        path: task.path_str.clone(),
                    });
                }
            }
        }
    }

    results
}

pub(super) fn collect_scan_diff(
    normalized_folder: &str,
    mut db_snapshot: HashMap<String, DbSongSnapshot>,
    reporter: Option<&ScanProgressReporter>,
    options: ScanOptions,
) -> Result<ScanDiff, String> {
    let candidates = collect_disk_candidates(normalized_folder, reporter);
    let has_disk_songs = !candidates.is_empty();
    let mut songs_by_index: Vec<Option<Song>> = vec![None; candidates.len()];
    let mut changes_by_index = vec![None; candidates.len()];
    let mut parse_tasks = Vec::new();
    let mut to_delete = Vec::new();

    for (candidate_index, candidate) in candidates.into_iter().enumerate() {
        if let Some(db_info) = db_snapshot.remove(&candidate.path_str) {
            let needs_parse = db_info.file_modified_at != candidate.disk_mtime
                || db_info.file_size != candidate.disk_size
                || song_identity_missing(&db_info.song)
                || song_metadata_incomplete(&db_info.song);

            if needs_parse {
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
    let cue_results = process_cue_parse_tasks(&cue_tasks, options);

    if let Some(reporter) = reporter {
        reporter.start_parsing(parse_tasks.len());
    }

    let parsed_results = parse_tasks_in_parallel(parse_tasks, reporter.cloned(), options)?;

    for result in parsed_results {
        match result {
            ParsedTaskResult::Song {
                index,
                song,
                change,
            } => {
                songs_by_index[index] = Some(song);
                changes_by_index[index] = Some(change);
            }
            ParsedTaskResult::Delete { path } => to_delete.push(path),
        }
    }

    // Merge CUE track results
    for result in cue_results {
        match result {
            ParsedTaskResult::Song {
                index,
                song,
                change,
            } => {
                songs_by_index[index] = Some(song);
                changes_by_index[index] = Some(change);
            }
            ParsedTaskResult::Delete { path } => to_delete.push(path),
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
    })
}
