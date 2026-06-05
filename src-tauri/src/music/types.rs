// music/types.rs - 数据结构定义

use serde::{Deserialize, Serialize};
use tokio::sync::Semaphore;

pub const THUMBNAIL_IMAGE_CONCURRENCY_LIMIT: usize = 2;
pub const FULL_COVER_IMAGE_CONCURRENCY_LIMIT: usize = 2;

/// 缩略图并发控制状态
pub struct ThumbnailImageConcurrencyLimit(pub Semaphore);

/// 高清封面并发控制状态
pub struct FullCoverImageConcurrencyLimit(pub Semaphore);

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn cover_image_concurrency_is_split_between_thumbnail_and_full_cover() {
        assert_eq!(THUMBNAIL_IMAGE_CONCURRENCY_LIMIT, 2);
        assert_eq!(FULL_COVER_IMAGE_CONCURRENCY_LIMIT, 2);

        let _thumbnail_limit =
            ThumbnailImageConcurrencyLimit(Semaphore::new(THUMBNAIL_IMAGE_CONCURRENCY_LIMIT));
        let _full_cover_limit =
            FullCoverImageConcurrencyLimit(Semaphore::new(FULL_COVER_IMAGE_CONCURRENCY_LIMIT));
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct Song {
    pub id: Option<i64>, // 数据库主键 (新增用于行为统计关联)
    pub name: String,
    pub title: String,
    pub path: String,
    pub artist: String,
    pub artist_names: Vec<String>,
    pub effective_artist_names: Vec<String>,
    pub album: String,
    pub album_artist: String,
    pub album_key: String,
    pub is_various_artists_album: bool,
    pub collapse_artist_credits: bool,
    pub duration: u32,
    pub cover_thumb_path: Option<String>,
    pub bitrate: u32,
    pub sample_rate: u32,
    pub bit_depth: Option<u8>,
    pub format: String,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub file_size: u64,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub added_at: Option<u64>,
    pub file_modified_at: Option<u64>,
    pub cue_source_path: Option<String>,
    pub cue_start_offset: Option<u32>,
    pub cue_end_offset: Option<u32>,
    pub comment: Option<String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct SongInfoEditPayload {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub year: Option<String>,
    pub cover_path: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SaveSongInfoResponse {
    pub song: Song,
    pub detail: SongDetail,
}

#[derive(Serialize, Clone, Debug)]
pub struct LibrarySong {
    pub id: Option<i64>,
    pub name: String,
    pub title: String,
    pub path: String,
    pub artist: String,
    pub artist_names: Vec<String>,
    pub effective_artist_names: Vec<String>,
    pub album: String,
    pub album_artist: String,
    pub album_key: String,
    pub is_various_artists_album: bool,
    pub collapse_artist_credits: bool,
    pub duration: u32,
    pub cover_thumb_path: Option<String>,
    pub bitrate: u32,
    pub sample_rate: u32,
    pub bit_depth: Option<u8>,
    pub format: String,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub added_at: Option<u64>,
    pub file_modified_at: Option<u64>,
    pub source_type: String,
    pub remote_source_id: Option<String>,
    pub cue_source_path: Option<String>,
    pub cue_start_offset: Option<u32>,
    pub cue_end_offset: Option<u32>,
    pub comment: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
pub struct SongDetail {
    pub path: String,
    pub genre: Option<String>,
    pub year: Option<String>,
    pub track_number: Option<String>,
    pub disc_number: Option<String>,
    pub comment: Option<String>,
    pub container: Option<String>,
    pub codec: Option<String>,
    pub file_size: Option<u64>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum LyricsStorageSource {
    Embedded,
    Sidecar,
    Empty,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SongLyricsForEdit {
    pub lyrics: String,
    pub source: LyricsStorageSource,
    pub source_path: Option<String>,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArtistCatalogItem {
    pub name: String,
    pub count: u32,
    pub first_song_path: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AlbumCatalogItem {
    pub key: String,
    pub name: String,
    pub count: u32,
    pub artist: String,
    pub first_song_path: String,
}

#[derive(Serialize)]
pub struct GeneratedFolder {
    pub name: String,
    pub path: String,
    pub songs: Vec<Song>,
}

#[derive(Serialize, Clone, Debug)]
pub struct FolderNode {
    pub name: String,
    pub path: String,
    pub children: Vec<FolderNode>,
    pub child_count: usize,
    pub children_loaded: bool,
    pub song_count: usize,
    pub cover_song_path: Option<String>,
    pub is_expanded: bool,
}

#[derive(Serialize)]
pub struct LibraryFolder {
    pub path: String,
    pub song_count: usize,
}
