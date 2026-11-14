use super::types::{RemoteFileEntry, RemoteSourceCredentials};
use crate::music::scan_settings::LibraryScanSettings;
use encoding_rs::GBK;
use quick_xml::events::Event;
use quick_xml::Reader;
use reqwest::header::{HeaderMap, HeaderValue, CONTENT_TYPE, RANGE};
use reqwest::{Client, Method, StatusCode};
use std::collections::VecDeque;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;
use tokio::io::AsyncWriteExt;

pub(crate) fn shared_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .connect_timeout(Duration::from_secs(10))
            .timeout(Duration::from_secs(300))
            .pool_max_idle_per_host(4)
            .build()
            .expect("build webdav http client")
    })
}

#[derive(Debug, PartialEq, Eq)]
enum DownloadWriteMode {
    Fresh,
    Append,
}

fn choose_download_write_mode(existing_bytes: u64, status: StatusCode) -> DownloadWriteMode {
    if existing_bytes > 0 && status == StatusCode::PARTIAL_CONTENT {
        DownloadWriteMode::Append
    } else {
        DownloadWriteMode::Fresh
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use reqwest::StatusCode;

    fn remote_source(base_url: &str, root_path: &str) -> RemoteSourceCredentials {
        RemoteSourceCredentials {
            id: "source".to_string(),
            name: "Source".to_string(),
            provider: "webdav".to_string(),
            base_url: base_url.to_string(),
            username: None,
            password: None,
            root_path: root_path.to_string(),
            enabled: true,
            last_sync_at: None,
            last_sync_error: None,
            created_at: 0,
            updated_at: 0,
        }
    }

    #[test]
    fn build_url_keeps_root_path_for_root_relative_file() {
        assert_eq!(
            build_url(
                &remote_source("https://dav.example.com", "/music"),
                "/song.wav"
            ),
            "https://dav.example.com/music/song.wav"
        );
    }

    #[test]
    fn build_url_keeps_same_named_subdirectory_under_source_root() {
        assert_eq!(
            build_url(
                &remote_source("https://dav.example.com", "/music"),
                "/music/song.wav"
            ),
            "https://dav.example.com/music/music/song.wav"
        );
    }

    #[test]
    fn build_url_combines_base_path_and_root_path() {
        assert_eq!(
            build_url(
                &remote_source("https://dav.example.com/dav", "/music"),
                "/song.wav"
            ),
            "https://dav.example.com/dav/music/song.wav"
        );
    }

    #[test]
    fn href_to_remote_path_strips_source_root_path() {
        assert_eq!(
            href_to_remote_path(
                "/music/song.wav",
                &remote_source("https://dav.example.com", "/music")
            ),
            Some("/song.wav".to_string())
        );
        assert_eq!(
            href_to_remote_path(
                "/music/",
                &remote_source("https://dav.example.com", "/music")
            ),
            Some("/".to_string())
        );
    }

    #[test]
    fn resumes_when_partial_file_gets_partial_content() {
        assert_eq!(
            choose_download_write_mode(1024, StatusCode::PARTIAL_CONTENT),
            DownloadWriteMode::Append
        );
    }

    #[test]
    fn restarts_when_server_ignores_range_request() {
        assert_eq!(
            choose_download_write_mode(1024, StatusCode::OK),
            DownloadWriteMode::Fresh
        );
    }

    #[test]
    fn starts_fresh_without_partial_file() {
        assert_eq!(
            choose_download_write_mode(0, StatusCode::OK),
            DownloadWriteMode::Fresh
        );
    }

    #[test]
    fn decodes_gbk_lyrics_text() {
        let (bytes, _, _) = GBK.encode("[00:01.00]中文歌词");

        assert_eq!(decode_text_bytes(&bytes), "[00:01.00]中文歌词");
    }

    #[test]
    fn strips_utf8_bom_from_lyrics_text() {
        assert_eq!(
            decode_text_bytes(b"\xef\xbb\xbf[00:01.00]hello"),
            "[00:01.00]hello"
        );
    }
}

fn normalize_remote_path(path: &str) -> String {
    let normalized = path.replace('\\', "/");
    let trimmed = normalized.trim();
    if trimmed.is_empty() || trimmed == "/" {
        "/".to_string()
    } else if trimmed.starts_with('/') {
        trimmed.trim_end_matches('/').to_string()
    } else {
        format!("/{}", trimmed.trim_end_matches('/'))
    }
}

fn encode_path(path: &str) -> String {
    path.split('/')
        .filter(|segment| !segment.is_empty())
        .map(urlencoding::encode)
        .collect::<Vec<_>>()
        .join("/")
}

fn path_for_request(source: &RemoteSourceCredentials, path: &str) -> String {
    let normalized = normalize_remote_path(path);
    let root = normalize_remote_path(&source.root_path);
    if root == "/" {
        normalized
    } else if normalized == "/" {
        root
    } else {
        format!(
            "{}/{}",
            root.trim_end_matches('/'),
            normalized.trim_start_matches('/')
        )
    }
}

pub(crate) fn build_url(source: &RemoteSourceCredentials, path: &str) -> String {
    let base = source.base_url.trim_end_matches('/');
    let encoded = encode_path(&path_for_request(source, path));
    if encoded.is_empty() {
        format!("{base}/")
    } else {
        format!("{base}/{encoded}")
    }
}

fn file_name(path: &str) -> String {
    path.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|value| !value.is_empty())
        .unwrap_or(path)
        .to_string()
}

fn auth_request(
    request: reqwest::RequestBuilder,
    source: &RemoteSourceCredentials,
) -> reqwest::RequestBuilder {
    match source.username.as_deref() {
        Some(username) if !username.trim().is_empty() => {
            request.basic_auth(username.to_string(), source.password.clone())
        }
        _ => request,
    }
}

fn propfind_body() -> &'static str {
    r#"<?xml version="1.0" encoding="utf-8" ?>
<d:propfind xmlns:d="DAV:">
  <d:prop>
    <d:resourcetype />
    <d:getcontentlength />
    <d:getlastmodified />
    <d:getetag />
  </d:prop>
</d:propfind>"#
}

fn local_name(name: &[u8]) -> String {
    let raw = String::from_utf8_lossy(name);
    raw.rsplit(':').next().unwrap_or(&raw).to_string()
}

fn decode_text_bytes(bytes: &[u8]) -> String {
    match std::str::from_utf8(bytes) {
        Ok(text) => text.trim_start_matches('\u{feff}').to_string(),
        Err(_) => {
            let (decoded, _, _) = GBK.decode(bytes);
            decoded.trim_start_matches('\u{feff}').to_string()
        }
    }
}

fn href_to_remote_path(href: &str, source: &RemoteSourceCredentials) -> Option<String> {
    let decoded = urlencoding::decode(href).ok()?.replace('\\', "/");
    let base_path = reqwest::Url::parse(&source.base_url)
        .ok()
        .map(|url| url.path().trim_end_matches('/').to_string())
        .unwrap_or_default();
    let root = normalize_remote_path(&source.root_path);
    let mut path = decoded.as_str();

    if !base_path.is_empty() && (path == base_path || path.starts_with(&format!("{base_path}/"))) {
        path = &path[base_path.len()..];
    }

    let path_string = normalize_remote_path(path);
    if root != "/" && (path_string == root || path_string.starts_with(&format!("{root}/"))) {
        let relative = path_string[root.len()..].trim_start_matches('/');
        Some(if relative.is_empty() {
            "/".to_string()
        } else {
            format!("/{relative}")
        })
    } else if root == "/" {
        Some(path_string)
    } else {
        None
    }
}

fn parse_propfind_response(
    xml: &str,
    source: &RemoteSourceCredentials,
) -> Result<Vec<RemoteFileEntry>, String> {
    let mut reader = Reader::from_str(xml);
    reader.config_mut().trim_text(true);

    let mut entries = Vec::new();
    let mut in_response = false;
    let mut current_tag = String::new();
    let mut href = String::new();
    let mut size = 0u64;
    let mut etag: Option<String> = None;
    let mut modified_at: Option<String> = None;
    let mut is_dir = false;

    loop {
        match reader.read_event() {
            Ok(Event::Start(event)) => {
                let name = local_name(event.name().as_ref());
                if name == "response" {
                    in_response = true;
                    href.clear();
                    size = 0;
                    etag = None;
                    modified_at = None;
                    is_dir = false;
                } else if in_response {
                    if name == "collection" {
                        is_dir = true;
                    }
                    current_tag = name;
                }
            }
            Ok(Event::Empty(event)) if in_response => {
                if local_name(event.name().as_ref()) == "collection" {
                    is_dir = true;
                }
            }
            Ok(Event::Text(event)) if in_response => {
                let text = String::from_utf8_lossy(event.as_ref()).trim().to_string();
                match current_tag.as_str() {
                    "href" => href = text,
                    "getcontentlength" => size = text.parse::<u64>().unwrap_or(0),
                    "getetag" => etag = Some(text.trim_matches('"').to_string()),
                    "getlastmodified" => modified_at = Some(text),
                    _ => {}
                }
            }
            Ok(Event::End(event)) => {
                let name = local_name(event.name().as_ref());
                if name == "response" && in_response {
                    if let Some(remote_path) = href_to_remote_path(&href, source) {
                        entries.push(RemoteFileEntry {
                            name: file_name(&remote_path),
                            remote_path,
                            size,
                            etag: etag.clone(),
                            modified_at: modified_at.clone(),
                            is_dir,
                        });
                    }
                    in_response = false;
                }
                current_tag.clear();
            }
            Ok(Event::Eof) => break,
            Err(error) => return Err(error.to_string()),
            _ => {}
        }
    }

    Ok(entries)
}

pub(crate) async fn list_directory(
    client: &Client,
    source: &RemoteSourceCredentials,
    path: &str,
) -> Result<Vec<RemoteFileEntry>, String> {
    let method = Method::from_bytes(b"PROPFIND").map_err(|error| error.to_string())?;
    let mut headers = HeaderMap::new();
    headers.insert("Depth", HeaderValue::from_static("1"));
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/xml"));

    let request = client
        .request(method, build_url(source, path))
        .headers(headers)
        .body(propfind_body().to_string());
    let response = auth_request(request, source)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if !response.status().is_success() {
        return Err(format!("WebDAV 返回状态码 {}", response.status()));
    }

    let text = response.text().await.map_err(|error| error.to_string())?;
    let root = normalize_remote_path(path);
    Ok(parse_propfind_response(&text, source)?
        .into_iter()
        .filter(|entry| entry.remote_path != root)
        .collect())
}

pub(crate) async fn collect_audio_files(
    source: &RemoteSourceCredentials,
    settings: &LibraryScanSettings,
) -> Result<Vec<RemoteFileEntry>, String> {
    let client = shared_client();
    let mut queue = VecDeque::from(["/".to_string()]);
    let mut files = Vec::new();

    while let Some(path) = queue.pop_front() {
        for entry in list_directory(&client, source, &path).await? {
            if settings.excludes_relative_directory(&entry.remote_path, true) {
                continue;
            }
            if entry.is_dir {
                queue.push_back(entry.remote_path);
            } else if settings
                .includes_extension(entry.remote_path.rsplit('.').next().unwrap_or_default())
            {
                files.push(entry);
            }
        }
    }

    Ok(files)
}

pub(crate) async fn test_connection(source: &RemoteSourceCredentials) -> Result<(), String> {
    let client = shared_client();
    list_directory(&client, source, "/").await?;
    Ok(())
}

pub(crate) async fn read_text_file(
    source: &RemoteSourceCredentials,
    path: &str,
) -> Result<Option<String>, String> {
    let client = shared_client();
    let response = auth_request(client.get(build_url(source, path)), source)
        .send()
        .await
        .map_err(|error| error.to_string())?;

    if response.status() == StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(format!("WebDAV 返回状态码 {}", response.status()));
    }

    response
        .bytes()
        .await
        .map(|bytes| Some(decode_text_bytes(&bytes)))
        .map_err(|error| error.to_string())
}

pub(crate) async fn download_file_to_path(
    source: &RemoteSourceCredentials,
    remote_path: &str,
    target_path: &Path,
    mut on_progress: impl FnMut(u64, Option<u64>) + Send,
) -> Result<(), String> {
    let client = shared_client();
    let existing_bytes = tokio::fs::metadata(target_path)
        .await
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let mut request = client.get(build_url(source, remote_path));
    if existing_bytes > 0 {
        request = request.header(RANGE, format!("bytes={existing_bytes}-"));
    }
    let mut response = auth_request(request, source)
        .send()
        .await
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("远程文件下载失败：{}", response.status()));
    }

    let write_mode = choose_download_write_mode(existing_bytes, response.status());
    let content_length = response.content_length();
    let total = match write_mode {
        DownloadWriteMode::Append => content_length.map(|length| existing_bytes + length),
        DownloadWriteMode::Fresh => content_length,
    };
    let mut downloaded = match write_mode {
        DownloadWriteMode::Append => existing_bytes,
        DownloadWriteMode::Fresh => 0,
    };
    on_progress(downloaded, total);

    let mut file = match write_mode {
        DownloadWriteMode::Append => tokio::fs::OpenOptions::new()
            .append(true)
            .open(target_path)
            .await
            .map_err(|error| error.to_string())?,
        DownloadWriteMode::Fresh => tokio::fs::File::create(target_path)
            .await
            .map_err(|error| error.to_string())?,
    };
    while let Some(chunk) = response.chunk().await.map_err(|error| error.to_string())? {
        downloaded = downloaded.saturating_add(chunk.len() as u64);
        file.write_all(&chunk)
            .await
            .map_err(|error| error.to_string())?;
        on_progress(downloaded, total);
    }
    file.flush().await.map_err(|error| error.to_string())?;
    Ok(())
}
