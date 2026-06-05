// music/scanner.rs - scan module entrypoint

use super::tags::extract_text_metadata;
use super::types::Song;
use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;

#[path = "scanner/diff.rs"]
mod diff;
#[path = "scanner/orchestrator.rs"]
mod orchestrator;
#[path = "scanner/parser.rs"]
mod parser;
#[path = "scanner/progress.rs"]
mod progress;
#[path = "scanner/repository.rs"]
mod repository;

pub use orchestrator::{
    get_folder_first_song, parse_audio_files, scan_folder_as_playlists, scan_folder_recursive,
    scan_music_folder, scan_single_directory_internal,
};
pub(crate) use parser::parse_song_from_file;
pub(crate) use repository::apply_scan_changes;

pub(super) const VARIOUS_ARTISTS: &str = "Various Artists";
pub(super) const VARIOUS_ARTISTS_THRESHOLD: usize = 5;
pub(super) const PROGRESS_EMIT_INTERVAL_MS: u64 = 200;
pub(super) const DB_PROGRESS_BATCH: usize = 100;
pub(super) const LIBRARY_SCAN_PROGRESS_EVENT: &str = "library-scan-progress";
pub(super) const LIBRARY_SCAN_BATCH_EVENT: &str = "library-scan-batch";

pub(super) const UNKNOWN_ARTIST: &str = "未知歌手";
pub(super) const UNKNOWN_ALBUM: &str = "未知专辑";

#[derive(Clone, Copy, Debug, Default)]
pub(crate) struct ScanOptions {
    pub(crate) minimum_duration_seconds: u32,
}

impl ScanOptions {
    pub(crate) fn from_minimum_duration_seconds(value: Option<u32>) -> Self {
        Self {
            minimum_duration_seconds: value.unwrap_or(0),
        }
    }
}

pub(super) fn clamp_i64_to_u32(v: i64) -> u32 {
    if v <= 0 {
        0
    } else if v > u32::MAX as i64 {
        u32::MAX
    } else {
        v as u32
    }
}

pub(super) fn i64_to_u64_opt(v: Option<i64>) -> Option<u64> {
    v.filter(|value| *value >= 0).map(|value| value as u64)
}

pub(super) fn i64_to_u8_opt(v: Option<i64>) -> Option<u8> {
    v.filter(|value| *value >= 0 && *value <= u8::MAX as i64)
        .map(|value| value as u8)
}

pub(super) fn u64_to_i64_saturated(v: u64) -> i64 {
    if v > i64::MAX as u64 {
        i64::MAX
    } else {
        v as i64
    }
}

pub(super) fn u64_opt_to_i64_saturated(v: Option<u64>) -> Option<i64> {
    v.map(u64_to_i64_saturated)
}

pub(super) fn deserialize_string_list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

pub(super) fn serialize_string_list(values: &[String]) -> Result<String, String> {
    serde_json::to_string(values).map_err(|error| error.to_string())
}

pub(super) fn i64_to_bool(v: Option<i64>) -> bool {
    v.unwrap_or(0) != 0
}

pub(super) fn is_missing_text(value: &str, placeholder: &str) -> bool {
    let trimmed = value.trim();
    trimmed.is_empty() || trimmed == placeholder
}

fn pick_tag_value(current: &str, candidate: Option<&str>, placeholder: &str) -> Option<String> {
    if !is_missing_text(current, placeholder) {
        return None;
    }

    candidate
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn pick_optional_tag_value(current: &str, candidate: Option<&str>) -> Option<String> {
    if !current.trim().is_empty() {
        return None;
    }

    candidate
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
}

fn artist_split_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"(?i)[;,&/、]|feat\.|\s+with\s+").expect("artist split regex"))
}

pub(super) fn split_artist_names(artist: &str) -> Vec<String> {
    let mut seen = HashSet::new();
    let mut result = Vec::new();

    for part in artist_split_regex().split(artist) {
        let trimmed = part.trim();
        if trimmed.is_empty() {
            continue;
        }

        let dedupe_key = trimmed.to_lowercase();
        if seen.insert(dedupe_key) {
            result.push(trimmed.to_string());
        }
    }

    if result.is_empty() && !artist.trim().is_empty() {
        result.push(artist.trim().to_string());
    }

    result
}

pub(super) fn primary_artist_name(song: &Song) -> String {
    song.artist_names
        .first()
        .cloned()
        .unwrap_or_else(|| song.artist.clone())
}

pub(super) fn normalize_album_key_part(value: &str, fallback: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        fallback.to_ascii_lowercase()
    } else {
        trimmed.to_ascii_lowercase()
    }
}

pub(super) fn build_album_key(album: &str, album_artist: &str) -> String {
    format!(
        "{}::{}",
        normalize_album_key_part(album, UNKNOWN_ALBUM),
        normalize_album_key_part(album_artist, VARIOUS_ARTISTS)
    )
}

pub(super) fn fill_text_fields_from_tags(
    tagged_file: &impl lofty::file::TaggedFileExt,
    artist: &mut String,
    album: &mut String,
    title: &mut String,
    album_artist: &mut String,
) {
    let metadata = extract_text_metadata(tagged_file);

    if let Some(value) = pick_tag_value(artist, metadata.artist.as_deref(), UNKNOWN_ARTIST) {
        *artist = value;
    }

    if let Some(value) = pick_tag_value(album, metadata.album.as_deref(), UNKNOWN_ALBUM) {
        *album = value;
    }

    if let Some(value) = pick_optional_tag_value(title, metadata.title.as_deref()) {
        *title = value;
    }

    if let Some(value) = pick_optional_tag_value(album_artist, metadata.album_artist.as_deref()) {
        *album_artist = value;
    }
}

#[cfg(test)]
mod tests {
    use super::diff::{collect_scan_diff, DbSongSnapshot};
    use super::parser::{
        preferred_parse_workers_for_available, song_identity_missing, song_metadata_incomplete,
    };
    use super::repository::{apply_scan_changes, scan_change_chunk_size};
    use super::ScanOptions;
    use crate::music::types::Song;
    use crate::music::utils::normalize_path;
    use rusqlite::{params, Connection};
    use std::collections::HashMap;
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_song(path: &str) -> Song {
        Song {
            id: None,
            name: PathBuf::from(path)
                .file_name()
                .map(|name| name.to_string_lossy().into_owned())
                .unwrap_or_else(|| path.to_string()),
            title: "Demo".to_string(),
            path: path.to_string(),
            artist: "Artist".to_string(),
            artist_names: vec!["Artist".to_string()],
            effective_artist_names: vec!["Artist".to_string()],
            album: "Album".to_string(),
            album_artist: "Artist".to_string(),
            album_key: "album::artist".to_string(),
            is_various_artists_album: false,
            collapse_artist_credits: false,
            duration: 180,
            cover_thumb_path: Some("C:/covers/demo_thumb_150.jpg".to_string()),
            bitrate: 320,
            sample_rate: 48_000,
            bit_depth: Some(24),
            format: "flac".to_string(),
            container: Some("flac".to_string()),
            codec: Some("flac".to_string()),
            file_size: 1024,
            track_number: None,
            disc_number: None,
            added_at: Some(1),
            file_modified_at: Some(10),
            cue_source_path: None,
            cue_start_offset: None,
            cue_end_offset: None,
            comment: None,
        }
    }

    fn setup_test_db() -> Connection {
        let conn = Connection::open_in_memory().expect("open in-memory db");
        conn.pragma_update(None, "foreign_keys", "ON")
            .expect("enable foreign keys");
        conn.execute_batch(
            "
            CREATE TABLE songs (
                id INTEGER PRIMARY KEY,
                path TEXT NOT NULL UNIQUE,
                title TEXT,
                artist TEXT,
                artist_names TEXT,
                effective_artist_names TEXT,
                album TEXT,
                album_artist TEXT,
                album_key TEXT,
                is_various_artists_album INTEGER DEFAULT 0,
                collapse_artist_credits INTEGER DEFAULT 0,
                duration INTEGER,
                cover_path TEXT,
                cover_thumb_path TEXT,
                bitrate INTEGER,
                sample_rate INTEGER,
                bit_depth INTEGER,
                format TEXT,
                container TEXT,
                codec TEXT,
                file_size INTEGER,
                track_number TEXT,
                disc_number TEXT,
                added_at INTEGER,
                file_modified_at INTEGER,
                cue_source_path TEXT,
                cue_start_offset INTEGER,
                cue_end_offset INTEGER,
                comment TEXT
            );
            CREATE TABLE artists (
                id INTEGER PRIMARY KEY,
                name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                avatar_path TEXT
            );
            CREATE TABLE song_artists (
                song_id INTEGER NOT NULL,
                artist_id INTEGER NOT NULL,
                sort_order INTEGER NOT NULL DEFAULT 0,
                PRIMARY KEY (song_id, artist_id),
                FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE,
                FOREIGN KEY(artist_id) REFERENCES artists(id) ON DELETE CASCADE
            );
            CREATE INDEX idx_song_artists_artist_id ON song_artists(artist_id);
            ",
        )
        .expect("create scanner test schema");
        conn
    }

    fn create_empty_temp_dir() -> PathBuf {
        let unique = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("lycia_scanner_test_{unique}"));
        fs::create_dir_all(&dir).expect("create temp dir");
        dir
    }

    #[test]
    fn parse_workers_return_one_for_single_task() {
        assert_eq!(preferred_parse_workers_for_available(1, 32), 1);
    }

    #[test]
    fn parse_workers_reserve_one_core_on_smaller_cpus() {
        assert_eq!(preferred_parse_workers_for_available(10, 8), 7);
        assert_eq!(preferred_parse_workers_for_available(10, 4), 3);
    }

    #[test]
    fn parse_workers_reserve_two_cores_on_larger_cpus() {
        assert_eq!(preferred_parse_workers_for_available(32, 16), 14);
        assert_eq!(preferred_parse_workers_for_available(32, 24), 22);
    }

    #[test]
    fn parse_workers_never_exceed_task_count() {
        assert_eq!(preferred_parse_workers_for_available(3, 16), 3);
    }

    #[test]
    fn flags_incomplete_or_identity_less_songs_for_rescan() {
        let mut song = make_song("/music/demo.flac");
        assert!(!song_metadata_incomplete(&song));
        assert!(!song_identity_missing(&song));

        song.title.clear();
        assert!(song_metadata_incomplete(&song));

        song = make_song("/music/demo.flac");
        song.format.clear();
        song.container = None;
        assert!(song_identity_missing(&song));
    }

    #[test]
    fn collect_scan_diff_marks_missing_disk_songs_for_deletion() {
        let temp_dir = create_empty_temp_dir();
        let stale_path = temp_dir.join("stale.flac");
        let normalized_folder = temp_dir.to_string_lossy().replace('\\', "/");
        let normalized_song_path = stale_path.to_string_lossy().replace('\\', "/");
        let mut db_snapshot = HashMap::new();
        db_snapshot.insert(
            normalized_song_path.clone(),
            DbSongSnapshot {
                song: make_song(&normalized_song_path),
                file_modified_at: Some(10),
                file_size: 1024,
            },
        );

        let diff = collect_scan_diff(
            &normalized_folder,
            db_snapshot,
            None,
            ScanOptions::default(),
        )
        .expect("collect diff");

        assert_eq!(diff.songs.len(), 0);
        assert_eq!(diff.to_add.len(), 0);
        assert_eq!(diff.to_update.len(), 0);
        assert_eq!(diff.to_delete, vec![normalized_song_path]);
        assert!(!diff.has_disk_songs);

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn collect_scan_diff_deletes_existing_songs_below_minimum_duration() {
        let temp_dir = create_empty_temp_dir();
        let short_path = temp_dir.join("short.flac");
        fs::write(&short_path, b"fake flac").expect("write short audio placeholder");

        let normalized_folder = normalize_path(&temp_dir.to_string_lossy());
        let normalized_song_path = normalize_path(&short_path.to_string_lossy());
        let metadata = fs::metadata(&short_path).expect("read placeholder metadata");
        let disk_mtime = metadata
            .modified()
            .ok()
            .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64);

        let mut short_song = make_song(&normalized_song_path);
        short_song.duration = 4;
        short_song.file_size = metadata.len();
        short_song.file_modified_at = disk_mtime.map(|value| value as u64);

        let mut db_snapshot = HashMap::new();
        db_snapshot.insert(
            normalized_song_path.clone(),
            DbSongSnapshot {
                song: short_song,
                file_modified_at: disk_mtime,
                file_size: metadata.len() as i64,
            },
        );

        let diff = collect_scan_diff(
            &normalized_folder,
            db_snapshot,
            None,
            ScanOptions {
                minimum_duration_seconds: 10,
            },
        )
        .expect("collect diff");

        assert!(diff.songs.is_empty());
        assert!(diff.to_add.is_empty());
        assert!(diff.to_update.is_empty());
        assert_eq!(diff.to_delete, vec![normalized_song_path]);
        assert!(diff.has_disk_songs);

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn collect_scan_diff_handles_cue_tracks_after_filtering_referenced_audio() {
        let temp_dir = create_empty_temp_dir();
        let audio_path = temp_dir.join("album.flac");
        let cue_path = temp_dir.join("album.cue");
        let normalized_folder = temp_dir.to_string_lossy().to_string();

        fs::write(&audio_path, b"fake flac").expect("write referenced audio");
        fs::write(
            &cue_path,
            concat!(
                "TITLE \"Cue Album\"\n",
                "PERFORMER \"Cue Artist\"\n",
                "FILE \"album.flac\" WAVE\n",
                "  TRACK 01 AUDIO\n",
                "    TITLE \"First\"\n",
                "    INDEX 01 00:00:00\n",
                "  TRACK 02 AUDIO\n",
                "    TITLE \"Second\"\n",
                "    INDEX 01 03:00:00\n",
            ),
        )
        .expect("write cue");

        let diff = collect_scan_diff(
            &normalized_folder,
            HashMap::new(),
            None,
            ScanOptions::default(),
        )
        .expect("collect diff");

        assert_eq!(diff.songs.len(), 2);
        assert_eq!(diff.to_add.len(), 2);
        assert!(diff.songs.iter().all(|song| song.path.contains("::track")));

        fs::remove_dir_all(temp_dir).expect("remove temp dir");
    }

    #[test]
    fn apply_scan_changes_writes_and_syncs_artist_relations() {
        let mut conn = setup_test_db();
        let added_song = make_song("/music/first.flac");

        apply_scan_changes(&mut conn, &[added_song.clone()], &[], &[], None).expect("insert batch");

        let inserted_title: String = conn
            .query_row(
                "SELECT title FROM songs WHERE path = ?1",
                params![added_song.path],
                |row| row.get(0),
            )
            .expect("read inserted song");
        let inserted_artist_links: i64 = conn
            .query_row("SELECT COUNT(*) FROM song_artists", [], |row| row.get(0))
            .expect("count artist links after insert");
        assert_eq!(inserted_title, "Demo");
        assert_eq!(inserted_artist_links, 1);

        let mut updated_song = added_song.clone();
        updated_song.title = "Updated Demo".to_string();
        updated_song.artist = "Updated Artist".to_string();
        updated_song.artist_names = vec!["Updated Artist".to_string(), "Guest".to_string()];
        updated_song.effective_artist_names = updated_song.artist_names.clone();
        updated_song.album_artist = "Updated Artist".to_string();
        updated_song.album_key = "album::updated artist".to_string();

        apply_scan_changes(&mut conn, &[], &[updated_song.clone()], &[], None)
            .expect("update batch");

        let updated_title: String = conn
            .query_row(
                "SELECT title FROM songs WHERE path = ?1",
                params![updated_song.path],
                |row| row.get(0),
            )
            .expect("read updated song");
        let linked_artist_names: Vec<String> = conn
            .prepare(
                "SELECT artists.name
                 FROM song_artists
                 JOIN artists ON artists.id = song_artists.artist_id
                 ORDER BY song_artists.sort_order ASC",
            )
            .expect("prepare artist query")
            .query_map([], |row| row.get::<_, String>(0))
            .expect("query artist links")
            .filter_map(Result::ok)
            .collect();
        assert_eq!(updated_title, "Updated Demo");
        assert_eq!(
            linked_artist_names,
            vec!["Updated Artist".to_string(), "Guest".to_string()]
        );

        apply_scan_changes(
            &mut conn,
            &[],
            &[],
            std::slice::from_ref(&updated_song.path),
            None,
        )
        .expect("delete batch");

        let remaining_songs: i64 = conn
            .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))
            .expect("count songs after delete");
        let remaining_artists: i64 = conn
            .query_row("SELECT COUNT(*) FROM artists", [], |row| row.get(0))
            .expect("count artists after delete");
        let remaining_links: i64 = conn
            .query_row("SELECT COUNT(*) FROM song_artists", [], |row| row.get(0))
            .expect("count links after delete");
        assert_eq!(remaining_songs, 0);
        assert_eq!(remaining_artists, 0);
        assert_eq!(remaining_links, 0);
    }
      
    #[test]
    fn large_import_chunk_size_stays_under_sqlite_variable_limit() {
        assert!(scan_change_chunk_size(0, 6000) <= 999);
    }
  
   #[test]
    fn split_artist_names_chinese_enumeration_comma() {
        let names = super::split_artist_names("周杰伦、林俊杰、王力宏");
        assert_eq!(names, vec!["周杰伦", "林俊杰", "王力宏"]);
    }

    #[test]
    fn split_artist_names_mixed_separators_with_chinese_comma() {
        let names = super::split_artist_names("歌手A、歌手B & 歌手C");
        assert_eq!(names, vec!["歌手A", "歌手B", "歌手C"]);
    }

    #[test]
    fn split_artist_names_chinese_comma_with_spaces() {
        let names = super::split_artist_names("アーティスト1 、 アーティスト2");
        assert_eq!(names, vec!["アーティスト1", "アーティスト2"]);
    }

    #[test]
    fn split_artist_names_preserves_existing_separators() {
        let names = super::split_artist_names("Artist A, Artist B & Artist C");
        assert_eq!(names, vec!["Artist A", "Artist B", "Artist C"]);

        let names = super::split_artist_names("Artist A; Artist B");
        assert_eq!(names, vec!["Artist A", "Artist B"]);

        let names = super::split_artist_names("Artist A / Artist B");
        assert_eq!(names, vec!["Artist A", "Artist B"]);

        let names = super::split_artist_names("Artist A feat. Artist B");
        assert_eq!(names, vec!["Artist A", "Artist B"]);

        let names = super::split_artist_names("Artist A with Artist B");
        assert_eq!(names, vec!["Artist A", "Artist B"]);
    }

    #[test]
    fn split_artist_names_deduplicates_chinese_comma_separated() {
        let names = super::split_artist_names("周杰伦、周杰伦、林俊杰");
        assert_eq!(names, vec!["周杰伦", "林俊杰"]);
    }

    #[test]
    fn split_artist_names_single_artist_without_separator() {
        let names = super::split_artist_names("周杰伦");
        assert_eq!(names, vec!["周杰伦"]);
}
