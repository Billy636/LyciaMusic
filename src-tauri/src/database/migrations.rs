use rusqlite::Connection;
use std::fs;
use std::path::Path;
use std::time::UNIX_EPOCH;

fn get_table_columns(conn: &Connection, table_name: &str) -> Result<Vec<String>, String> {
    let query = format!("PRAGMA table_info({table_name})");
    conn.prepare(&query)
        .map_err(|e| e.to_string())?
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?
        .filter_map(|result| result.ok())
        .collect::<Vec<_>>()
        .pipe(Ok)
}

fn migrate_library_folders(conn: &Connection) -> Result<(), String> {
    let lib_columns = get_table_columns(conn, "library_folders")?;

    if !lib_columns.iter().any(|column| column == "path") {
        conn.execute("DROP TABLE IF EXISTS library_folders", [])
            .ok();
        conn.execute(
            "CREATE TABLE library_folders (
                path TEXT PRIMARY KEY,
                added_at INTEGER
            )",
            [],
        )
        .ok();
    }

    Ok(())
}

fn migrate_song_columns(conn: &Connection) -> Result<(), String> {
    let columns = get_table_columns(conn, "songs")?;

    if !columns.iter().any(|column| column == "bitrate") {
        conn.execute("ALTER TABLE songs ADD COLUMN bitrate INTEGER", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "cover_thumb_path") {
        conn.execute("ALTER TABLE songs ADD COLUMN cover_thumb_path TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "artist_names") {
        conn.execute("ALTER TABLE songs ADD COLUMN artist_names TEXT", [])
            .ok();
    }
    if !columns
        .iter()
        .any(|column| column == "effective_artist_names")
    {
        conn.execute(
            "ALTER TABLE songs ADD COLUMN effective_artist_names TEXT",
            [],
        )
        .ok();
    }
    if !columns.iter().any(|column| column == "album_artist") {
        conn.execute("ALTER TABLE songs ADD COLUMN album_artist TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "album_key") {
        conn.execute("ALTER TABLE songs ADD COLUMN album_key TEXT", [])
            .ok();
    }
    if !columns
        .iter()
        .any(|column| column == "is_various_artists_album")
    {
        conn.execute(
            "ALTER TABLE songs ADD COLUMN is_various_artists_album INTEGER DEFAULT 0",
            [],
        )
        .ok();
    }
    if !columns
        .iter()
        .any(|column| column == "collapse_artist_credits")
    {
        conn.execute(
            "ALTER TABLE songs ADD COLUMN collapse_artist_credits INTEGER DEFAULT 0",
            [],
        )
        .ok();
    }
    if !columns.iter().any(|column| column == "sample_rate") {
        conn.execute("ALTER TABLE songs ADD COLUMN sample_rate INTEGER", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "bit_depth") {
        conn.execute("ALTER TABLE songs ADD COLUMN bit_depth INTEGER", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "format") {
        conn.execute("ALTER TABLE songs ADD COLUMN format TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "container") {
        conn.execute("ALTER TABLE songs ADD COLUMN container TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "codec") {
        conn.execute("ALTER TABLE songs ADD COLUMN codec TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "file_size") {
        conn.execute("ALTER TABLE songs ADD COLUMN file_size INTEGER", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "track_number") {
        conn.execute("ALTER TABLE songs ADD COLUMN track_number TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "disc_number") {
        conn.execute("ALTER TABLE songs ADD COLUMN disc_number TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "added_at") {
        conn.execute("ALTER TABLE songs ADD COLUMN added_at INTEGER", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "file_modified_at") {
        conn.execute("ALTER TABLE songs ADD COLUMN file_modified_at INTEGER", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "source_type") {
        conn.execute(
            "ALTER TABLE songs ADD COLUMN source_type TEXT NOT NULL DEFAULT 'local'",
            [],
        )
        .ok();
    }
    if !columns.iter().any(|column| column == "remote_source_id") {
        conn.execute("ALTER TABLE songs ADD COLUMN remote_source_id TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "remote_uri") {
        conn.execute("ALTER TABLE songs ADD COLUMN remote_uri TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "remote_etag") {
        conn.execute("ALTER TABLE songs ADD COLUMN remote_etag TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "cache_path") {
        conn.execute("ALTER TABLE songs ADD COLUMN cache_path TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "cue_source_path") {
        conn.execute("ALTER TABLE songs ADD COLUMN cue_source_path TEXT", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "cue_start_offset") {
        conn.execute("ALTER TABLE songs ADD COLUMN cue_start_offset INTEGER", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "cue_end_offset") {
        conn.execute("ALTER TABLE songs ADD COLUMN cue_end_offset INTEGER", [])
            .ok();
    }
    if !columns.iter().any(|column| column == "comment") {
        conn.execute("ALTER TABLE songs ADD COLUMN comment TEXT", [])
            .ok();
    }

    Ok(())
}

fn migrate_remote_library_tables(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS remote_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            provider TEXT NOT NULL,
            base_url TEXT NOT NULL,
            username TEXT,
            password TEXT,
            root_path TEXT NOT NULL DEFAULT '/',
            enabled INTEGER NOT NULL DEFAULT 1,
            last_sync_at INTEGER,
            last_sync_error TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS remote_files (
            source_id TEXT NOT NULL,
            remote_path TEXT NOT NULL,
            remote_uri TEXT NOT NULL,
            name TEXT NOT NULL,
            size INTEGER NOT NULL DEFAULT 0,
            etag TEXT,
            modified_at TEXT,
            is_audio INTEGER NOT NULL DEFAULT 0,
            indexed_at INTEGER NOT NULL,
            PRIMARY KEY (source_id, remote_path),
            FOREIGN KEY(source_id) REFERENCES remote_sources(id) ON DELETE CASCADE
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_songs_remote_source_id ON songs(remote_source_id)",
        [],
    )
    .ok();
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_remote_files_source_id ON remote_files(source_id)",
        [],
    )
    .ok();

    Ok(())
}

fn timestamp_from_path(path: &str) -> Option<i64> {
    let metadata = fs::metadata(Path::new(path)).ok()?;
    let created = metadata
        .created()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64);
    let modified = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64);

    created.or(modified)
}

fn normalize_song_added_at(conn: &Connection) -> Result<(), String> {
    let mut select_stmt = conn
        .prepare("SELECT path FROM songs")
        .map_err(|error| error.to_string())?;
    let rows = select_stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    let song_paths: Vec<String> = rows.filter_map(|row| row.ok()).collect();
    drop(select_stmt);

    let mut update_stmt = conn
        .prepare("UPDATE songs SET added_at = ?1 WHERE path = ?2")
        .map_err(|error| error.to_string())?;

    for path in song_paths {
        let Some(timestamp) = timestamp_from_path(&path) else {
            continue;
        };

        update_stmt
            .execute(rusqlite::params![timestamp, path])
            .map_err(|error| error.to_string())?;
    }

    Ok(())
}

fn migrate_play_history(conn: &Connection) -> Result<(), String> {
    let columns = get_table_columns(conn, "play_history")?;

    if !columns.iter().any(|column| column == "played_seconds") {
        conn.execute(
            "ALTER TABLE play_history ADD COLUMN played_seconds INTEGER DEFAULT 0",
            [],
        )
        .ok();
    }

    if !columns.iter().any(|column| column == "song_id") {
        conn.execute("ALTER TABLE play_history ADD COLUMN song_id INTEGER", [])
            .ok();
        conn.execute(
            "CREATE INDEX IF NOT EXISTS idx_play_history_song_id ON play_history(song_id)",
            [],
        )
        .ok();
    }

    Ok(())
}

fn merge_legacy_sidebar_roots(conn: &Connection) {
    conn.execute(
        "INSERT OR IGNORE INTO library_folders (path, added_at)
         SELECT path, added_at FROM sidebar_folders",
        [],
    )
    .ok();
}

fn migrate_song_loudness(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE TABLE IF NOT EXISTS song_loudness (
            song_id INTEGER PRIMARY KEY,
            song_path TEXT NOT NULL,
            loudness_lufs REAL,
            estimated_loudness_lufs REAL,
            sample_peak REAL,
            true_peak REAL,
            tag_track_gain_db REAL,
            tag_track_peak REAL,
            tag_album_gain_db REAL,
            tag_album_peak REAL,
            tag_r128_track_gain_db REAL,
            tag_r128_album_gain_db REAL,
            file_size INTEGER NOT NULL,
            file_modified_at INTEGER NOT NULL,
            file_hash TEXT,
            scan_source TEXT NOT NULL DEFAULT 'none',
            analyzer_name TEXT,
            analyzer_version INTEGER NOT NULL DEFAULT 1,
            scan_status TEXT NOT NULL DEFAULT 'pending',
            scanned_at INTEGER,
            error_message TEXT,
            FOREIGN KEY(song_id) REFERENCES songs(id) ON DELETE CASCADE,
            CONSTRAINT check_scan_source CHECK (scan_source IN ('none', 'tag_replaygain', 'tag_r128', 'file_analysis')),
            CONSTRAINT check_scan_status CHECK (scan_status IN ('pending', 'scanning', 'scanned', 'failed'))
        )",
        [],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_song_loudness_song_id ON song_loudness(song_id)",
        [],
    )
    .ok();

    Ok(())
}

pub(crate) fn run_migrations(conn: &Connection) -> Result<(), String> {
    migrate_library_folders(conn)?;
    merge_legacy_sidebar_roots(conn);
    migrate_song_columns(conn)?;
    migrate_remote_library_tables(conn)?;
    normalize_song_added_at(conn)?;
    migrate_play_history(conn)?;
    migrate_song_loudness(conn)?;
    Ok(())
}

trait Pipe: Sized {
    fn pipe<T>(self, f: impl FnOnce(Self) -> T) -> T {
        f(self)
    }
}

impl<T> Pipe for T {}
