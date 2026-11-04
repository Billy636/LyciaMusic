use super::types::*;
use crate::music::utils::normalize_path;
use reqwest::{Client, Url};
use serde_json::Value;
use std::collections::HashMap;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

pub const MAX_TRACKS: usize = 10_000;
const MAX_BYTES: usize = 16 * 1024 * 1024;

fn text(value: &Value) -> String {
    value.as_str().map(str::to_string).unwrap_or_else(|| {
        if value.is_number() {
            value.to_string()
        } else {
            String::new()
        }
    })
}

pub fn read_bytes(path: &Path) -> Result<Vec<u8>, String> {
    use std::io::Read;
    let file = fs::File::open(path).map_err(|e| format!("无法读取歌单文件：{e}"))?;
    if file.metadata().map_err(|e| e.to_string())?.len() > MAX_BYTES as u64 {
        return Err("歌单文件不能超过 16 MB".into());
    }
    let mut bytes = Vec::new();
    file.take((MAX_BYTES + 1) as u64)
        .read_to_end(&mut bytes)
        .map_err(|e| e.to_string())?;
    if bytes.len() > MAX_BYTES {
        return Err("歌单文件不能超过 16 MB".into());
    }
    Ok(bytes)
}

fn decode(bytes: &[u8], extension: &str) -> Result<(String, bool), String> {
    if let Ok(value) = std::str::from_utf8(bytes) {
        return Ok((value.trim_start_matches('\u{feff}').to_string(), false));
    }
    if extension == "m3u8" {
        return Err("M3U8 必须使用 UTF-8 编码，请重新导出或另存为 UTF-8".into());
    }
    let encoding = if bytes.starts_with(&[0xff, 0xfe]) {
        encoding_rs::UTF_16LE
    } else if bytes.starts_with(&[0xfe, 0xff]) {
        encoding_rs::UTF_16BE
    } else {
        encoding_rs::GBK
    };
    let (value, _, errors) = encoding.decode(bytes);
    if errors {
        return Err("无法识别文件编码，请另存为 UTF-8 后重试".into());
    }
    Ok((value.trim_start_matches('\u{feff}').to_string(), true))
}

fn clean_path(path: &Path) -> PathBuf {
    let mut result = PathBuf::new();
    for part in path.components() {
        match part {
            Component::CurDir => {}
            Component::ParentDir => {
                result.pop();
            }
            other => result.push(other.as_os_str()),
        }
    }
    result
}

fn resolve_path(raw: &str, parent: &Path, mapping: Option<&PathMapping>) -> String {
    let mut value = raw.trim().to_string();
    if let Some(mapping) = mapping.filter(|m| !m.from.trim().is_empty() && !m.to.trim().is_empty())
    {
        let from = mapping
            .from
            .replace('\\', "/")
            .trim_end_matches('/')
            .to_string();
        let normalized = value.replace('\\', "/");
        if normalized == from
            || normalized
                .strip_prefix(&from)
                .is_some_and(|rest| rest.starts_with('/'))
        {
            value = format!(
                "{}{}",
                mapping.to.trim_end_matches(['/', '\\']),
                &normalized[from.len()..]
            );
        }
    }
    if value.starts_with("file:") {
        if let Ok(url) = Url::parse(&value) {
            if let Ok(path) = url.to_file_path() {
                return normalize_path(&path.to_string_lossy());
            }
        }
        return value;
    }
    if value.contains("://") {
        return value;
    }
    if cfg!(windows) {
        value = value.replace('/', "\\");
    }
    let path = PathBuf::from(&value);
    // A foreign absolute path must remain unresolved until the user supplies a mapping.
    if raw.starts_with('/')
        && cfg!(windows)
        && value.starts_with('\\')
        && !value.starts_with("\\\\")
    {
        return value;
    }
    let resolved = if path.is_absolute() {
        path
    } else {
        parent.join(path)
    };
    normalize_path(&clean_path(&resolved).to_string_lossy())
}

pub fn read_file(path: &str, mapping: Option<&PathMapping>) -> Result<SourceDocument, String> {
    let path = PathBuf::from(path);
    let bytes = read_bytes(&path)?;
    parse_file(&path, &bytes, mapping)
}

pub fn parse_file(
    path: &Path,
    bytes: &[u8],
    mapping: Option<&PathMapping>,
) -> Result<SourceDocument, String> {
    let extension = path
        .extension()
        .and_then(|x| x.to_str())
        .unwrap_or("")
        .to_lowercase();
    if !["m3u", "m3u8", "txt", "csv", "json"].contains(&extension.as_str()) {
        return Err("支持 M3U、M3U8、TXT、CSV 和 JSON 歌单文件".into());
    }
    let (content, legacy_encoding) = decode(bytes, &extension)?;
    let name = path
        .file_stem()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string();
    let source = normalize_path(&path.to_string_lossy());
    let path_list = extension == "txt"
        && content
            .lines()
            .map(str::trim)
            .filter(|s| !s.is_empty() && !s.starts_with('#'))
            .all(|line| {
                let line = line.replace('\\', "/");
                Path::new(&line)
                    .extension()
                    .and_then(|s| s.to_str())
                    .is_some_and(|ext| {
                        crate::music::utils::is_supported_library_extension(&ext.to_lowercase())
                    })
            });
    let mut doc = if extension == "m3u" || extension == "m3u8" || path_list {
        parse_m3u(
            &content,
            &name,
            &source,
            path.parent().unwrap_or(Path::new(".")),
            mapping,
        )?
    } else {
        parse_list(&content, &extension, &name, &source)?
    };
    if legacy_encoding {
        doc.warnings
            .push("文件已按旧编码读取；建议使用 UTF-8，方便跨设备使用。".into());
    }
    if doc.tracks.len() > MAX_TRACKS {
        return Err("单次最多导入 10000 首歌曲".into());
    }
    Ok(doc)
}

fn parse_m3u(
    content: &str,
    name: &str,
    source: &str,
    parent: &Path,
    mapping: Option<&PathMapping>,
) -> Result<SourceDocument, String> {
    if content
        .lines()
        .any(|line| line.trim().starts_with("#EXT-X-"))
    {
        return Err("这是 HLS 流媒体播放列表，请选择列出本地音乐文件的 M3U/M3U8 歌单".into());
    }
    let mut tracks = Vec::new();
    let mut info = SourceTrack::default();
    for line in content.replace("\r\n", "\n").replace('\r', "\n").lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        if let Some(value) = line.strip_prefix("#EXTINF:") {
            let (seconds, label) = value.split_once(',').unwrap_or((value, ""));
            info.duration = seconds
                .parse::<f64>()
                .ok()
                .filter(|d| d.is_finite() && *d > 0.0);
            info.title = label.to_string();
        } else if !line.starts_with('#') {
            let path = resolve_path(line, parent, mapping);
            if info.title.is_empty() {
                info.title = Path::new(&path)
                    .file_stem()
                    .unwrap_or_default()
                    .to_string_lossy()
                    .to_string();
            }
            info.path = Some(path);
            tracks.push(std::mem::take(&mut info));
            if tracks.len() > MAX_TRACKS {
                return Err("单次最多导入 10000 首歌曲".into());
            }
        }
    }
    let remote = tracks
        .iter()
        .filter(|t| t.path.as_deref().is_some_and(|p| p.contains("://")))
        .count();
    let warnings = if remote > 0 {
        vec![format!(
            "有 {remote} 个网络地址；本次仅解析本地音乐，网络条目会保留为不可用。"
        )]
    } else {
        vec![]
    };
    Ok(SourceDocument {
        name: name.into(),
        kind: "m3u".into(),
        source: source.into(),
        total: tracks.len(),
        tracks,
        warnings,
    })
}

fn artists(value: &Value) -> Vec<String> {
    if let Some(items) = value.as_array() {
        items
            .iter()
            .map(|x| {
                if x.is_object() {
                    text(&x["name"])
                } else {
                    text(x)
                }
            })
            .filter(|x| !x.is_empty())
            .collect()
    } else {
        split_artists(&text(value))
    }
}

pub fn split_artists(value: &str) -> Vec<String> {
    value
        .split(['/', ';', '；', '、'])
        .map(str::trim)
        .filter(|x| !x.is_empty())
        .map(str::to_string)
        .collect()
}

fn duration(value: &str) -> Option<f64> {
    let result = if value.contains(':') {
        value.split(':').try_fold(0.0, |sum, part| {
            part.parse::<f64>().ok().map(|p| sum * 60.0 + p)
        })
    } else {
        value.parse().ok()
    };
    result.filter(|d| d.is_finite() && *d > 0.0)
}

pub fn parse_list(
    content: &str,
    format: &str,
    name: &str,
    source: &str,
) -> Result<SourceDocument, String> {
    if content.len() > MAX_BYTES {
        return Err("歌曲清单不能超过 16 MB".into());
    }
    let mut tracks = Vec::new();
    let mut list_name = name.to_string();
    if format == "json" || content.trim_start().starts_with(['[', '{']) {
        let value: Value =
            serde_json::from_str(content).map_err(|e| format!("JSON 歌单格式错误：{e}"))?;
        let rows = value
            .as_array()
            .or_else(|| value["tracks"].as_array())
            .ok_or("JSON 应为歌曲数组，或包含 name 和 tracks 的对象")?;
        if let Some(name) = value["name"].as_str() {
            list_name = name.into();
        }
        if rows.len() > MAX_TRACKS {
            return Err("单次最多导入 10000 首歌曲".into());
        }
        for row in rows {
            let title = text(
                row.get("title")
                    .or_else(|| row.get("name"))
                    .unwrap_or(&Value::Null),
            );
            if title.trim().is_empty() {
                return Err(format!("第 {} 首歌曲缺少 title / name", tracks.len() + 1));
            }
            tracks.push(SourceTrack {
                id: row.get("id").map(text).filter(|s| !s.is_empty()),
                title,
                artists: artists(
                    row.get("artists")
                        .or_else(|| row.get("artist"))
                        .unwrap_or(&Value::Null),
                ),
                album: if row["album"].is_object() {
                    text(&row["album"]["name"])
                } else {
                    text(&row["album"])
                },
                duration: duration(&text(&row["duration"])),
                path: None,
            });
        }
    } else if format == "csv" {
        let mut reader = csv::ReaderBuilder::new()
            .trim(csv::Trim::All)
            .from_reader(content.as_bytes());
        let headers = reader.headers().map_err(|e| e.to_string())?.clone();
        let column = |names: &[&str]| {
            headers
                .iter()
                .position(|h| names.iter().any(|n| h.eq_ignore_ascii_case(n)))
        };
        let title = column(&["title", "name", "歌名", "歌曲名", "歌曲名称"])
            .ok_or("CSV 需要 title（歌名）列；可选 artists、album、duration 列")?;
        let artist = column(&["artists", "artist", "歌手", "艺术家"]);
        let album = column(&["album", "专辑"]);
        let seconds = column(&["duration", "时长"]);
        for (i, row) in reader.records().enumerate() {
            if tracks.len() >= MAX_TRACKS {
                return Err("单次最多导入 10000 首歌曲".into());
            }
            let row = row.map_err(|e| format!("CSV 第 {} 行格式错误：{e}", i + 2))?;
            let get = |index: Option<usize>| index.and_then(|i| row.get(i)).unwrap_or("");
            if get(Some(title)).is_empty() {
                return Err(format!("CSV 第 {} 行缺少歌名", i + 2));
            }
            tracks.push(SourceTrack {
                title: get(Some(title)).into(),
                artists: split_artists(get(artist)),
                album: get(album).into(),
                duration: duration(get(seconds)),
                ..Default::default()
            });
        }
    } else {
        for line in content.lines().map(str::trim).filter(|s| !s.is_empty()) {
            if tracks.len() >= MAX_TRACKS {
                return Err("单次最多导入 10000 首歌曲".into());
            }
            let parts: Vec<&str> = line.split('\t').collect();
            let (title, artist, album) = if parts.len() > 1 {
                (parts[0], parts[1], parts.get(2).copied().unwrap_or(""))
            } else if let Some((title, artist)) = line.split_once(" - ") {
                (title, artist, "")
            } else {
                (line, "", "")
            };
            tracks.push(SourceTrack {
                title: title.trim().into(),
                artists: split_artists(artist),
                album: album.trim().into(),
                ..Default::default()
            });
        }
    }
    if tracks.len() > MAX_TRACKS {
        return Err("单次最多导入 10000 首歌曲".into());
    }
    Ok(SourceDocument {
        name: list_name,
        kind: "list".into(),
        source: source.into(),
        total: tracks.len(),
        tracks,
        warnings: vec![],
    })
}

fn allowed_host(url: &Url) -> bool {
    url.scheme() == "https"
        && url.host_str().is_some_and(|host| {
            ["music.163.com", "163cn.tv", "y.qq.com"]
                .iter()
                .any(|suffix| host == *suffix || host.ends_with(&format!(".{suffix}")))
        })
}

async fn json(
    client: &Client,
    url: &str,
    query: &[(&str, String)],
    referer: &str,
) -> Result<Value, String> {
    let mut response = client
        .get(url)
        .query(query)
        .header("Referer", referer)
        .send()
        .await
        .map_err(|e| format!("连接音乐平台失败：{e}。可以改用歌曲清单文件导入。"))?
        .error_for_status()
        .map_err(|e| format!("平台读取失败：{e}"))?;
    let mut bytes = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| e.to_string())? {
        if bytes.len() + chunk.len() > MAX_BYTES {
            return Err("平台返回的数据过大".into());
        }
        bytes.extend_from_slice(&chunk);
    }
    let data = std::str::from_utf8(&bytes).map_err(|_| "平台返回了无法识别的数据")?;
    let start = data
        .find('{')
        .ok_or("平台未返回歌单数据，请检查链接，或改用文件导入")?;
    let end = data.rfind('}').ok_or("平台返回的数据不完整")?;
    serde_json::from_str(&data[start..=end])
        .map_err(|_| "平台返回格式已变化，请改用文件导入".into())
}

pub async fn read_url(input: &str) -> Result<SourceDocument, String> {
    let regex = regex::Regex::new(r#"https?://[^\s<>\"'，。]+"#).map_err(|e| e.to_string())?;
    let value = regex
        .find(input)
        .ok_or("请粘贴网易云音乐或 QQ 音乐的歌单分享链接")?
        .as_str()
        .trim_end_matches([')', '）', '】']);
    let mut url = Url::parse(value).map_err(|_| "歌单链接格式无效")?;
    if url.scheme() == "http" {
        let _ = url.set_scheme("https");
    }
    if !allowed_host(&url) {
        return Err("目前支持网易云音乐和 QQ 音乐的公开歌单链接".into());
    }
    let client = Client::builder()
        .user_agent("Mozilla/5.0 LyciaMusic/1.5")
        .timeout(Duration::from_secs(20))
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !allowed_host(attempt.url()) {
                attempt.error("不支持的歌单链接跳转")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|e| e.to_string())?;
    if url
        .host_str()
        .is_some_and(|h| h == "163cn.tv" || h.ends_with(".163cn.tv"))
        || url.path().contains("/gmid/")
        || url.path().contains("/u/")
        || url.path().ends_with("/fcgi-bin/u")
    {
        url = client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("无法展开分享链接：{e}"))?
            .url()
            .clone();
    }
    if let Some(fragment) = url.fragment().filter(|f| f.contains("playlist")) {
        url = Url::parse(&format!(
            "https://{}{}{}",
            url.host_str().unwrap_or(""),
            if fragment.starts_with('/') { "" } else { "/" },
            fragment
        ))
        .map_err(|_| "无法识别歌单链接")?;
    }
    let id = url
        .query_pairs()
        .find(|(key, _)| ["id", "disstid"].contains(&key.as_ref()))
        .map(|(_, value)| value.into_owned())
        .or_else(|| {
            url.path_segments()
                .and_then(|s| s.filter(|s| !s.is_empty()).next_back())
                .map(|s| s.trim_end_matches(".html").to_string())
        })
        .filter(|s| !s.is_empty() && s.chars().all(|c| c.is_ascii_digit()))
        .ok_or("未找到歌单 ID，请复制完整的歌单分享链接")?;
    if url
        .host_str()
        .is_some_and(|h| h == "music.163.com" || h.ends_with(".music.163.com"))
    {
        let value = json(
            &client,
            "https://music.163.com/api/v3/playlist/detail",
            &[("id", id.clone()), ("n", "100000".into())],
            "https://music.163.com/",
        )
        .await?;
        if value["code"].as_i64() != Some(200) || !value["playlist"].is_object() {
            return Err(
                "无法读取该网易云歌单，可能需要登录或歌单未公开；请改用歌曲清单文件".into(),
            );
        }
        let playlist = &value["playlist"];
        let empty = vec![];
        let ids: Vec<String> = playlist["trackIds"]
            .as_array()
            .unwrap_or(&empty)
            .iter()
            .map(|v| text(&v["id"]))
            .collect();
        let expected = playlist["trackCount"].as_u64().unwrap_or(ids.len() as u64) as usize;
        if expected > MAX_TRACKS || ids.len() > MAX_TRACKS {
            return Err("单次最多导入 10000 首歌曲".into());
        }
        let mut songs: HashMap<String, Value> = playlist["tracks"]
            .as_array()
            .unwrap_or(&empty)
            .iter()
            .map(|v| (text(&v["id"]), v.clone()))
            .collect();
        let missing: Vec<String> = ids
            .iter()
            .filter(|id| !songs.contains_key(*id))
            .cloned()
            .collect();
        let mut warnings = Vec::new();
        for batch in missing.chunks(200) {
            match json(
                &client,
                "https://music.163.com/api/song/detail/",
                &[("ids", format!("[{}]", batch.join(",")))],
                "https://music.163.com/",
            )
            .await
            {
                Ok(value) => {
                    for song in value["songs"].as_array().unwrap_or(&empty) {
                        songs.insert(text(&song["id"]), song.clone());
                    }
                }
                Err(_) => {
                    warnings.push("部分歌曲详情读取失败，已保留其平台 ID，可稍后手动匹配。".into());
                    break;
                }
            }
        }
        let order = if ids.is_empty() {
            playlist["tracks"]
                .as_array()
                .unwrap_or(&empty)
                .iter()
                .map(|v| text(&v["id"]))
                .collect()
        } else {
            ids
        };
        let tracks = order
            .iter()
            .map(|id| {
                let s = songs.get(id).unwrap_or(&Value::Null);
                SourceTrack {
                    id: Some(id.clone()),
                    title: s["name"].as_str().unwrap_or("").to_string(),
                    artists: artists(
                        s.get("ar")
                            .or_else(|| s.get("artists"))
                            .unwrap_or(&Value::Null),
                    ),
                    album: text(
                        &s.get("al")
                            .or_else(|| s.get("album"))
                            .unwrap_or(&Value::Null)["name"],
                    ),
                    duration: s
                        .get("dt")
                        .or_else(|| s.get("duration"))
                        .and_then(Value::as_f64)
                        .map(|d| d / 1000.0),
                    path: None,
                }
            })
            .collect::<Vec<_>>();
        if tracks.len() != expected {
            warnings.push(format!(
                "平台标记共 {expected} 首，实际读取到 {} 个条目；当前清单可能不完整。",
                tracks.len()
            ));
        }
        Ok(SourceDocument {
            name: text(&playlist["name"]),
            kind: "netease".into(),
            source: format!("https://music.163.com/playlist?id={id}"),
            tracks,
            total: expected,
            warnings,
        })
    } else {
        let value = json(
            &client,
            "https://i.y.qq.com/qzone-music/fcg-bin/fcg_ucc_getcdinfo_byids_cp.fcg",
            &[
                ("disstid", id.clone()),
                ("type", "1".into()),
                ("json", "1".into()),
                ("utf8", "1".into()),
                ("onlysong", "0".into()),
                ("format", "json".into()),
            ],
            "https://y.qq.com/",
        )
        .await?;
        let playlist = &value["cdlist"][0];
        let rows = playlist["songlist"]
            .as_array()
            .ok_or("QQ 音乐未返回歌曲清单，可能需要登录或接口受限；请改用歌曲清单文件")?;
        if rows.len() > MAX_TRACKS {
            return Err("单次最多导入 10000 首歌曲".into());
        }
        let tracks = rows
            .iter()
            .map(|s| SourceTrack {
                id: Some(text(
                    s.get("songmid")
                        .or_else(|| s.get("mid"))
                        .unwrap_or(&Value::Null),
                )),
                title: text(
                    s.get("songname")
                        .or_else(|| s.get("title"))
                        .unwrap_or(&Value::Null),
                ),
                artists: artists(&s["singer"]),
                album: s["albumname"]
                    .as_str()
                    .map(str::to_string)
                    .unwrap_or_else(|| text(&s["album"]["name"])),
                duration: s["interval"].as_f64(),
                path: None,
            })
            .collect::<Vec<_>>();
        let total = playlist["total_song_num"]
            .as_u64()
            .unwrap_or(tracks.len() as u64) as usize;
        let warnings = if total != tracks.len() {
            vec![format!(
                "平台标记共 {total} 首，实际读取到 {} 首；请用完整导出清单补充。",
                tracks.len()
            )]
        } else {
            vec![]
        };
        Ok(SourceDocument {
            name: text(&playlist["dissname"]),
            kind: "qq".into(),
            source: format!("https://y.qq.com/n/ryqq/playlist/{id}"),
            tracks,
            total,
            warnings,
        })
    }
}
