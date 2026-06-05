use super::progress::ScanProgressReporter;
use super::{
    serialize_string_list, u64_opt_to_i64_saturated, u64_to_i64_saturated, DB_PROGRESS_BATCH,
    UNKNOWN_ARTIST,
};
use crate::music::types::Song;
use rusqlite::{params, params_from_iter};
use std::collections::HashMap;

const FIRST_LARGE_IMPORT_BATCH_SIZE: usize = 900;

pub(super) fn scan_change_chunk_size(existing_song_count: i64, to_add_count: usize) -> usize {
    if existing_song_count == 0 && to_add_count >= 500 {
        FIRST_LARGE_IMPORT_BATCH_SIZE
    } else {
        DB_PROGRESS_BATCH
    }
}

fn ensure_artist_id(
    conn: &rusqlite::Transaction<'_>,
    artist_cache: &mut HashMap<String, i64>,
    artist_name: &str,
) -> Result<i64, String> {
    let cache_key = artist_name.to_lowercase();
    if let Some(artist_id) = artist_cache.get(&cache_key) {
        return Ok(*artist_id);
    }

    conn.execute(
        "INSERT INTO artists (name) VALUES (?1)
         ON CONFLICT(name) DO NOTHING",
        params![artist_name],
    )
    .map_err(|error| error.to_string())?;

    let artist_id = conn
        .query_row(
            "SELECT id FROM artists WHERE name = ?1 COLLATE NOCASE",
            params![artist_name],
            |row| row.get(0),
        )
        .map_err(|error| error.to_string())?;

    artist_cache.insert(cache_key, artist_id);
    Ok(artist_id)
}

fn load_song_ids_by_paths(
    conn: &rusqlite::Transaction<'_>,
    paths: &[String],
) -> Result<HashMap<String, i64>, String> {
    if paths.is_empty() {
        return Ok(HashMap::new());
    }

    let placeholders = vec!["?"; paths.len()].join(", ");
    let sql = format!("SELECT path, id FROM songs WHERE path IN ({placeholders})");
    let mut stmt = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = stmt
        .query_map(params_from_iter(paths.iter()), |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
        })
        .map_err(|error| error.to_string())?;

    let mut song_ids = HashMap::with_capacity(paths.len());
    for row in rows.flatten() {
        song_ids.insert(row.0, row.1);
    }

    Ok(song_ids)
}

fn sync_song_artists_batch(
    conn: &rusqlite::Transaction<'_>,
    songs: &[Song],
    song_ids: &HashMap<String, i64>,
    artist_cache: &mut HashMap<String, i64>,
    skip_delete: bool,
) -> Result<(), String> {
    if songs.is_empty() || song_ids.is_empty() {
        return Ok(());
    }

    let mut delete_stmt = if !skip_delete {
        Some(
            conn.prepare("DELETE FROM song_artists WHERE song_id = ?1")
                .map_err(|error| error.to_string())?,
        )
    } else {
        None
    };

    let mut insert_stmt = conn
        .prepare(
            "INSERT INTO song_artists (song_id, artist_id, sort_order)
             VALUES (?1, ?2, ?3)",
        )
        .map_err(|error| error.to_string())?;

    for song in songs {
        let Some(song_id) = song_ids.get(&song.path).copied() else {
            continue;
        };

        if let Some(ref mut stmt) = delete_stmt {
            stmt.execute(params![song_id])
                .map_err(|error| error.to_string())?;
        }

        let normalized_names = if song.artist_names.is_empty() {
            vec![UNKNOWN_ARTIST.to_string()]
        } else {
            song.artist_names.clone()
        };

        for (sort_order, artist_name) in normalized_names.iter().enumerate() {
            let artist_id = ensure_artist_id(conn, artist_cache, artist_name)?;
            insert_stmt
                .execute(params![song_id, artist_id, sort_order as i64])
                .map_err(|error| error.to_string())?;
        }
    }

    Ok(())
}

fn apply_insert_batch(
    conn: &mut rusqlite::Connection,
    songs: &[Song],
    artist_cache: &mut HashMap<String, i64>,
    skip_delete: bool,
) -> Result<(), String> {
    if songs.is_empty() {
        return Ok(());
    }

    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    let tx = conn.transaction().map_err(|error| error.to_string())?;
    {
        let mut insert_stmt = tx
            .prepare(
                "INSERT INTO songs (
                path,
                title,
                artist,
                artist_names,
                effective_artist_names,
                album,
                album_artist,
                album_key,
                is_various_artists_album,
                collapse_artist_credits,
                duration,
                cover_thumb_path,
                bitrate,
                sample_rate,
                bit_depth,
                format,
                container,
                codec,
                file_size,
                track_number,
                disc_number,
                added_at,
                file_modified_at,
                cue_source_path,
                cue_start_offset,
                cue_end_offset,
                comment
             )
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23, ?24, ?25, ?26, ?27)
             ON CONFLICT(path) DO UPDATE SET
                title = excluded.title,
                artist = excluded.artist,
                artist_names = excluded.artist_names,
                effective_artist_names = excluded.effective_artist_names,
                album = excluded.album,
                album_artist = excluded.album_artist,
                album_key = excluded.album_key,
                is_various_artists_album = excluded.is_various_artists_album,
                collapse_artist_credits = excluded.collapse_artist_credits,
                duration = excluded.duration,
                cover_thumb_path = excluded.cover_thumb_path,
                bitrate = excluded.bitrate,
                sample_rate = excluded.sample_rate,
                bit_depth = excluded.bit_depth,
                format = excluded.format,
                container = excluded.container,
                codec = excluded.codec,
                file_size = excluded.file_size,
                track_number = excluded.track_number,
                disc_number = excluded.disc_number,
                added_at = excluded.added_at,
                file_modified_at = excluded.file_modified_at,
                cue_source_path = excluded.cue_source_path,
                cue_start_offset = excluded.cue_start_offset,
                cue_end_offset = excluded.cue_end_offset,
                comment = excluded.comment",
            )
            .map_err(|error| error.to_string())?;

        for song in songs {
            let file_size_i64 = u64_to_i64_saturated(song.file_size);
            let added_at_i64 = u64_opt_to_i64_saturated(song.added_at);
            let mtime_i64 = u64_opt_to_i64_saturated(song.file_modified_at);
            let artist_names_json = serialize_string_list(&song.artist_names)?;
            let effective_artist_names_json = serialize_string_list(&song.effective_artist_names)?;
            insert_stmt
                .execute(params![
                    &song.path,
                    &song.title,
                    &song.artist,
                    artist_names_json,
                    effective_artist_names_json,
                    &song.album,
                    &song.album_artist,
                    &song.album_key,
                    if song.is_various_artists_album { 1 } else { 0 },
                    if song.collapse_artist_credits { 1 } else { 0 },
                    song.duration as i64,
                    &song.cover_thumb_path,
                    song.bitrate as i64,
                    song.sample_rate as i64,
                    song.bit_depth.map(|value| value as i64),
                    &song.format,
                    &song.container,
                    &song.codec,
                    file_size_i64,
                    &song.track_number,
                    &song.disc_number,
                    added_at_i64,
                    mtime_i64,
                    &song.cue_source_path,
                    song.cue_start_offset.map(|v| v as i64),
                    song.cue_end_offset.map(|v| v as i64),
                    &song.comment
                ])
                .map_err(|error| format!("insert failed for '{}': {}", song.path, error))?;
        }

        let song_paths: Vec<String> = songs.iter().map(|song| song.path.clone()).collect();
        let song_ids = load_song_ids_by_paths(&tx, &song_paths)?;
        sync_song_artists_batch(&tx, songs, &song_ids, artist_cache, skip_delete)?;
    }

    tx.commit().map_err(|error| error.to_string())?;

    #[cfg(debug_assertions)]
    {
        let duration = start_time.elapsed();
        println!(
            "[Profiling] apply_insert_batch took {:?} (chunk size: {})",
            duration,
            songs.len()
        );
    }

    Ok(())
}

fn apply_update_batch(
    conn: &mut rusqlite::Connection,
    songs: &[Song],
    artist_cache: &mut HashMap<String, i64>,
) -> Result<(), String> {
    if songs.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(|error| error.to_string())?;
    {
        let mut update_stmt = tx
            .prepare(
                "UPDATE songs
             SET title = ?1,
                 artist = ?2,
                 artist_names = ?3,
                 effective_artist_names = ?4,
                 album = ?5,
                 album_artist = ?6,
                 album_key = ?7,
                  is_various_artists_album = ?8,
                  collapse_artist_credits = ?9,
                  duration = ?10,
                  cover_thumb_path = ?11,
                  bitrate = ?12,
                  sample_rate = ?13,
                  bit_depth = ?14,
                  format = ?15,
                  container = ?16,
                  codec = ?17,
                  file_size = ?18,
                  track_number = ?19,
                  disc_number = ?20,
                  added_at = ?21,
                  file_modified_at = ?22,
                  cue_source_path = ?24,
                  cue_start_offset = ?25,
                  cue_end_offset = ?26,
                  comment = ?27
              WHERE path = ?23",
            )
            .map_err(|error| error.to_string())?;

        for song in songs {
            let file_size_i64 = u64_to_i64_saturated(song.file_size);
            let added_at_i64 = u64_opt_to_i64_saturated(song.added_at);
            let mtime_i64 = u64_opt_to_i64_saturated(song.file_modified_at);
            let artist_names_json = serialize_string_list(&song.artist_names)?;
            let effective_artist_names_json = serialize_string_list(&song.effective_artist_names)?;
            update_stmt
                .execute(params![
                    &song.title,
                    &song.artist,
                    artist_names_json,
                    effective_artist_names_json,
                    &song.album,
                    &song.album_artist,
                    &song.album_key,
                    if song.is_various_artists_album { 1 } else { 0 },
                    if song.collapse_artist_credits { 1 } else { 0 },
                    song.duration as i64,
                    &song.cover_thumb_path,
                    song.bitrate as i64,
                    song.sample_rate as i64,
                    song.bit_depth.map(|value| value as i64),
                    &song.format,
                    &song.container,
                    &song.codec,
                    file_size_i64,
                    &song.track_number,
                    &song.disc_number,
                    added_at_i64,
                    mtime_i64,
                    &song.path,
                    &song.cue_source_path,
                    song.cue_start_offset.map(|v| v as i64),
                    song.cue_end_offset.map(|v| v as i64),
                    &song.comment
                ])
                .map_err(|error| format!("update failed for '{}': {}", song.path, error))?;
        }

        let song_paths: Vec<String> = songs.iter().map(|song| song.path.clone()).collect();
        let song_ids = load_song_ids_by_paths(&tx, &song_paths)?;
        sync_song_artists_batch(&tx, songs, &song_ids, artist_cache, false)?;
    }

    tx.commit().map_err(|error| error.to_string())
}

fn apply_delete_batch(conn: &mut rusqlite::Connection, paths: &[String]) -> Result<(), String> {
    if paths.is_empty() {
        return Ok(());
    }

    let tx = conn.transaction().map_err(|error| error.to_string())?;
    {
        let mut delete_stmt = tx
            .prepare("DELETE FROM songs WHERE path = ?1")
            .map_err(|error| error.to_string())?;

        for path in paths {
            delete_stmt
                .execute(params![path])
                .map_err(|error| format!("delete failed for '{}': {}", path, error))?;
        }
    }

    tx.commit().map_err(|error| error.to_string())
}

fn cleanup_unused_artists(conn: &mut rusqlite::Connection) {
    conn.execute(
        "DELETE FROM artists
         WHERE id NOT IN (SELECT DISTINCT artist_id FROM song_artists)",
        [],
    )
    .ok();
}

pub(crate) fn apply_scan_changes(
    conn: &mut rusqlite::Connection,
    to_add: &[Song],
    to_update: &[Song],
    to_delete: &[String],
    reporter: Option<&ScanProgressReporter>,
) -> Result<(), String> {
    if to_add.is_empty() && to_update.is_empty() && to_delete.is_empty() {
        if let Some(reporter) = reporter {
            reporter.emit_writing(0, 0);
        }
        return Ok(());
    }

    #[cfg(debug_assertions)]
    let start_time = std::time::Instant::now();

    // 智能判定首次导入高载环境（数据为空且本批次新增歌曲量 >= 500）
    let existing_song_count: i64 = conn
        .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get(0))
        .unwrap_or(0);
    let is_first_large_import = existing_song_count == 0 && to_add.len() >= 500;

    let chunk_size = scan_change_chunk_size(existing_song_count, to_add.len());

    // 声明跨 Chunk 复用的 artist_cache，规避高频重复 SELECT 磁盘查找
    let mut artist_cache = std::collections::HashMap::new();

    let total_operations = to_add.len() + to_update.len() + to_delete.len();
    let mut written_operations = 0usize;
    if let Some(reporter) = reporter {
        reporter.emit_writing(0, total_operations);
    }

    for chunk in to_add.chunks(chunk_size) {
        apply_insert_batch(conn, chunk, &mut artist_cache, is_first_large_import)?;
        written_operations += chunk.len();
        if let Some(reporter) = reporter {
            reporter.emit_writing(written_operations, total_operations);
            reporter.emit_batch(chunk.to_vec(), Vec::new());
        }
    }

    for chunk in to_update.chunks(chunk_size) {
        apply_update_batch(conn, chunk, &mut artist_cache)?;
        written_operations += chunk.len();
        if let Some(reporter) = reporter {
            reporter.emit_writing(written_operations, total_operations);
            reporter.emit_batch(chunk.to_vec(), Vec::new());
        }
    }

    for chunk in to_delete.chunks(chunk_size) {
        apply_delete_batch(conn, chunk)?;
        written_operations += chunk.len();
        if let Some(reporter) = reporter {
            reporter.emit_writing(written_operations, total_operations);
            reporter.emit_batch(Vec::new(), chunk.to_vec());
        }
    }

    cleanup_unused_artists(conn);

    #[cfg(debug_assertions)]
    {
        let duration = start_time.elapsed();
        println!(
            "[Profiling] apply_scan_changes took {:?} (to_add: {}, to_update: {}, to_delete: {})",
            duration,
            to_add.len(),
            to_update.len(),
            to_delete.len()
        );
    }

    Ok(())
}
