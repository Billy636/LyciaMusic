use crate::database::DbState;
use rusqlite::{params, params_from_iter, Connection};
use serde::{Deserialize, Serialize};
use tauri::State;

pub(crate) const SEARCH_INDEX_VERSION: i64 = 1;
const SEARCH_INDEX_BATCH_MAX_SIZE: u32 = 256;

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexStatus {
    pub total: u64,
    pub indexed: u64,
    pub version: i64,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexSource {
    pub song_id: i64,
    pub path: String,
    pub title: String,
    pub artist_names: Vec<String>,
    pub album: String,
    pub album_artist: String,
    pub source_signature: String,
}

#[derive(Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexEntry {
    pub song_id: i64,
    pub title_full: String,
    pub title_initials: String,
    pub artist_full: String,
    pub artist_initials: String,
    pub album_full: String,
    pub album_initials: String,
    pub album_artist_full: String,
    pub album_artist_initials: String,
    pub literal_text: String,
    pub title_sort_key: String,
    pub source_signature: String,
}

fn make_source_signature(
    path: &str,
    title: &str,
    artist: &str,
    artist_names: &Option<String>,
    effective_artist_names: &Option<String>,
    album: &str,
    album_artist: &str,
) -> String {
    serde_json::to_string(&(
        path,
        title,
        artist,
        artist_names,
        effective_artist_names,
        album,
        album_artist,
    ))
    .unwrap_or_default()
}

fn load_source_signature(conn: &Connection, song_id: i64) -> Result<Option<String>, String> {
    let result = conn.query_row(
        "SELECT path, title, artist, artist_names, effective_artist_names, album, album_artist
         FROM songs WHERE id = ?1",
        [song_id],
        |row| {
            let path = row.get::<_, String>(0)?;
            let title = row.get::<_, Option<String>>(1)?.unwrap_or_default();
            let artist = row.get::<_, Option<String>>(2)?.unwrap_or_default();
            let artist_names = row.get::<_, Option<String>>(3)?;
            let effective_artist_names = row.get::<_, Option<String>>(4)?;
            let album = row.get::<_, Option<String>>(5)?.unwrap_or_default();
            let album_artist = row.get::<_, Option<String>>(6)?.unwrap_or_default();
            Ok(make_source_signature(
                &path,
                &title,
                &artist,
                &artist_names,
                &effective_artist_names,
                &album,
                &album_artist,
            ))
        },
    );
    match result {
        Ok(signature) => Ok(Some(signature)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}

fn deserialize_string_list(raw: Option<String>) -> Vec<String> {
    raw.and_then(|value| serde_json::from_str::<Vec<String>>(&value).ok())
        .unwrap_or_default()
}

fn preferred_artist_names(
    effective_artist_names: Option<String>,
    artist_names: Option<String>,
    artist: String,
) -> Vec<String> {
    let effective = deserialize_string_list(effective_artist_names);
    if !effective.is_empty() {
        return effective;
    }
    let names = deserialize_string_list(artist_names);
    if !names.is_empty() {
        return names;
    }
    if artist.trim().is_empty() {
        Vec::new()
    } else {
        vec![artist]
    }
}

pub(crate) fn normalize_search_tokens(query: &str) -> Vec<String> {
    let normalized = query
        .chars()
        .map(|character| match character {
            '\u{3000}' => ' ',
            '\u{ff01}'..='\u{ff5e}' => {
                char::from_u32(character as u32 - 0xfee0).unwrap_or(character)
            }
            '\u{00fc}' | '\u{00dc}' | '\u{01d6}' | '\u{01d5}' | '\u{01d8}' | '\u{01d7}'
            | '\u{01da}' | '\u{01d9}' | '\u{01dc}' | '\u{01db}' => 'v',
            other => other,
        })
        .collect::<String>()
        .to_lowercase()
        .replace(['-', '\'', '\u{2019}'], " ");

    normalized
        .split_whitespace()
        .filter(|token| !token.is_empty())
        .map(ToOwned::to_owned)
        .collect()
}

fn escape_like(value: &str) -> String {
    value
        .replace('^', "^^")
        .replace('%', "^%")
        .replace('_', "^_")
}

fn fts_prefix_query(token: &str) -> String {
    format!("\"{}\"*", token.replace('"', "\"\""))
}

fn fts_literal_query(token: &str) -> String {
    format!("\"{}\"", token.replace('"', "\"\""))
}

pub(crate) fn search_index_is_complete(conn: &Connection) -> bool {
    conn.query_row(
        "SELECT complete = 1 AND index_version = ?1 FROM song_search_meta WHERE id = 1",
        [SEARCH_INDEX_VERSION],
        |row| row.get::<_, bool>(0),
    )
    .unwrap_or(false)
}

/// Builds AND semantics across query segments. Each segment can match an existing
/// literal metadata/path substring or a pinyin token prefix in the persisted FTS index.
pub(crate) fn build_song_search_predicate(
    song_alias: &str,
    query: Option<&str>,
    index_complete: bool,
) -> (String, Vec<String>) {
    let Some(query) = query else {
        return (String::new(), Vec::new());
    };
    let tokens = normalize_search_tokens(query);
    if tokens.is_empty() {
        return (String::new(), Vec::new());
    }

    let mut sql = String::new();
    let mut values = Vec::new();
    for token in tokens {
        if index_complete && token.chars().count() >= 3 {
            sql.push_str(&format!(
                " AND (
                    {song_alias}.id IN (
                        SELECT rowid FROM song_search_fts WHERE song_search_fts MATCH ?
                    )
                    OR {song_alias}.id IN (
                        SELECT rowid FROM song_search_literal_fts
                        WHERE song_search_literal_fts MATCH ?
                    )
                )"
            ));
            values.push(fts_prefix_query(&token));
            values.push(fts_literal_query(&token));
            continue;
        }
        sql.push_str(&format!(
            " AND (
                LOWER(COALESCE({song_alias}.title, '')) LIKE ? ESCAPE '^'
                OR LOWER(COALESCE({song_alias}.artist, '')) LIKE ? ESCAPE '^'
                OR LOWER(COALESCE({song_alias}.album, '')) LIKE ? ESCAPE '^'
                OR LOWER(COALESCE({song_alias}.album_artist, '')) LIKE ? ESCAPE '^'
                OR LOWER(COALESCE({song_alias}.path, '')) LIKE ? ESCAPE '^'
                OR EXISTS (
                    SELECT 1
                    FROM song_artists
                    JOIN artists ON artists.id = song_artists.artist_id
                    WHERE song_artists.song_id = {song_alias}.id
                      AND LOWER(artists.name) LIKE ? ESCAPE '^'
                )
                OR {song_alias}.id IN (
                    SELECT rowid FROM song_search_fts WHERE song_search_fts MATCH ?
                )
                OR {song_alias}.id IN (
                    SELECT rowid FROM song_search_literal_fts
                    WHERE song_search_literal_fts MATCH ?
                )
            )"
        ));
        let like = format!("%{}%", escape_like(&token));
        for _ in 0..6 {
            values.push(like.clone());
        }
        values.push(fts_prefix_query(&token));
        values.push(fts_literal_query(&token));
    }
    (sql, values)
}

pub(crate) fn load_matching_song_paths(
    conn: &Connection,
    query: &str,
) -> Result<std::collections::HashSet<String>, String> {
    let (predicate, values) =
        build_song_search_predicate("songs", Some(query), search_index_is_complete(conn));
    if predicate.is_empty() {
        return Ok(std::collections::HashSet::new());
    }
    let sql = format!("SELECT songs.path FROM songs WHERE 1 = 1{predicate}");
    let mut statement = conn.prepare(&sql).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params_from_iter(values.iter()), |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?;
    Ok(rows.filter_map(Result::ok).collect())
}

fn load_status(conn: &Connection) -> Result<SearchIndexStatus, String> {
    let total = conn
        .query_row("SELECT COUNT(*) FROM songs", [], |row| row.get::<_, i64>(0))
        .map_err(|error| error.to_string())?
        .max(0) as u64;
    let indexed = conn
        .query_row(
            "SELECT COUNT(*) FROM song_search_index WHERE index_version = ?1",
            [SEARCH_INDEX_VERSION],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|error| error.to_string())?
        .max(0) as u64;
    if indexed >= total {
        conn.execute(
            "UPDATE song_search_meta SET index_version = ?1, complete = 1 WHERE id = 1",
            [SEARCH_INDEX_VERSION],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(SearchIndexStatus {
        total,
        indexed,
        version: SEARCH_INDEX_VERSION,
    })
}

#[tauri::command]
pub fn get_search_index_status(db_state: State<'_, DbState>) -> Result<SearchIndexStatus, String> {
    let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
    load_status(&conn)
}

#[tauri::command]
pub fn get_search_index_batch(
    limit: u32,
    db_state: State<'_, DbState>,
) -> Result<Vec<SearchIndexSource>, String> {
    let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
    let limit = limit.clamp(1, SEARCH_INDEX_BATCH_MAX_SIZE);
    let mut statement = conn
        .prepare(
            "SELECT songs.id, songs.path, songs.title, songs.artist, songs.artist_names,
                    songs.effective_artist_names, songs.album, songs.album_artist
             FROM songs
             LEFT JOIN song_search_index ON song_search_index.song_id = songs.id
             WHERE song_search_index.song_id IS NULL OR song_search_index.index_version <> ?1
             ORDER BY songs.id
             LIMIT ?2",
        )
        .map_err(|error| error.to_string())?;
    let result = statement
        .query_map(params![SEARCH_INDEX_VERSION, limit], |row| {
            let path = row.get::<_, String>(1)?;
            let title = row.get::<_, Option<String>>(2)?.unwrap_or_default();
            let artist = row.get::<_, Option<String>>(3)?.unwrap_or_default();
            let artist_names = row.get::<_, Option<String>>(4)?;
            let effective_artist_names = row.get::<_, Option<String>>(5)?;
            let album = row.get::<_, Option<String>>(6)?.unwrap_or_default();
            let album_artist = row.get::<_, Option<String>>(7)?.unwrap_or_default();
            Ok(SearchIndexSource {
                song_id: row.get(0)?,
                path: path.clone(),
                title: title.clone(),
                artist_names: preferred_artist_names(
                    effective_artist_names.clone(),
                    artist_names.clone(),
                    artist.clone(),
                ),
                album: album.clone(),
                album_artist: album_artist.clone(),
                source_signature: make_source_signature(
                    &path,
                    &title,
                    &artist,
                    &artist_names,
                    &effective_artist_names,
                    &album,
                    &album_artist,
                ),
            })
        })
        .map_err(|error| error.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
pub fn upsert_search_index_batch(
    entries: Vec<SearchIndexEntry>,
    db_state: State<'_, DbState>,
) -> Result<SearchIndexStatus, String> {
    if entries.is_empty() {
        let conn = db_state.conn.lock().map_err(|error| error.to_string())?;
        return load_status(&conn);
    }

    let mut conn = db_state.conn.lock().map_err(|error| error.to_string())?;
    let tx = conn.transaction().map_err(|error| error.to_string())?;
    {
        let mut statement = tx
            .prepare(
                "INSERT INTO song_search_index (
                    song_id, title_full, title_initials, artist_full, artist_initials,
                    album_full, album_initials, album_artist_full, album_artist_initials,
                    literal_text, title_sort_key, index_version
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12)
                 ON CONFLICT(song_id) DO UPDATE SET
                    title_full = excluded.title_full,
                    title_initials = excluded.title_initials,
                    artist_full = excluded.artist_full,
                    artist_initials = excluded.artist_initials,
                    album_full = excluded.album_full,
                    album_initials = excluded.album_initials,
                    album_artist_full = excluded.album_artist_full,
                    album_artist_initials = excluded.album_artist_initials,
                    literal_text = excluded.literal_text,
                    title_sort_key = excluded.title_sort_key,
                    index_version = excluded.index_version",
            )
            .map_err(|error| error.to_string())?;
        for entry in entries {
            if load_source_signature(&tx, entry.song_id)?.as_deref()
                != Some(entry.source_signature.as_str())
            {
                continue;
            }
            statement
                .execute(params![
                    entry.song_id,
                    entry.title_full,
                    entry.title_initials,
                    entry.artist_full,
                    entry.artist_initials,
                    entry.album_full,
                    entry.album_initials,
                    entry.album_artist_full,
                    entry.album_artist_initials,
                    entry.literal_text,
                    entry.title_sort_key,
                    SEARCH_INDEX_VERSION,
                ])
                .map_err(|error| error.to_string())?;
        }
    }
    tx.commit().map_err(|error| error.to_string())?;
    let status = load_status(&conn)?;
    if status.indexed >= status.total {
        conn.execute(
            "UPDATE song_search_meta SET index_version = ?1, complete = 1 WHERE id = 1",
            [SEARCH_INDEX_VERSION],
        )
        .map_err(|error| error.to_string())?;
    }
    Ok(status)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_segments_and_umlaut_without_merging_plain_u() {
        assert_eq!(
            normalize_search_tokens(" ＬＶ-SE's "),
            vec!["lv", "se", "s"]
        );
        assert_eq!(normalize_search_tokens("luse"), vec!["luse"]);
    }

    #[test]
    fn complete_index_uses_fts_for_common_queries_and_keeps_short_query_fallback() {
        let (indexed_sql, indexed_params) =
            build_song_search_predicate("songs", Some("jielun"), true);
        assert!(!indexed_sql.contains(" LIKE "));
        assert!(indexed_sql.contains("song_search_fts"));
        assert!(indexed_sql.contains("song_search_literal_fts"));
        assert_eq!(indexed_params, vec!["\"jielun\"*", "\"jielun\""]);

        let (short_sql, _) = build_song_search_predicate("songs", Some("jl"), true);
        assert!(short_sql.contains(" LIKE "));
    }

    #[test]
    fn indexed_prefix_and_literal_segments_use_and_semantics() {
        let conn = Connection::open_in_memory().expect("open database");
        crate::database::schema::ensure_base_schema(&conn).expect("create schema");
        conn.execute(
            "INSERT INTO songs (id, path, title, artist, album) VALUES (1, '/music/song.flac', '青花瓷', '周杰伦', '我很忙')",
            [],
        )
        .expect("insert song");
        conn.execute(
            "INSERT INTO song_search_index (
                song_id, title_full, title_initials, artist_full, artist_initials,
                album_full, album_initials, album_artist_full, album_artist_initials,
                literal_text, title_sort_key, index_version
             ) VALUES (1, 'qinghuaci huaci ci', 'qhc hc c', 'zhoujielun jielun lun', 'zjl jl l', '', '', '', '', '青花瓷 周杰伦 /music/song.flac', 'qinghuaci', 1)",
            [],
        )
        .expect("index song");
        conn.execute(
            "UPDATE song_search_meta SET index_version = 1, complete = 1 WHERE id = 1",
            [],
        )
        .expect("mark index complete");

        assert!(load_matching_song_paths(&conn, "qhc zjl")
            .expect("search")
            .contains("/music/song.flac"));
        assert!(load_matching_song_paths(&conn, "jielun")
            .expect("search")
            .contains("/music/song.flac"));
        assert!(!load_matching_song_paths(&conn, "oujie")
            .expect("search")
            .contains("/music/song.flac"));
        assert!(load_matching_song_paths(&conn, "青花瓷")
            .expect("literal trigram search")
            .contains("/music/song.flac"));

        conn.execute("UPDATE songs SET title = '夜曲' WHERE id = 1", [])
            .expect("update indexed metadata");
        let indexed_rows: i64 = conn
            .query_row("SELECT COUNT(*) FROM song_search_index", [], |row| {
                row.get(0)
            })
            .expect("count invalidated rows");
        assert_eq!(indexed_rows, 0);
        assert!(!load_matching_song_paths(&conn, "qhc")
            .expect("search invalidated index")
            .contains("/music/song.flac"));
    }
}
