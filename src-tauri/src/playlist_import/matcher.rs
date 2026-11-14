use super::normalization::{artist_keys, normalized, title_keys, title_numbers, versions};
use super::types::*;
use crate::music::{scanner::parse_song_from_file, utils::normalize_path};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::path::Path;

fn similarity(a: &str, b: &str) -> f64 {
    if a.is_empty() || b.is_empty() {
        return 0.0;
    }
    if a == b {
        return 1.0;
    }
    let a: Vec<char> = a.chars().take(256).collect();
    let b: Vec<char> = b.chars().take(256).collect();
    let mut row: Vec<usize> = (0..=b.len()).collect();
    for (i, ca) in a.iter().enumerate() {
        let mut diagonal = row[0];
        row[0] = i + 1;
        for (j, cb) in b.iter().enumerate() {
            let previous = row[j + 1];
            row[j + 1] = (row[j] + 1)
                .min(previous + 1)
                .min(diagonal + usize::from(ca != cb));
            diagonal = previous;
        }
    }
    1.0 - row[b.len()] as f64 / a.len().max(b.len()) as f64
}

pub(super) struct LocalTrack {
    candidate: Candidate,
    titles: Vec<String>,
    title_numbers: Vec<String>,
    artists: Vec<Vec<String>>,
    album: String,
    versions: Vec<&'static str>,
    title_versions: Vec<&'static str>,
    physical_path: String,
    lossless: bool,
}

pub(super) fn catalog(conn: &Connection) -> Result<Vec<LocalTrack>, String> {
    let sql = format!("SELECT s.path, s.title, s.artist, s.artist_names, s.album, s.duration, s.cue_source_path, COALESCE(s.source_type, 'local'), rs.name, s.format FROM songs s LEFT JOIN remote_sources rs ON rs.id = s.remote_source_id WHERE {} ORDER BY s.path", super::CATALOG_FILTER);
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            let path: String = row.get(0)?;
            let title = row
                .get::<_, Option<String>>(1)?
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| {
                    Path::new(&path)
                        .file_stem()
                        .unwrap_or_default()
                        .to_string_lossy()
                        .to_string()
                });
            let artists: Vec<String> = row
                .get::<_, Option<String>>(3)?
                .and_then(|s| serde_json::from_str(&s).ok())
                .filter(|a: &Vec<String>| !a.is_empty())
                .unwrap_or_else(|| {
                    super::sources::split_artists(
                        &row.get::<_, Option<String>>(2)
                            .ok()
                            .flatten()
                            .unwrap_or_default(),
                    )
                });
            let album = row.get::<_, Option<String>>(4)?.unwrap_or_default();
            let physical_path = row
                .get::<_, Option<String>>(6)?
                .unwrap_or_else(|| path.clone());
            Ok(LocalTrack {
                titles: title_keys(&title),
                title_numbers: title_numbers(&title),
                artists: artist_keys(&artists, &title),
                album: normalized(&album),
                versions: versions(&format!("{title} {album}")),
                title_versions: versions(&title),
                physical_path,
                lossless: matches!(
                    row.get::<_, Option<String>>(9)?
                        .unwrap_or_default()
                        .to_lowercase()
                        .as_str(),
                    "flac" | "alac" | "wav" | "aif" | "aiff"
                ),
                candidate: Candidate {
                    path,
                    title,
                    artists,
                    album,
                    duration: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                    score: 0.0,
                    reason: String::new(),
                    match_warnings: vec![],
                    source_type: row.get(7)?,
                    source_name: row.get(8)?,
                },
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn grams(value: &str) -> HashSet<String> {
    let chars: Vec<char> = value.chars().take(256).collect();
    if chars.len() < 2 {
        return [value.to_string()].into();
    }
    chars.windows(2).map(|g| g.iter().collect()).collect()
}

fn name_similarity(a: &[String], b: &[String]) -> f64 {
    if a.iter().any(|key| b.contains(key)) {
        return 1.0;
    }
    a.iter()
        .flat_map(|a| b.iter().map(move |b| similarity(a, b)))
        .fold(0.0, f64::max)
}

fn artist_similarity(a: &[Vec<String>], b: &[Vec<String>]) -> Option<f64> {
    if a.is_empty() || b.is_empty() {
        return None;
    }
    let scores: Vec<_> = a
        .iter()
        .map(|aliases| {
            b.iter()
                .map(|other| name_similarity(aliases, other))
                .fold(0.0, f64::max)
        })
        .collect();
    let best = scores.iter().copied().fold(0.0, f64::max);
    // Extra producer/featured credits must not veto the same song and performer.
    Some(best * 0.85 + scores.iter().sum::<f64>() / scores.len() as f64 * 0.15)
}

fn duration_difference(a: Option<f64>, b: f64) -> Option<f64> {
    a.filter(|a| a.is_finite() && *a > 0.0 && b.is_finite() && b > 0.0)
        .map(|a| (a - b).abs())
}

fn relevant(
    title: f64,
    artist: Option<f64>,
    album: Option<f64>,
    duration: Option<f64>,
    title_only: bool,
) -> bool {
    let artist_match = artist.is_some_and(|s| s >= 0.80);
    let album_match = album.is_some_and(|s| s >= 0.90);
    let same_duration = duration.is_some_and(|d| d <= 3.0);
    // A strong title needs corroboration. A close spelling needs stronger evidence.
    if title == 1.0 {
        return artist_match || artist.is_none() && (album_match || same_duration || title_only);
    }
    if title >= 0.90 {
        return title_only
            || artist_match && duration.is_none_or(|d| d <= 8.0)
            || artist.is_none() && album_match && same_duration;
    }
    title >= 0.80
        && artist.is_some_and(|s| s >= 0.95)
        && (album_match || same_duration || album.is_none() && duration.is_none())
}

pub(super) fn match_tracks(
    local: &[LocalTrack],
    tracks: &[SourceTrack],
    fields: Option<MatchFields>,
) -> Result<Vec<TrackMatch>, String> {
    if !tracks.iter().any(|track| track.text_line.is_some()) {
        return match_tracks_inner(local, tracks, fields);
    }
    let mut variants = Vec::new();
    let ranges: Vec<_> = tracks
        .iter()
        .map(|track| {
            let start = variants.len();
            variants.extend(super::sources::text_variants(track));
            start..variants.len()
        })
        .collect();
    // Build the catalog indexes once for all interpretations, including reverse
    // GoMusic output and titles which contain a literal spaced hyphen.
    let mut results = match_tracks_inner(local, &variants, fields)?;
    let mut resolved = Vec::with_capacity(tracks.len());
    for (track, range) in tracks.iter().zip(ranges) {
        let mut best = range.start;
        let mut best_rank = None;
        for index in range {
            if let Some(candidate) = results[index].candidates.first() {
                let rank = (!variants[index].artists.is_empty(), candidate.score);
                if best_rank.is_none_or(|previous| rank > previous) {
                    best = index;
                    best_rank = Some(rank);
                }
            }
        }
        let mut result = std::mem::take(&mut results[best]);
        if track.text_line.is_some() {
            result.source_track = Some(variants[best].clone());
        }
        resolved.push(result);
    }
    Ok(resolved)
}

fn match_tracks_inner(
    local: &[LocalTrack],
    tracks: &[SourceTrack],
    fields: Option<MatchFields>,
) -> Result<Vec<TrackMatch>, String> {
    let mut by_title: HashMap<&str, Vec<usize>> = HashMap::new();
    let mut by_gram: HashMap<String, Vec<usize>> = HashMap::new();
    let mut by_path = HashMap::new();
    let needs_titles = tracks.iter().any(|track| track.path.is_none());
    for (i, song) in local.iter().enumerate() {
        by_path.insert(song.candidate.path.as_str(), i);
        if needs_titles {
            let mut song_grams = HashSet::new();
            for title in &song.titles {
                by_title.entry(title.as_str()).or_default().push(i);
                if fields.is_none() {
                    song_grams.extend(grams(title));
                }
            }
            for gram in song_grams {
                by_gram.entry(gram).or_default().push(i);
            }
        }
    }
    let mut availability = HashMap::<String, bool>::new();
    let mut result = Vec::with_capacity(tracks.len());
    for track in tracks {
        if let Some(raw_path) = &track.path {
            let path = if raw_path.contains("://") {
                raw_path.clone()
            } else {
                normalize_path(raw_path)
            };
            let candidate = if path.starts_with("remote://") {
                by_path
                    .get(path.as_str())
                    .map(|&index| local[index].candidate.clone())
            } else if !path.contains("://") && Path::new(&path).is_file() {
                if let Some(&index) = by_path.get(path.as_str()) {
                    Some(local[index].candidate.clone())
                } else {
                    let ext = Path::new(&path)
                        .extension()
                        .and_then(|x| x.to_str())
                        .unwrap_or("")
                        .to_lowercase();
                    if crate::music::utils::is_supported_library_extension(&ext) {
                        parse_song_from_file(Path::new(&path), &path, &ext).map(|song| Candidate {
                            path: song.path,
                            title: song.title,
                            artists: song.artist_names,
                            album: song.album,
                            duration: song.duration as f64,
                            score: 1.0,
                            reason: "文件路径一致".into(),
                            match_warnings: vec![],
                            source_type: "local".into(),
                            source_name: None,
                        })
                    } else {
                        None
                    }
                }
            } else {
                None
            };
            let candidates = candidate
                .into_iter()
                .map(|mut c| {
                    c.score = 1.0;
                    c.reason = "文件路径一致".into();
                    c.match_warnings.clear();
                    c
                })
                .collect::<Vec<_>>();
            result.push(TrackMatch {
                selected_path: candidates.first().map(|c| c.path.clone()),
                candidates,
                ..Default::default()
            });
            continue;
        }
        let mut titles = title_keys(&track.title);
        for alias in &track.aliases {
            for key in title_keys(alias) {
                if !titles.contains(&key) {
                    titles.push(key);
                }
            }
        }
        if titles.is_empty() {
            result.push(TrackMatch {
                candidates: vec![],
                selected_path: None,
                ..Default::default()
            });
            continue;
        }
        let source_artists = artist_keys(&track.artists, &track.title);
        let source_numbers = title_numbers(&track.title);
        let album = normalized(&track.album);
        let source_versions = versions(&format!("{} {}", track.title, track.album));
        let source_title_versions = versions(&track.title);
        if let Some(fields) = fields {
            let mut missing = Vec::new();
            if fields.artist && source_artists.is_empty() {
                missing.push("歌手");
            }
            if fields.album && (album.is_empty() || album == "未知专辑") {
                missing.push("专辑");
            }
            if fields.duration && !track.duration.is_some_and(|d| d.is_finite() && d > 0.0) {
                missing.push("时长");
            }
            if !missing.is_empty() {
                result.push(TrackMatch {
                    match_issue: Some(format!(
                        "来源缺少{}信息，无法按所选条件匹配",
                        missing.join("、")
                    )),
                    ..Default::default()
                });
                continue;
            }
        }
        let mut pool: HashSet<usize> = titles
            .iter()
            .flat_map(|title| by_title.get(title.as_str()).into_iter().flatten().copied())
            .collect();
        let title_only = source_artists.is_empty() && album.is_empty() && track.duration.is_none();
        let mut votes = HashMap::<usize, usize>::new();
        let title_grams: HashSet<_> = titles.iter().flat_map(|title| grams(title)).collect();
        for gram in title_grams {
            for &index in by_gram.get(&gram).into_iter().flatten() {
                *votes.entry(index).or_default() += 1;
            }
        }
        let mut votes: Vec<_> = votes.into_iter().collect();
        votes.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        pool.extend(votes.into_iter().take(250).map(|(index, _)| index));
        let mut ranked = Vec::new();
        for index in pool {
            let song = &local[index];
            let ts = name_similarity(&titles, &song.titles);
            if let Some(fields) = fields {
                // Custom mode only uses selected fields. Album version labels and
                // unselected metadata must not veto a title-only match.
                if ts != 1.0 || source_title_versions != song.title_versions {
                    continue;
                }
                let same_artists = |a: &[Vec<String>], b: &[Vec<String>]| {
                    !a.is_empty()
                        && !b.is_empty()
                        && a.iter().all(|aliases| {
                            b.iter().any(|other| name_similarity(aliases, other) == 1.0)
                        })
                };
                let duration = duration_difference(track.duration, song.candidate.duration);
                if fields.artist
                    && !(same_artists(&source_artists, &song.artists)
                        && same_artists(&song.artists, &source_artists))
                    || fields.album && album != song.album
                    || fields.duration && !duration.is_some_and(|d| d <= 2.0)
                {
                    continue;
                }
                let available = song.candidate.source_type == "remote"
                    || *availability
                        .entry(song.physical_path.clone())
                        .or_insert_with(|| Path::new(&song.physical_path).is_file());
                if !available {
                    continue;
                }
                let mut candidate = song.candidate.clone();
                let mut reasons = vec!["自定义匹配", "歌名一致"];
                let mut weighted = 0.62;
                let mut weights = 0.62;
                if fields.artist {
                    reasons.push("歌手一致");
                    weighted += 0.24;
                    weights += 0.24;
                }
                if fields.album {
                    reasons.push("专辑一致");
                    weighted += 0.06;
                    weights += 0.06;
                }
                if fields.duration {
                    reasons.push("时长相差不超过 2 秒");
                    weighted += (1.0 - duration.unwrap_or(2.0) / 15.0) * 0.08;
                    weights += 0.08;
                }
                candidate.score = weighted / weights;
                candidate.reason = reasons.join(" · ");
                candidate.match_warnings.clear();
                ranked.push((candidate, song.lossless));
                continue;
            }
            if ts < 0.80
                || source_versions != song.versions
                || ts < 1.0 && source_numbers != song.title_numbers
            {
                continue;
            }
            let artist_score = artist_similarity(&source_artists, &song.artists);
            let album_score = (!album.is_empty()
                && !song.album.is_empty()
                && album != "未知专辑"
                && song.album != "未知专辑")
                .then(|| similarity(&album, &song.album));
            let duration = duration_difference(track.duration, song.candidate.duration);
            if duration.is_some_and(|d| d > 15.0_f64.max(track.duration.unwrap_or(0.0) * 0.08))
                || !relevant(ts, artist_score, album_score, duration, title_only)
            {
                continue;
            }
            let available = song.candidate.source_type == "remote"
                || *availability
                    .entry(song.physical_path.clone())
                    .or_insert_with(|| Path::new(&song.physical_path).is_file());
            if !available {
                continue;
            }
            let duration_score = duration.map(|d| (1.0 - d / 15.0).max(0.0));
            let mut weighted = ts * 0.62;
            let mut weights = 0.62;
            for (score, weight) in [
                (artist_score, 0.24),
                (album_score, 0.06),
                (duration_score, 0.08),
            ] {
                if let Some(score) = score {
                    weighted += score * weight;
                    weights += weight;
                }
            }
            let mut candidate = song.candidate.clone();
            candidate.score = weighted / weights;
            let mut reasons = vec![
                "自动匹配",
                if ts == 1.0 {
                    if normalized(&track.title) == normalized(&song.candidate.title) {
                        "歌名一致"
                    } else {
                        "主歌名或别名一致"
                    }
                } else {
                    "歌名相近"
                },
            ];
            if artist_score.is_some_and(|s| s >= 0.80) {
                reasons.push("歌手或合作署名相符");
            }
            if album_score == Some(1.0) {
                reasons.push("专辑一致");
            }
            if duration_score.is_some_and(|s| s >= 0.73) {
                reasons.push("时长接近");
            }
            candidate.reason = reasons.join(" · ");
            let mut warnings = Vec::new();
            if ts < 1.0 {
                warnings.push("歌名仅相近，并非完全一致".into());
            }
            match artist_score {
                None if source_artists.is_empty() => {
                    warnings.push("来源缺少歌手信息，无法核对歌手".into())
                }
                None => warnings.push("候选歌曲缺少歌手信息".into()),
                Some(score) if score < 1.0 => warnings.push("歌手或合作署名不完全一致".into()),
                _ => {}
            }
            if album_score.is_some_and(|score| score < 1.0) {
                warnings.push("专辑名称不一致".into());
            } else if !album.is_empty()
                && album != "未知专辑"
                && (song.album.is_empty() || song.album == "未知专辑")
            {
                warnings.push("候选歌曲缺少专辑信息".into());
            }
            if let Some(difference) = duration.filter(|difference| *difference > 4.0) {
                warnings.push(format!("时长相差 {difference:.1} 秒"));
            } else if track.duration.is_some_and(|d| d > 0.0) && song.candidate.duration <= 0.0 {
                warnings.push("候选歌曲缺少时长信息".into());
            }
            candidate.match_warnings = warnings;
            ranked.push((candidate, song.lossless));
        }
        ranked.sort_by(|a, b| {
            b.0.score
                .total_cmp(&a.0.score)
                .then_with(|| (a.0.source_type == "remote").cmp(&(b.0.source_type == "remote")))
                .then(b.1.cmp(&a.1))
                .then(a.0.path.cmp(&b.0.path))
        });
        // Every returned candidate passes relevance/version checks. Ties (including
        // duplicate encodings) choose a stable best file instead of asking the user.
        let selected_path = ranked.first().map(|(c, _)| c.path.clone());
        result.push(TrackMatch {
            selected_path,
            candidates: ranked.into_iter().take(5).map(|(c, _)| c).collect(),
            ..Default::default()
        });
    }
    Ok(result)
}
