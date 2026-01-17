use reqwest::header::{HeaderMap, HeaderValue, COOKIE, REFERER, USER_AGENT};
use serde::{Deserialize, Serialize};
use std::path::Path;

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct OnlineSongMetadata {
    pub title: String,
    pub artist: String,
    pub album: String,
    pub duration: u64, // Duration in milliseconds
    pub cover_url: Option<String>,
    pub source: String,   // "netease" or "qq"
    pub song_id: String,  // ID for fetching details/lyrics
    pub album_id: String, // ID for fetching album cover
    // Extended fields
    pub year: Option<String>,      // Release year
    pub track_number: Option<u32>, // Track number
    pub disc_number: Option<u32>,  // Disc number
    pub genre: Option<String>,     // Genre/Style
    pub lyrics: Option<String>,    // Lyrics text
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TagMatchOptions {
    pub match_title: bool,
    pub match_artist: bool,
    pub match_album: bool,
    pub match_cover: bool,
    // Extended options
    pub match_year: bool,
    pub match_track: bool,
    pub match_disc: bool,
    pub match_genre: bool,
    pub match_lyrics: bool,
}

// ----------------------
// Netease Logic
// ----------------------
mod netease {
    use super::*;

    #[derive(Deserialize)]
    struct NeteaseSearchResp {
        result: Option<NeteaseResult>,
        code: i32,
    }

    #[derive(Deserialize)]
    struct NeteaseResult {
        songs: Option<Vec<NeteaseSong>>,
    }

    #[derive(Deserialize)]
    struct NeteaseSong {
        id: u64,
        name: String,
        artists: Vec<NeteaseArtist>, // Public API uses "artists" not "ar"
        album: NeteaseAlbum,         // Public API uses "album" not "al"
        duration: u64,               // Public API uses "duration" not "dt"
    }

    #[derive(Deserialize)]
    struct NeteaseArtist {
        name: String,
    }

    #[derive(Deserialize)]
    struct NeteaseAlbum {
        id: u64,
        name: String,
        #[serde(rename = "picUrl")]
        pic_url: Option<String>,
        #[allow(dead_code)]
        #[serde(rename = "picId")]
        pic_id: Option<i64>, // picId is used to construct cover URL
        #[serde(rename = "publishTime")]
        publish_time: Option<i64>, // Timestamp for year extraction
    }

    // Fetch cover URL from song detail API
    async fn fetch_song_cover(song_ids: &[u64]) -> std::collections::HashMap<u64, String> {
        let mut covers = std::collections::HashMap::new();
        if song_ids.is_empty() {
            return covers;
        }

        let client = reqwest::Client::new();
        let ids_str = song_ids
            .iter()
            .map(|id| id.to_string())
            .collect::<Vec<_>>()
            .join(",");
        let url = format!("https://music.163.com/api/song/detail?ids=[{}]", ids_str);

        let mut headers = HeaderMap::new();
        headers.insert(
            USER_AGENT,
            HeaderValue::from_static(
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            ),
        );
        headers.insert(REFERER, HeaderValue::from_static("https://music.163.com/"));

        if let Ok(resp) = client.get(&url).headers(headers).send().await {
            if let Ok(text) = resp.text().await {
                // Parse response - it has songs[].album.picUrl
                #[derive(Deserialize)]
                struct DetailResp {
                    songs: Option<Vec<DetailSong>>,
                }
                #[derive(Deserialize)]
                struct DetailSong {
                    id: u64,
                    album: DetailAlbum,
                }
                #[derive(Deserialize)]
                struct DetailAlbum {
                    #[serde(rename = "picUrl")]
                    pic_url: Option<String>,
                }

                if let Ok(detail) = serde_json::from_str::<DetailResp>(&text) {
                    if let Some(songs) = detail.songs {
                        for song in songs {
                            if let Some(url) = song.album.pic_url {
                                covers.insert(song.id, url);
                            }
                        }
                    }
                }
            }
        }

        covers
    }

    pub async fn search(keyword: &str) -> Result<Vec<OnlineSongMetadata>, String> {
        println!("[Netease] Searching for: {}", keyword);
        let client = reqwest::Client::new();

        // Request only 5 results - usually first match is correct
        let url = format!(
            "https://music.163.com/api/search/get?s={}&type=1&offset=0&limit=5",
            urlencoding::encode(keyword)
        );

        let mut headers = HeaderMap::new();
        headers.insert(USER_AGENT, HeaderValue::from_static("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"));
        headers.insert(REFERER, HeaderValue::from_static("https://music.163.com/"));
        headers.insert(COOKIE, HeaderValue::from_static("appver=8.9.75; os=pc;"));

        let resp = client
            .post(&url)
            .headers(headers)
            .send()
            .await
            .map_err(|e| {
                println!("[Netease] Network error: {}", e);
                format!("Network error: {}", e)
            })?;

        println!("[Netease] Response status: {}", resp.status());

        if !resp.status().is_success() {
            return Err(format!("API returned status: {}", resp.status()));
        }

        let body_text = resp
            .text()
            .await
            .map_err(|e| format!("Read body error: {}", e))?;
        println!(
            "[Netease] Response body (first 300 chars): {}",
            &body_text.chars().take(300).collect::<String>()
        );

        let json_resp: NeteaseSearchResp = serde_json::from_str(&body_text).map_err(|e| {
            println!("[Netease] Parse error: {}", e);
            format!("Parse error: {}", e)
        })?;

        println!("[Netease] Response code: {}", json_resp.code);

        if json_resp.code != 200 {
            return Err(format!("API Error Code: {}", json_resp.code));
        }

        let mut results = Vec::new();
        if let Some(res) = json_resp.result {
            if let Some(songs) = res.songs {
                println!("[Netease] Found {} songs", songs.len());

                // Only fetch covers for the first 5 songs to reduce API calls
                let song_ids: Vec<u64> = songs.iter().take(5).map(|s| s.id).collect();
                let covers = fetch_song_cover(&song_ids).await;
                println!("[Netease] Fetched {} covers", covers.len());

                for song in songs {
                    // Use cover from detail API, fallback to search result's picUrl
                    let cover_url = covers.get(&song.id).cloned().or(song.album.pic_url.clone());

                    println!("[Netease] Song: {}, Cover URL: {:?}", song.name, cover_url);

                    results.push(OnlineSongMetadata {
                        title: song.name,
                        artist: song
                            .artists
                            .iter()
                            .map(|a| a.name.clone())
                            .collect::<Vec<_>>()
                            .join(" / "),
                        album: song.album.name.clone(),
                        duration: song.duration,
                        cover_url,
                        source: "netease".to_string(),
                        song_id: song.id.to_string(),
                        album_id: song.album.id.to_string(),
                        // Extract year from publish_time (milliseconds timestamp)
                        year: song.album.publish_time.and_then(|ts| {
                            if ts > 0 {
                                // Simple year calculation: 1970 + seconds/seconds_per_year
                                let secs = ts / 1000;
                                let year = 1970 + (secs / 31536000); // 365 * 24 * 60 * 60
                                Some(year.to_string())
                            } else {
                                None
                            }
                        }),
                        track_number: None,
                        disc_number: None,
                        genre: None,
                        lyrics: None,
                    });
                }
            }
        }
        println!("[Netease] Returning {} results", results.len());
        Ok(results)
    }
}

// ----------------------
// QQ Logic
// ----------------------
mod qq {
    use super::*;

    #[derive(Deserialize)]
    struct QQSearchResp {
        code: i32,
        data: Option<QQData>,
    }

    #[derive(Deserialize)]
    struct QQData {
        song: Option<QQSongData>,
    }

    #[derive(Deserialize)]
    struct QQSongData {
        list: Vec<QQSong>,
    }

    #[derive(Deserialize)]
    struct QQSong {
        #[allow(dead_code)]
        songid: u64,
        songmid: String,
        songname: String,
        singer: Vec<QQSinger>,
        albumname: String,
        albummid: String,
        interval: u64,
        #[serde(default)]
        pubtime: i64, // Publish time (Unix timestamp)
        #[serde(default)]
        index_album: u32, // Track number in album
    }

    #[derive(Deserialize)]
    struct QQSinger {
        name: String,
        #[allow(dead_code)]
        mid: Option<String>, // For singer cover fallback
    }

    pub async fn search(keyword: &str) -> Result<Vec<OnlineSongMetadata>, String> {
        let client = reqwest::Client::new();

        // Use the old client_search_cp API (works without login)
        let url = format!(
            "https://c.y.qq.com/soso/fcgi-bin/client_search_cp?w={}&n=10&page=1&format=json",
            urlencoding::encode(keyword)
        );

        let resp = client.get(&url)
            .header(USER_AGENT, "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36")
            .header(REFERER, "https://y.qq.com/")
            .send().await.map_err(|e| format!("Network error: {}", e))?;

        if !resp.status().is_success() {
            return Err(format!("API returned status: {}", resp.status()));
        }

        let text = resp
            .text()
            .await
            .map_err(|e| format!("Read error: {}", e))?;

        let json_resp: QQSearchResp =
            serde_json::from_str(&text).map_err(|e| format!("Parse error: {}", e))?;

        if json_resp.code != 0 {
            return Err(format!("API Error Code: {}", json_resp.code));
        }

        let mut results = Vec::new();
        if let Some(data) = json_resp.data {
            if let Some(song_data) = data.song {
                println!("[QQ] Found {} songs", song_data.list.len());
                for song in song_data.list {
                    // Only use album cover (T002), not singer avatar
                    let cover_url = if !song.albummid.is_empty() {
                        Some(format!(
                            "https://y.gtimg.cn/music/photo_new/T002R300x300M000{}.jpg",
                            song.albummid
                        ))
                    } else {
                        None
                    };

                    println!("[QQ] Song: {}, Cover: {:?}", song.songname, cover_url);

                    // Skip songs without cover for better UI
                    if cover_url.is_none() {
                        println!("[QQ] Skipping: {} (no cover)", song.songname);
                        continue;
                    }

                    results.push(OnlineSongMetadata {
                        title: song.songname,
                        artist: song
                            .singer
                            .iter()
                            .map(|s| s.name.clone())
                            .collect::<Vec<_>>()
                            .join(" / "),
                        album: song.albumname,
                        duration: song.interval * 1000,
                        cover_url,
                        source: "qq".to_string(),
                        song_id: song.songmid.clone(),
                        album_id: if song.albummid.is_empty() {
                            song.songmid
                        } else {
                            song.albummid
                        },
                        // Extract year from pubtime (Unix timestamp)
                        year: if song.pubtime > 0 {
                            let year = 1970 + (song.pubtime / 31536000);
                            Some(year.to_string())
                        } else {
                            None
                        },
                        track_number: if song.index_album > 0 {
                            Some(song.index_album)
                        } else {
                            None
                        },
                        disc_number: None,
                        genre: None,
                        lyrics: None,
                    });
                }
            }
        }
        Ok(results)
    }
}

// ----------------------
// Tag Writing Logic
// ----------------------
use lofty::picture::{MimeType, Picture, PictureType};
use lofty::prelude::*;
use lofty::probe::Probe;
use lofty::tag::{Accessor, Tag};

async fn fetch_image_data(url: &str) -> Result<Vec<u8>, String> {
    let client = reqwest::Client::new();
    let resp = client.get(url).send().await.map_err(|e| e.to_string())?;

    if !resp.status().is_success() {
        return Err(format!("Image fetch failed: {}", resp.status()));
    }

    resp.bytes()
        .await
        .map(|b| b.to_vec())
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn search_online_tags(
    keyword: String,
    source: Option<String>,
) -> Result<Vec<OnlineSongMetadata>, String> {
    let src = source.unwrap_or_else(|| "netease".to_string());
    match src.as_str() {
        "netease" => netease::search(&keyword).await,
        "qq" => qq::search(&keyword).await,
        _ => Err("Unknown source".to_string()),
    }
}

#[tauri::command]
pub async fn write_music_tags(
    path: String,
    metadata: OnlineSongMetadata,
    options: TagMatchOptions,
) -> Result<(), String> {
    let path_obj = Path::new(&path);
    if !path_obj.exists() {
        return Err("File not found".to_string());
    }

    let mut tagged_file = Probe::open(path_obj)
        .map_err(|e| format!("Probe error: {}", e))?
        .read()
        .map_err(|e| format!("Read error: {}", e))?;

    let tag = match tagged_file.primary_tag_mut() {
        Some(t) => t,
        None => {
            let tag_type = tagged_file.file_type().primary_tag_type();
            tagged_file.insert_tag(Tag::new(tag_type));
            tagged_file.primary_tag_mut().unwrap()
        }
    };

    if options.match_title {
        tag.set_title(metadata.title);
    }
    if options.match_artist {
        tag.set_artist(metadata.artist);
    }
    if options.match_album {
        tag.set_album(metadata.album);
    }

    if options.match_cover {
        if let Some(url) = metadata.cover_url {
            if let Ok(data) = fetch_image_data(&url).await {
                // Correctly use Picture::new_unchecked assuming Lofty 0.21+
                let pic = Picture::new_unchecked(
                    PictureType::CoverFront,
                    Some(MimeType::Jpeg), // Wrapped in Option
                    None,
                    data,
                );
                tag.push_picture(pic);
            }
        }
    }

    // Extended tag writing
    if options.match_year {
        if let Some(year_str) = metadata.year {
            if let Ok(year) = year_str.parse::<u32>() {
                tag.set_year(year);
            }
        }
    }

    if options.match_track {
        if let Some(track) = metadata.track_number {
            tag.set_track(track);
        }
    }

    if options.match_disc {
        if let Some(disc) = metadata.disc_number {
            tag.set_disk(disc);
        }
    }

    if options.match_genre {
        if let Some(genre) = metadata.genre {
            tag.set_genre(genre);
        }
    }

    tag.save_to_path(path_obj, lofty::config::WriteOptions::default())
        .map_err(|e| format!("Save error: {}", e))?;

    Ok(())
}
