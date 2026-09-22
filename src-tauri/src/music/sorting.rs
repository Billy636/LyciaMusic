//! Shared artist/album ordering for SQLite pages and materialized folder rows.

use pinyin::ToPinyin;
use rusqlite::{functions::FunctionFlags, Connection};
use std::cell::RefCell;
use std::cmp::Ordering;
use std::collections::{HashMap, VecDeque};
use std::sync::Arc;

/// Keep this order identical to the fields in `ArtistSongSortKey`.
/// `lycia_sort_text` supplies Unicode trim/lowercase semantics that SQLite's
/// built-in TRIM/LOWER do not provide.
pub(crate) const ARTIST_SONG_ORDER: &str = " ORDER BY
    COALESCE(lycia_sort_text(songs.artist), 'unknown') COLLATE LYCIA_PINYIN ASC,
    COALESCE(lycia_sort_text(songs.artist), 'unknown') COLLATE BINARY ASC,
    COALESCE(lycia_sort_text(songs.album), 'unknown') COLLATE LYCIA_PINYIN ASC,
    COALESCE(
        lycia_sort_text(songs.album_key),
        COALESCE(lycia_sort_text(songs.album), 'unknown') || '::' ||
        COALESCE(lycia_sort_text(songs.album_artist), lycia_sort_text(songs.artist), 'unknown')
    ) COLLATE BINARY ASC,
    lycia_sort_number(songs.disc_number) ASC NULLS LAST,
    lycia_sort_number(songs.track_number) ASC NULLS LAST,
    COALESCE(lycia_sort_text(songs.title), songs.path) COLLATE LYCIA_PINYIN ASC,
    songs.path COLLATE BINARY ASC
";

#[derive(Clone, Copy, Debug)]
pub(crate) struct ArtistSongSortMetadata<'a> {
    pub artist: &'a str,
    pub album: &'a str,
    pub album_artist: &'a str,
    pub album_key: &'a str,
    pub title: &'a str,
    pub path: &'a str,
    pub disc_number: Option<&'a str>,
    pub track_number: Option<&'a str>,
}

#[derive(Debug, Eq, PartialEq, Ord, PartialOrd)]
pub(crate) struct ArtistSongSortKey {
    artist: AlphabetSortKey,
    artist_identity: String,
    album: AlphabetSortKey,
    album_identity: String,
    disc_number: (bool, i32),
    track_number: (bool, i32),
    title: AlphabetSortKey,
    path: String,
}

pub(crate) fn artist_song_sort_key(metadata: ArtistSongSortMetadata<'_>) -> ArtistSongSortKey {
    let artist = normalized_text(metadata.artist).unwrap_or_else(|| "unknown".to_string());
    let album = normalized_text(metadata.album).unwrap_or_else(|| "unknown".to_string());
    let album_identity = normalized_text(metadata.album_key).unwrap_or_else(|| {
        let album_artist = normalized_text(metadata.album_artist).unwrap_or_else(|| artist.clone());
        format!("{album}::{album_artist}")
    });
    let title = normalized_text(metadata.title).unwrap_or_else(|| metadata.path.to_string());

    ArtistSongSortKey {
        artist: AlphabetSortKey::new(&artist),
        artist_identity: artist,
        album: AlphabetSortKey::new(&album),
        album_identity,
        disc_number: optional_number_key(metadata.disc_number),
        track_number: optional_number_key(metadata.track_number),
        title: AlphabetSortKey::new(&title),
        path: metadata.path.to_string(),
    }
}

fn normalized_text(value: &str) -> Option<String> {
    let value = value.trim();
    (!value.is_empty()).then(|| value.to_lowercase())
}

fn first_number(value: Option<&str>) -> Option<i32> {
    let value = value?;
    let start = value.find(|character: char| character.is_ascii_digit())?;
    let digits = &value[start..];
    let end = digits
        .find(|character: char| !character.is_ascii_digit())
        .unwrap_or(digits.len());
    digits[..end].parse().ok()
}

fn optional_number_key(value: Option<&str>) -> (bool, i32) {
    let number = first_number(value);
    (number.is_none(), number.unwrap_or_default())
}

fn half_width(character: char) -> char {
    match character {
        '\u{ff01}'..='\u{ff5e}' => char::from_u32(character as u32 - 0xfee0).unwrap(),
        '\u{3000}' => ' ',
        _ => character,
    }
}

fn is_wrapper(character: char) -> bool {
    matches!(
        character,
        '《' | '》' | '【' | '】' | '[' | ']' | '(' | ')' | '「' | '」' | '『' | '』'
    )
}

fn normalize_alphabet_text(value: &str) -> String {
    value
        .chars()
        .map(half_width)
        .map(|character| {
            if is_wrapper(character) {
                ' '
            } else {
                character
            }
        })
        .collect::<String>()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .to_lowercase()
}

/// Numeric runs are canonicalized so equality and natural ordering agree:
/// "track 02" and "track 2" are the same phonetic key. The explicit artist,
/// album and path tie-breakers still distinguish separate library identities.
fn canonicalize_numbers(value: &str) -> String {
    let mut result = String::with_capacity(value.len());
    let mut characters = value.char_indices().peekable();
    while let Some((start, character)) = characters.next() {
        if !character.is_ascii_digit() {
            result.push(character);
            continue;
        }

        let mut end = start + 1;
        while let Some(&(index, next)) = characters.peek() {
            if !next.is_ascii_digit() {
                break;
            }
            end = index + 1;
            characters.next();
        }
        let number = value[start..end].trim_start_matches('0');
        result.push_str(if number.is_empty() { "0" } else { number });
    }
    result
}

#[derive(Debug, Eq, PartialEq)]
struct AlphabetSortKey {
    group: u8,
    text: String,
}

impl AlphabetSortKey {
    fn new(value: &str) -> Self {
        let normalized = normalize_alphabet_text(value);
        let mut phonetic = String::with_capacity(normalized.len());
        let mut previous_was_chinese = false;
        for character in normalized.chars() {
            if let Some(pinyin) = character.to_pinyin() {
                if !phonetic.is_empty() && !phonetic.ends_with(' ') {
                    phonetic.push(' ');
                }
                phonetic.push_str(pinyin.plain());
                previous_was_chinese = true;
            } else {
                if previous_was_chinese && !character.is_whitespace() {
                    phonetic.push(' ');
                }
                phonetic.push(character);
                previous_was_chinese = false;
            }
        }

        let group = match phonetic.as_bytes().first() {
            Some(b'0'..=b'9') => 0,
            Some(character @ b'a'..=b'z') => *character - b'a' + 1,
            _ => 27,
        };

        Self {
            group,
            text: canonicalize_numbers(&phonetic),
        }
    }
}

impl Ord for AlphabetSortKey {
    fn cmp(&self, other: &Self) -> Ordering {
        self.group
            .cmp(&other.group)
            .then_with(|| compare_natural(&self.text, &other.text))
    }
}

impl PartialOrd for AlphabetSortKey {
    fn partial_cmp(&self, other: &Self) -> Option<Ordering> {
        Some(self.cmp(other))
    }
}

fn compare_natural(left: &str, right: &str) -> Ordering {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let (mut left_index, mut right_index) = (0, 0);

    while left_index < left.len() && right_index < right.len() {
        if left[left_index].is_ascii_digit() && right[right_index].is_ascii_digit() {
            let left_start = left_index;
            let right_start = right_index;
            while left_index < left.len() && left[left_index].is_ascii_digit() {
                left_index += 1;
            }
            while right_index < right.len() && right[right_index].is_ascii_digit() {
                right_index += 1;
            }
            let left_digits = &left[left_start..left_index];
            let right_digits = &right[right_start..right_index];
            let number_order = left_digits
                .len()
                .cmp(&right_digits.len())
                .then_with(|| left_digits.cmp(right_digits));
            if number_order != Ordering::Equal {
                return number_order;
            }
        } else {
            let character_order = left[left_index].cmp(&right[right_index]);
            if character_order != Ordering::Equal {
                return character_order;
            }
            left_index += 1;
            right_index += 1;
        }
    }

    (left.len() - left_index).cmp(&(right.len() - right_index))
}

const COLLATION_CACHE_MAX_ENTRIES: usize = 4096;
const COLLATION_CACHE_MAX_BYTES: usize = 4 * 1024 * 1024;

#[derive(Default)]
struct CollationKeyCache {
    keys: HashMap<String, (Arc<AlphabetSortKey>, usize)>,
    insertion_order: VecDeque<String>,
    bytes: usize,
}

impl CollationKeyCache {
    fn key(&mut self, value: &str) -> Arc<AlphabetSortKey> {
        if let Some((key, _)) = self.keys.get(value) {
            return Arc::clone(key);
        }

        let key = Arc::new(AlphabetSortKey::new(value));
        // Count both copies of the source string and the allocated key text.
        // Entry count also bounds HashMap/VecDeque bookkeeping independently.
        let bytes = value.len().saturating_mul(2) + key.text.capacity();
        if bytes > COLLATION_CACHE_MAX_BYTES {
            return key;
        }

        while self.keys.len() >= COLLATION_CACHE_MAX_ENTRIES
            || self.bytes + bytes > COLLATION_CACHE_MAX_BYTES
        {
            let Some(oldest) = self.insertion_order.pop_front() else {
                break;
            };
            if let Some((_, removed_bytes)) = self.keys.remove(&oldest) {
                self.bytes -= removed_bytes;
            }
        }
        self.keys
            .insert(value.to_string(), (Arc::clone(&key), bytes));
        self.insertion_order.push_back(value.to_string());
        self.bytes += bytes;
        key
    }
}

/// Registration replaces the connection's previous collation/cache, so neither
/// repeated queries nor repeated connections accumulate process-global keys.
pub(crate) fn register_song_sorting(conn: &Connection) -> Result<(), String> {
    let cache = RefCell::new(CollationKeyCache::default());
    conn.create_collation("LYCIA_PINYIN", move |left, right| {
        let mut cache = cache.borrow_mut();
        cache.key(left).cmp(&cache.key(right))
    })
    .map_err(|error| error.to_string())?;

    let flags = FunctionFlags::SQLITE_UTF8
        | FunctionFlags::SQLITE_DETERMINISTIC
        | FunctionFlags::SQLITE_INNOCUOUS;
    conn.create_scalar_function("lycia_sort_text", 1, flags, |context| {
        let value = context.get::<Option<String>>(0)?;
        Ok(value.as_deref().and_then(normalized_text))
    })
    .map_err(|error| error.to_string())?;
    conn.create_scalar_function("lycia_sort_number", 1, flags, |context| {
        let value = context.get::<Option<String>>(0)?;
        Ok(first_number(value.as_deref()))
    })
    .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn song<'a>(path: &'a str, artist: &'a str, album: &'a str) -> ArtistSongSortMetadata<'a> {
        ArtistSongSortMetadata {
            path,
            artist,
            album,
            album_artist: "",
            album_key: "",
            title: "Song",
            disc_number: Some("1"),
            track_number: Some("1"),
        }
    }

    fn rust_order(songs: &[ArtistSongSortMetadata<'_>]) -> Vec<String> {
        let mut sorted = songs.to_vec();
        sorted.sort_by_cached_key(|metadata| artist_song_sort_key(*metadata));
        sorted
            .iter()
            .map(|metadata| metadata.path.to_string())
            .collect()
    }

    fn sql_order(songs: &[ArtistSongSortMetadata<'_>]) -> Vec<String> {
        let connection = Connection::open_in_memory().unwrap();
        register_song_sorting(&connection).unwrap();
        connection
            .execute_batch(
                "CREATE TABLE songs (
                    path TEXT PRIMARY KEY, artist TEXT, album TEXT, album_artist TEXT,
                    album_key TEXT, title TEXT, disc_number TEXT, track_number TEXT
                );",
            )
            .unwrap();
        for metadata in songs {
            // Exercise NULL and empty/whitespace fallback equivalence as well.
            connection
                .execute(
                    "INSERT INTO songs VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    rusqlite::params![
                        metadata.path,
                        (!metadata.artist.is_empty()).then_some(metadata.artist),
                        (!metadata.album.is_empty()).then_some(metadata.album),
                        (!metadata.album_artist.is_empty()).then_some(metadata.album_artist),
                        (!metadata.album_key.is_empty()).then_some(metadata.album_key),
                        (!metadata.title.is_empty()).then_some(metadata.title),
                        metadata.disc_number,
                        metadata.track_number,
                    ],
                )
                .unwrap();
        }
        // Re-registration is safe between queries and replaces the old cache.
        register_song_sorting(&connection).unwrap();
        let mut statement = connection
            .prepare(&format!("SELECT songs.path FROM songs{ARTIST_SONG_ORDER}"))
            .unwrap();
        statement
            .query_map([], |row| row.get(0))
            .unwrap()
            .collect::<Result<Vec<String>, _>>()
            .unwrap()
    }

    #[test]
    fn sorts_numbers_english_and_chinese_before_the_symbol_group() {
        let songs = vec![
            song("zhou", "周杰伦", "Album"),
            song("symbol", "🙂Artist", "Album"),
            song("ten", "１０cc", "Album"),
            song("chen", "陈奕迅", "Album"),
            song("adele", "《Ａdele》", "Album"),
            song("zhang", "张学友", "Album"),
            song("two", "2Pac", "Album"),
        ];
        let expected = vec!["two", "ten", "adele", "chen", "zhang", "zhou", "symbol"];
        assert_eq!(rust_order(&songs), expected);
        assert_eq!(sql_order(&songs), expected);
    }

    #[test]
    fn phonetic_collation_normalizes_case_width_wrappers_and_numeric_runs() {
        assert_eq!(
            AlphabetSortKey::new("【ＡＬＰＨＡ　02】"),
            AlphabetSortKey::new("alpha 2")
        );
        assert_eq!(
            AlphabetSortKey::new("周杰伦"),
            AlphabetSortKey::new("zhou jie lun")
        );
        assert_eq!(AlphabetSortKey::new("陈"), AlphabetSortKey::new("晨"));
        assert!(AlphabetSortKey::new("Album 9") < AlphabetSortKey::new("Album 10"));
        assert!(
            AlphabetSortKey::new("Album 999999999999999999999999999999")
                < AlphabetSortKey::new("Album 1000000000000000000000000000000")
        );
    }

    #[test]
    fn artist_identity_precedes_album_and_album_identity_precedes_track() {
        let songs = vec![
            ArtistSongSortMetadata {
                title: "Z",
                track_number: Some("2"),
                ..song("chen-a2", "陈", "A")
            },
            song("chen-b1", "陈", "B"),
            song("morning-b1", "晨", "B"),
            song("morning-a1", "晨", "A"),
            song("chen-a1", "陈", "A"),
            ArtistSongSortMetadata {
                album_key: "second",
                track_number: Some("1"),
                ..song("edition-two", "歌手", "Live")
            },
            ArtistSongSortMetadata {
                album_key: "first",
                track_number: Some("10"),
                ..song("edition-one-10", "歌手", "Live")
            },
            ArtistSongSortMetadata {
                album_key: "first",
                track_number: Some("2"),
                ..song("edition-one-2", "歌手", "Live")
            },
        ];
        let expected = vec![
            "morning-a1",
            "morning-b1",
            "chen-a1",
            "chen-a2",
            "chen-b1",
            "edition-one-2",
            "edition-one-10",
            "edition-two",
        ];
        assert_eq!(rust_order(&songs), expected);
        assert_eq!(sql_order(&songs), expected);
    }

    #[test]
    fn optional_disc_and_track_numbers_keep_zero_and_put_invalid_values_last() {
        let songs = vec![
            ArtistSongSortMetadata {
                disc_number: None,
                ..song("missing-disc", "Artist", "Album")
            },
            ArtistSongSortMetadata {
                track_number: Some("invalid"),
                ..song("invalid-track", "Artist", "Album")
            },
            ArtistSongSortMetadata {
                track_number: Some("2147483648"),
                ..song("overflow-track", "Artist", "Album")
            },
            ArtistSongSortMetadata {
                track_number: Some("2147483647"),
                ..song("max-track", "Artist", "Album")
            },
            ArtistSongSortMetadata {
                track_number: Some("Track 02/12"),
                ..song("track-two", "Artist", "Album")
            },
            ArtistSongSortMetadata {
                track_number: Some("0"),
                ..song("track-zero", "Artist", "Album")
            },
            ArtistSongSortMetadata {
                disc_number: Some("Disc 0"),
                ..song("disc-zero", "Artist", "Album")
            },
        ];
        let expected = vec![
            "disc-zero",
            "track-zero",
            "track-two",
            "max-track",
            "invalid-track",
            "overflow-track",
            "missing-disc",
        ];
        assert_eq!(rust_order(&songs), expected);
        assert_eq!(sql_order(&songs), expected);
        assert_eq!(first_number(Some("Disc 0002/12")), Some(2));
        assert_eq!(first_number(Some("-2")), Some(2));
        assert_eq!(first_number(Some("")), None);
        assert_eq!(first_number(None), None);
    }

    #[test]
    fn sql_and_rust_agree_for_missing_labels_unicode_case_and_binary_paths() {
        let songs = vec![
            ArtistSongSortMetadata {
                title: "",
                album_artist: "\t",
                album_key: "\u{3000}",
                ..song("Song 10", "", "")
            },
            ArtistSongSortMetadata {
                title: "\t\u{3000}",
                ..song("Song 2", "\t", "\u{3000}")
            },
            ArtistSongSortMetadata {
                album_artist: "Σ",
                ..song("greek-1", "ÄRTIST", "Album")
            },
            ArtistSongSortMetadata {
                album_artist: "σ",
                ..song("greek-2", "ärtist", "Album")
            },
            ArtistSongSortMetadata {
                album_key: " ALBUM::ARTIST ",
                ..song("Path", "Artist", "Album")
            },
            song("path", "Artist", "Album"),
            ArtistSongSortMetadata {
                album_artist: "Band 2",
                ..song("same-title-a", "Artist", "Live")
            },
            ArtistSongSortMetadata {
                album_artist: "Band 3",
                ..song("same-title-b", "Artist", "Live")
            },
        ];
        let expected = rust_order(&songs);
        assert_eq!(sql_order(&songs), expected);
        assert!(
            expected.iter().position(|path| path == "Song 2")
                < expected.iter().position(|path| path == "Song 10")
        );
        assert!(
            expected.iter().position(|path| path == "Path")
                < expected.iter().position(|path| path == "path")
        );
    }

    #[test]
    fn collation_cache_is_bounded_and_reuses_precomputed_keys() {
        let mut cache = CollationKeyCache::default();
        let first = cache.key("周杰伦");
        assert!(Arc::ptr_eq(&first, &cache.key("周杰伦")));
        for index in 0..COLLATION_CACHE_MAX_ENTRIES + 32 {
            cache.key(&format!("Artist {index}"));
        }
        assert_eq!(cache.keys.len(), COLLATION_CACHE_MAX_ENTRIES);
        assert_eq!(cache.insertion_order.len(), COLLATION_CACHE_MAX_ENTRIES);
        assert!(cache.bytes <= COLLATION_CACHE_MAX_BYTES);
        assert!(!cache.keys.contains_key("周杰伦"));

        let long_value = "x".repeat(COLLATION_CACHE_MAX_BYTES / 2);
        cache.key(&long_value);
        assert!(!cache.keys.contains_key(&long_value));
        assert!(cache.bytes <= COLLATION_CACHE_MAX_BYTES);
    }
}
