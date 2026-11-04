use super::types::*;
use crate::music::{scanner::parse_song_from_file, utils::normalize_path};
use rusqlite::Connection;
use std::collections::{HashMap, HashSet};
use std::path::Path;
use unicode_normalization::UnicodeNormalization;

fn normalized(value: &str) -> String {
    value
        .nfkc()
        .flat_map(char::to_lowercase)
        .filter(|c| c.is_alphanumeric())
        .collect()
}

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

fn versions(value: &str) -> Vec<&'static str> {
    let value = value.to_lowercase();
    [
        ("现场", &["live", "现场", "演唱会"][..]),
        (
            "伴奏",
            &["instrumental", "伴奏", "karaoke", "(inst", "（inst"][..],
        ),
        ("混音", &["remix", "混音"][..]),
        ("翻唱", &["cover", "翻唱"][..]),
        ("不插电", &["acoustic", "unplugged", "不插电"][..]),
        ("粤语", &["粤语", "cantonese"][..]),
        ("国语", &["国语", "mandarin", "chinese ver"][..]),
        ("日语", &["日语", "japanese ver"][..]),
        ("韩语", &["韩语", "korean ver"][..]),
    ]
    .iter()
    .filter(|(_, words)| words.iter().any(|word| value.contains(word)))
    .map(|(name, _)| *name)
    .collect()
}

pub(super) struct LocalTrack {
    candidate: Candidate,
    title: String,
    artists: Vec<String>,
    album: String,
    versions: Vec<&'static str>,
    physical_path: String,
}

pub(super) fn catalog(conn: &Connection) -> Result<Vec<LocalTrack>, String> {
    let mut stmt = conn.prepare("SELECT path, title, artist, artist_names, album, duration, cue_source_path FROM songs WHERE COALESCE(source_type, 'local') = 'local' ORDER BY path").map_err(|e| e.to_string())?;
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
                title: normalized(&title),
                artists: artists.iter().map(|s| normalized(s)).collect(),
                album: normalized(&album),
                versions: versions(&format!("{title} {album}")),
                physical_path,
                candidate: Candidate {
                    path,
                    title,
                    artists,
                    album,
                    duration: row.get::<_, Option<f64>>(5)?.unwrap_or(0.0),
                    score: 0.0,
                    reason: String::new(),
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

pub(super) fn match_tracks(
    local: &[LocalTrack],
    tracks: &[SourceTrack],
) -> Result<Vec<TrackMatch>, String> {
    let mut by_title: HashMap<&str, Vec<usize>> = HashMap::new();
    let mut by_gram: HashMap<String, Vec<usize>> = HashMap::new();
    let mut by_path = HashMap::new();
    let needs_fuzzy = tracks.iter().any(|track| track.path.is_none());
    for (i, song) in local.iter().enumerate() {
        by_path.insert(song.candidate.path.as_str(), i);
        if needs_fuzzy {
            by_title.entry(&song.title).or_default().push(i);
            for gram in grams(&song.title) {
                by_gram.entry(gram).or_default().push(i);
            }
        }
    }
    let mut availability = HashMap::<String, bool>::new();
    let mut result = Vec::with_capacity(tracks.len());
    for track in tracks {
        if let Some(raw_path) = &track.path {
            let path = normalize_path(raw_path);
            let candidate = if !path.contains("://") && Path::new(&path).is_file() {
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
                    c
                })
                .collect::<Vec<_>>();
            result.push(TrackMatch {
                selected_path: candidates.first().map(|c| c.path.clone()),
                candidates,
            });
            continue;
        }
        let title = normalized(&track.title);
        let source_artists: Vec<String> = track
            .artists
            .iter()
            .map(|s| normalized(s))
            .filter(|s| !s.is_empty() && s != "未知歌手")
            .collect();
        let album = normalized(&track.album);
        let source_versions = versions(&format!("{} {}", track.title, track.album));
        let mut pool: HashSet<usize> = by_title
            .get(title.as_str())
            .into_iter()
            .flatten()
            .copied()
            .collect();
        let mut votes = HashMap::<usize, usize>::new();
        for gram in grams(&title) {
            for &index in by_gram.get(&gram).into_iter().flatten() {
                *votes.entry(index).or_default() += 1;
            }
        }
        let mut votes: Vec<_> = votes.into_iter().collect();
        votes.sort_unstable_by(|a, b| b.1.cmp(&a.1).then(a.0.cmp(&b.0)));
        pool.extend(votes.into_iter().take(150).map(|(index, _)| index));
        let mut ranked = Vec::new();
        for index in pool {
            let song = &local[index];
            let ts = similarity(&title, &song.title);
            if ts < 0.45 {
                continue;
            }
            let available = *availability
                .entry(song.physical_path.clone())
                .or_insert_with(|| Path::new(&song.physical_path).is_file());
            if !available {
                continue;
            }
            let artist_score = if source_artists.is_empty() {
                None
            } else {
                let overlap = source_artists
                    .iter()
                    .filter(|a| song.artists.contains(a))
                    .count();
                if overlap > 0 {
                    Some(2.0 * overlap as f64 / (source_artists.len() + song.artists.len()) as f64)
                } else {
                    Some(
                        source_artists
                            .iter()
                            .flat_map(|a| song.artists.iter().map(move |b| similarity(a, b)))
                            .fold(0.0, f64::max)
                            * 0.8,
                    )
                }
            };
            let album_score = (!album.is_empty() && !song.album.is_empty() && album != "未知专辑")
                .then(|| similarity(&album, &song.album));
            let duration_score = track
                .duration
                .filter(|d| d.is_finite() && *d > 0.0 && song.candidate.duration > 0.0)
                .map(|d| (1.0 - (d - song.candidate.duration).abs() / 15.0).max(0.0));
            let mut weighted = ts * 0.60;
            let mut weights = 0.60;
            for (score, weight) in [
                (artist_score, 0.28),
                (album_score, 0.07),
                (duration_score, 0.05),
            ] {
                if let Some(score) = score {
                    weighted += score * weight;
                    weights += weight;
                }
            }
            let version_match = source_versions == song.versions;
            let mut candidate = song.candidate.clone();
            candidate.score = (weighted / weights) * if version_match { 1.0 } else { 0.65 };
            let mut reasons = vec![if ts == 1.0 {
                "歌名一致"
            } else {
                "歌名相近"
            }];
            if artist_score.is_some_and(|s| s >= 0.99) {
                reasons.push("歌手一致");
            }
            if album_score == Some(1.0) {
                reasons.push("专辑一致");
            }
            if duration_score.is_some_and(|s| s >= 0.73) {
                reasons.push("时长接近");
            }
            if !version_match {
                reasons.push("版本标记不同，请确认");
            }
            candidate.reason = reasons.join(" · ");
            let duration_conflict = track.duration.is_some_and(|d| {
                d > 0.0
                    && song.candidate.duration > 0.0
                    && (d - song.candidate.duration).abs() > 8.0
            });
            let automatic = ts == 1.0
                && artist_score.is_some_and(|s| s >= 0.99)
                && version_match
                && !duration_conflict
                && candidate.score >= 0.90;
            ranked.push((candidate, automatic));
        }
        ranked.sort_by(|a, b| {
            b.0.score
                .total_cmp(&a.0.score)
                .then(a.0.path.cmp(&b.0.path))
        });
        let selected_path = ranked
            .first()
            .filter(|(c, automatic)| {
                *automatic
                    && ranked
                        .get(1)
                        .is_none_or(|(other, _)| c.score - other.score >= 0.06)
            })
            .map(|(c, _)| c.path.clone());
        result.push(TrackMatch {
            selected_path,
            candidates: ranked.into_iter().take(5).map(|(c, _)| c).collect(),
        });
    }
    Ok(result)
}
