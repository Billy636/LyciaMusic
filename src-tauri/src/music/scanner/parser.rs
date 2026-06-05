use super::super::cue::CueTrack;
use super::super::tags::{extract_detail_metadata, read_tagged_file_from_path_for_scan};
use super::super::types::Song;
use super::super::utils::{is_supported_library_extension, normalize_path};
use super::{
    build_album_key, fill_text_fields_from_tags, normalize_album_key_part, primary_artist_name,
    split_artist_names, ScanOptions, UNKNOWN_ALBUM, UNKNOWN_ARTIST, VARIOUS_ARTISTS,
    VARIOUS_ARTISTS_THRESHOLD,
};
use lofty::file::FileType;
use lofty::prelude::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;
use symphonia::core::codecs::CODEC_TYPE_NULL;
use symphonia::core::formats::FormatOptions;
use symphonia::core::io::MediaSourceStream;
use symphonia::core::meta::{Limit, MetadataOptions};
use symphonia::core::probe::Hint;
use symphonia::core::units::TimeBase;

#[derive(Default)]
struct AudioIdentity {
    container: Option<String>,
    codec: Option<String>,
    duration_seconds: Option<u32>,
    sample_rate: Option<u32>,
    bit_depth: Option<u8>,
}

fn duration_seconds_from_timebase(time_base: TimeBase, frames: u64) -> u32 {
    let time = time_base.calc_time(frames);
    let rounded = time.seconds.saturating_add(u64::from(time.frac > 0.0));
    rounded.min(u32::MAX as u64) as u32
}

fn derive_bitrate_kbps(file_size: u64, duration: u32) -> u32 {
    if file_size == 0 || duration == 0 {
        return 0;
    }

    let bits = (file_size as u128).saturating_mul(8);
    let kbps = bits / (duration as u128) / 1000;
    kbps.min(u32::MAX as u128) as u32
}

fn system_time_to_unix_seconds(time: std::time::SystemTime) -> Option<u64> {
    time.duration_since(UNIX_EPOCH)
        .ok()
        .map(|duration| duration.as_secs())
}

pub(super) fn preferred_parse_workers(task_count: usize) -> usize {
    if task_count <= 1 {
        return 1;
    }

    let available = std::thread::available_parallelism()
        .map(|value| value.get())
        .unwrap_or(4);

    preferred_parse_workers_for_available(task_count, available)
}

pub(super) fn preferred_parse_workers_for_available(task_count: usize, available: usize) -> usize {
    if task_count <= 1 {
        return 1;
    }

    let reserved = if available <= 8 { 1 } else { 2 };
    let usable = available.saturating_sub(reserved).max(1);

    task_count.min(usable).max(1)
}

pub(super) fn song_metadata_incomplete(song: &Song) -> bool {
    super::is_missing_text(&song.artist, UNKNOWN_ARTIST)
        || super::is_missing_text(&song.album, UNKNOWN_ALBUM)
        || song.artist_names.is_empty()
        || song.album_artist.trim().is_empty()
        || song.album_key.trim().is_empty()
        || song.title.trim().is_empty()
        || song.duration == 0
}

pub(super) fn song_identity_missing(song: &Song) -> bool {
    song.format.trim().is_empty()
        && song
            .container
            .as_deref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
}

pub(crate) fn parse_song_from_file(path: &Path, path_str: &str, format: &str) -> Option<Song> {
    let mut artist = String::from("未知歌手");
    let mut album = String::from("未知专辑");
    let mut album_artist = String::new();
    let mut title = String::new();
    let mut duration = 0u32;
    let mut bitrate = 0u32;
    let mut sample_rate = 0u32;
    let mut bit_depth: Option<u8> = None;
    let mut file_size = 0u64;
    let mut file_created_at: Option<u64> = None;
    let mut file_modified_at: Option<u64> = None;
    let mut track_number: Option<String> = None;
    let mut disc_number: Option<String> = None;
    let mut comment: Option<String> = None;
    let mut container = Some(normalize_container_from_extension(format));
    let mut codec = None;

    if let Ok(meta) = fs::metadata(path) {
        file_size = meta.len();
        if let Ok(created) = meta.created() {
            file_created_at = system_time_to_unix_seconds(created);
        }
        if let Ok(modified) = meta.modified() {
            file_modified_at = system_time_to_unix_seconds(modified);
        }
    }

    if let Ok(tagged_file) =
        read_tagged_file_from_path_for_scan(path).map_err(|error| error.to_string())
    {
        let props = tagged_file.properties();
        duration = props.duration().as_secs() as u32;
        bitrate = props.audio_bitrate().unwrap_or(0);
        sample_rate = props.sample_rate().unwrap_or(0);
        bit_depth = props.bit_depth().map(|bits| bits as u8);
        container = Some(normalize_container(tagged_file.file_type()).to_string());

        fill_text_fields_from_tags(
            &tagged_file,
            &mut artist,
            &mut album,
            &mut title,
            &mut album_artist,
        );
        let detail_metadata = extract_detail_metadata(&tagged_file);
        track_number = detail_metadata.track_number;
        disc_number = detail_metadata.disc_number;
        comment = detail_metadata.comment;
    }

    if duration == 0 || sample_rate == 0 || bit_depth.is_none() {
        let identity = detect_audio_identity(path, format);

        if duration == 0 {
            duration = identity.duration_seconds.unwrap_or(0);
        }
        if sample_rate == 0 {
            sample_rate = identity.sample_rate.unwrap_or(0);
        }
        if bit_depth.is_none() {
            bit_depth = identity.bit_depth;
        }
        if container
            .as_deref()
            .map(|value| value.trim().is_empty())
            .unwrap_or(true)
        {
            container = identity.container;
        }
        codec = identity.codec;
    }

    if bitrate == 0 {
        bitrate = derive_bitrate_kbps(file_size, duration);
    }
    if title.trim().is_empty() {
        title = path.file_stem()?.to_string_lossy().to_string();
    }
    if album_artist.trim().is_empty() {
        album_artist = artist.clone();
    }

    let artist_names = split_artist_names(&artist);
    let album_key = build_album_key(&album, &album_artist);

    Some(Song {
        id: None,
        name: path.file_name()?.to_string_lossy().to_string(),
        path: path_str.to_string(),
        title,
        artist,
        artist_names: artist_names.clone(),
        effective_artist_names: artist_names,
        album,
        album_artist,
        album_key,
        is_various_artists_album: false,
        collapse_artist_credits: false,
        duration,
        cover_thumb_path: None,
        bitrate,
        sample_rate,
        bit_depth,
        format: format.to_string(),
        container,
        codec,
        file_size,
        track_number,
        disc_number,
        // Keep `added_at` as the frontend sort field, but source it from file time.
        added_at: file_created_at.or(file_modified_at),
        file_modified_at,
        cue_source_path: None,
        cue_start_offset: None,
        cue_end_offset: None,
        comment,
    })
}

pub(super) fn parse_audio_files_internal(paths: Vec<String>, options: ScanOptions) -> Vec<Song> {
    let mut songs = Vec::new();
    let mut seen_paths = HashSet::new();

    for raw_path in paths {
        let normalized_path = normalize_path(&raw_path);
        if normalized_path.is_empty() || !seen_paths.insert(normalized_path.clone()) {
            continue;
        }

        let path = PathBuf::from(&normalized_path);
        if !path.is_file() {
            continue;
        }

        let extension = path
            .extension()
            .and_then(|ext| ext.to_str())
            .map(|ext| ext.to_ascii_lowercase());

        let Some(extension) = extension else {
            continue;
        };

        if !is_supported_library_extension(&extension) {
            continue;
        }

        if let Some(song) = parse_song_from_file(&path, &normalized_path, &extension) {
            if options.minimum_duration_seconds > 0
                && song.duration < options.minimum_duration_seconds
            {
                continue;
            }

            songs.push(song);
        }
    }

    songs
}

fn normalize_container(file_type: FileType) -> &'static str {
    match file_type {
        FileType::Aac => "aac",
        FileType::Aiff => "aiff",
        FileType::Ape => "ape",
        FileType::Flac => "flac",
        FileType::Mpeg => "mpeg",
        FileType::Mp4 => "mp4",
        FileType::Mpc => "mpc",
        FileType::Opus | FileType::Speex | FileType::Vorbis => "ogg",
        FileType::Wav => "wav",
        FileType::WavPack => "wavpack",
        FileType::Custom(name) => name,
        _ => "unknown",
    }
}

fn normalize_container_from_extension(ext: &str) -> String {
    match ext.to_ascii_lowercase().as_str() {
        "aif" | "aiff" => "aiff".to_string(),
        "m4a" | "m4b" | "m4p" | "mp4" => "mp4".to_string(),
        "mp1" | "mp2" | "mp3" => "mpeg".to_string(),
        "oga" | "ogg" | "opus" | "spx" | "speex" | "vorbis" => "ogg".to_string(),
        "wav" | "wave" => "wav".to_string(),
        "wv" => "wavpack".to_string(),
        other => other.to_string(),
    }
}

fn normalize_codec(short_name: &str) -> String {
    let codec = short_name.to_ascii_lowercase();
    if codec.starts_with("pcm_") {
        "pcm".to_string()
    } else if codec.starts_with("adpcm_") {
        "adpcm".to_string()
    } else {
        codec
    }
}

fn detect_audio_identity(path: &Path, ext: &str) -> AudioIdentity {
    let file = match File::open(path) {
        Ok(file) => file,
        Err(_) => {
            return AudioIdentity {
                container: Some(normalize_container_from_extension(ext)),
                ..Default::default()
            };
        }
    };

    let media_source = MediaSourceStream::new(Box::new(file), Default::default());
    let mut hint = Hint::new();
    hint.with_extension(ext);

    let probed = match symphonia::default::get_probe().format(
        &hint,
        media_source,
        &FormatOptions::default(),
        &MetadataOptions {
            limit_visual_bytes: Limit::Maximum(0),
            ..Default::default()
        },
    ) {
        Ok(probed) => probed,
        Err(_) => {
            return AudioIdentity {
                container: Some(normalize_container_from_extension(ext)),
                ..Default::default()
            };
        }
    };

    let track = match probed
        .format
        .tracks()
        .iter()
        .find(|track| track.codec_params.codec != CODEC_TYPE_NULL)
    {
        Some(track) => track,
        None => {
            return AudioIdentity {
                container: Some(normalize_container_from_extension(ext)),
                ..Default::default()
            };
        }
    };

    let duration_seconds = match (track.codec_params.time_base, track.codec_params.n_frames) {
        (Some(time_base), Some(frames)) if frames > 0 => {
            Some(duration_seconds_from_timebase(time_base, frames))
        }
        _ => None,
    };
    let sample_rate = track.codec_params.sample_rate;
    let bit_depth = track
        .codec_params
        .bits_per_sample
        .or(track.codec_params.bits_per_coded_sample)
        .and_then(|depth| u8::try_from(depth).ok());
    let codec = symphonia::default::get_codecs()
        .get_codec(track.codec_params.codec)
        .map(|descriptor| normalize_codec(descriptor.short_name));

    AudioIdentity {
        container: Some(normalize_container_from_extension(ext)),
        codec,
        duration_seconds,
        sample_rate,
        bit_depth,
    }
}

fn resolve_album_artist_for_group(songs: &[Song]) -> (String, bool, bool) {
    let tagged_album_artists: Vec<String> = songs
        .iter()
        .filter_map(|song| {
            let trimmed = song.album_artist.trim();
            (!trimmed.is_empty() && !trimmed.eq_ignore_ascii_case(&song.artist))
                .then(|| trimmed.to_string())
        })
        .collect();

    let primary_artists: Vec<String> = songs.iter().map(primary_artist_name).collect();
    let unique_primary_artists: HashSet<String> = primary_artists
        .iter()
        .map(|name| name.to_lowercase())
        .collect();

    if !tagged_album_artists.is_empty() {
        let unique_tagged: HashSet<String> = tagged_album_artists
            .iter()
            .map(|name| name.to_lowercase())
            .collect();
        let resolved = tagged_album_artists[0].clone();
        let is_various = unique_tagged.len() > 1 && unique_primary_artists.len() > 1;
        let collapse = unique_primary_artists.len() > VARIOUS_ARTISTS_THRESHOLD;
        return (
            if is_various {
                VARIOUS_ARTISTS.to_string()
            } else {
                resolved
            },
            is_various,
            collapse,
        );
    }

    if unique_primary_artists.len() <= 1 {
        return (
            primary_artists
                .first()
                .cloned()
                .unwrap_or_else(|| UNKNOWN_ARTIST.to_string()),
            false,
            false,
        );
    }

    let mut counts: HashMap<String, usize> = HashMap::new();
    for name in &primary_artists {
        *counts.entry(name.clone()).or_insert(0) += 1;
    }

    let dominant_artist = counts
        .into_iter()
        .max_by(|(left_name, left_count), (right_name, right_count)| {
            left_count
                .cmp(right_count)
                .then_with(|| right_name.cmp(left_name))
        })
        .map(|(name, _)| name)
        .unwrap_or_else(|| UNKNOWN_ARTIST.to_string());

    let all_unique = unique_primary_artists.len() == songs.len();
    let collapse = unique_primary_artists.len() > VARIOUS_ARTISTS_THRESHOLD;
    let is_various = collapse || all_unique;

    (
        if is_various {
            VARIOUS_ARTISTS.to_string()
        } else {
            dominant_artist
        },
        is_various,
        collapse,
    )
}

pub(crate) fn build_cue_track_song(
    cue_path: &str,
    flac_path: &str,
    track: &CueTrack,
    album_title: Option<&str>,
    album_performer: Option<&str>,
    flac_duration_ms: u32,
) -> Option<Song> {
    let title = track
        .title
        .clone()
        .unwrap_or_else(|| format!("Track {:02}", track.track_number));
    let performer = track
        .performer
        .clone()
        .unwrap_or_else(|| UNKNOWN_ARTIST.to_string());
    let album = album_title.unwrap_or(UNKNOWN_ALBUM).to_string();
    let album_artist = album_performer.unwrap_or(&performer).to_string();
    let artist_names = split_artist_names(&performer);
    let synthetic_path = format!("{}::track{:02}", cue_path, track.track_number);

    let end_ms = track.end_ms.unwrap_or(flac_duration_ms as u64);
    let track_duration = if end_ms > track.index01_start_ms {
        ((end_ms - track.index01_start_ms) / 1000) as u32
    } else {
        0
    };

    let flac_path_buf = std::path::PathBuf::from(flac_path);
    let (cover_thumb_path, bitrate, sample_rate, bit_depth, codec_name) =
        probe_flac_for_cue_metadata(&flac_path_buf);

    let name = format!("{:02}. {}", track.track_number, title);

    Some(Song {
        id: None,
        name,
        path: synthetic_path,
        title,
        artist: performer.clone(),
        artist_names: artist_names.clone(),
        effective_artist_names: artist_names,
        album,
        album_artist,
        album_key: build_album_key(
            album_title.unwrap_or(UNKNOWN_ALBUM),
            album_performer.unwrap_or(&performer),
        ),
        is_various_artists_album: false,
        collapse_artist_credits: false,
        duration: track_duration,
        cover_thumb_path,
        bitrate,
        sample_rate,
        bit_depth,
        format: "flac".to_string(),
        container: Some("flac".to_string()),
        codec: codec_name,
        file_size: std::fs::metadata(&flac_path_buf)
            .map(|m| m.len())
            .unwrap_or(0),
        track_number: Some(track.track_number.to_string()),
        disc_number: None,
        added_at: None,
        file_modified_at: None,
        cue_source_path: Some(flac_path.to_string()),
        cue_start_offset: Some(track.index01_start_ms as u32),
        cue_end_offset: Some(end_ms as u32),
        comment: None,
    })
}

fn probe_flac_for_cue_metadata(
    flac_path: &std::path::Path,
) -> (Option<String>, u32, u32, Option<u8>, Option<String>) {
    let tagged_file = read_tagged_file_from_path_for_scan(flac_path).ok();
    let cover_thumb_path = None; // Will be generated by cover cache later
    let bitrate = tagged_file
        .as_ref()
        .and_then(|f| f.properties().audio_bitrate())
        .unwrap_or(0);
    let sample_rate = tagged_file
        .as_ref()
        .and_then(|f| f.properties().sample_rate())
        .unwrap_or(0);
    let bit_depth = tagged_file
        .as_ref()
        .and_then(|f| f.properties().bit_depth())
        .map(|b| b as u8);
    let codec_name = None;

    (
        cover_thumb_path,
        bitrate,
        sample_rate,
        bit_depth,
        codec_name,
    )
}

pub(super) fn enrich_album_groups(songs: &mut [Song]) {
    let mut grouped_paths: HashMap<String, Vec<usize>> = HashMap::new();

    for (index, song) in songs.iter().enumerate() {
        let parent_folder = Path::new(&song.path)
            .parent()
            .map(|path| path.to_string_lossy().to_string())
            .unwrap_or_default();
        let album_group_key = format!(
            "{}::{}",
            parent_folder,
            normalize_album_key_part(&song.album, UNKNOWN_ALBUM)
        );
        grouped_paths
            .entry(album_group_key)
            .or_default()
            .push(index);
    }

    for indexes in grouped_paths.into_values() {
        let group_songs: Vec<Song> = indexes.iter().map(|index| songs[*index].clone()).collect();
        let (album_artist, is_various, collapse) = resolve_album_artist_for_group(&group_songs);

        for index in indexes {
            let song = &mut songs[index];
            song.album_artist = album_artist.clone();
            song.album_key = build_album_key(&song.album, &song.album_artist);
            song.is_various_artists_album = is_various;
            song.collapse_artist_credits = collapse;
            song.effective_artist_names = if collapse {
                vec![VARIOUS_ARTISTS.to_string()]
            } else {
                song.artist_names.clone()
            };
        }
    }
}
