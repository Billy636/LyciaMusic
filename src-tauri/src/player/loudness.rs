use lofty::prelude::*;
use lofty::tag::ItemKey;
use rodio::source::SeekError;
use rodio::Source;
use rusqlite::{params, Connection, OptionalExtension};
use std::fs;
use std::path::Path;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

// =========================================================================
// 1. ReplayGain 标签提取与高容错解析器
// =========================================================================

/// 提取 ReplayGain 的分贝值，支持 "dB" 后缀、大小写、空格过滤
fn parse_gain_db(raw: &str) -> Option<f32> {
    let cleaned = raw
        .to_lowercase()
        .replace("db", "")
        .replace(" ", "")
        .replace("+", "");
    cleaned.trim().parse::<f32>().ok()
}

/// 提取 ReplayGain 的 Peak 值
fn parse_peak(raw: &str) -> Option<f32> {
    let cleaned = raw.replace(" ", "");
    cleaned.trim().parse::<f32>().ok()
}

/// 解析音频内置的 ReplayGain 标签
pub fn extract_replaygain_from_path(path: &Path) -> Option<(f32, Option<f32>)> {
    let tagged_file = crate::music::tags::read_tagged_file_from_path(path).ok()?;
    let mut track_gain: Option<f32> = None;
    let mut track_peak: Option<f32> = None;

    // 优先读取 ID3v2/Vorbis 标签中所有可用的 Tag
    for tag in tagged_file.tags() {
        // 1. 尝试 Lofty 的内置内置 ItemKey
        if let Some(gain_str) = tag.get_string(&ItemKey::ReplayGainTrackGain) {
            if let Some(parsed) = parse_gain_db(gain_str) {
                track_gain = Some(parsed);
            }
        }
        if let Some(peak_str) = tag.get_string(&ItemKey::ReplayGainTrackPeak) {
            if let Some(parsed) = parse_peak(peak_str) {
                track_peak = Some(parsed);
            }
        }

        // 2. 备用：大小写不敏感遍历所有未知 Tag 项
        for item in tag.items() {
            let text_val = match item.value() {
                lofty::tag::ItemValue::Text(s) => Some(s.clone()),
                _ => None,
            };
            if let Some(val) = text_val {
                let is_match_gain = match item.key() {
                    ItemKey::ReplayGainTrackGain => true,
                    ItemKey::Unknown(k) => {
                        let k_lower = k.to_lowercase();
                        k_lower == "replaygain_track_gain" || k_lower == "replaygaintrackgain"
                    }
                    _ => false,
                };

                let is_match_peak = match item.key() {
                    ItemKey::ReplayGainTrackPeak => true,
                    ItemKey::Unknown(k) => {
                        let k_lower = k.to_lowercase();
                        k_lower == "replaygain_track_peak" || k_lower == "replaygaintrackpeak"
                    }
                    _ => false,
                };

                if track_gain.is_none() && is_match_gain {
                    if let Some(parsed) = parse_gain_db(&val) {
                        track_gain = Some(parsed);
                    }
                } else if track_peak.is_none() && is_match_peak {
                    if let Some(parsed) = parse_peak(&val) {
                        track_peak = Some(parsed);
                    }
                }
            }
        }
    }

    track_gain.map(|gain| (gain, track_peak))
}

// =========================================================================
// 2. GainRamp 渐变状态机 (全链路无爆音保证)
// =========================================================================

#[derive(Clone)]
pub struct VolumeNormalizerHandle {
    target_gain: Arc<AtomicU32>,
}

impl VolumeNormalizerHandle {
    pub fn set_target_gain(&self, gain: f32) {
        self.target_gain.store(gain.to_bits(), Ordering::Relaxed);
    }
}

pub struct GainRamp {
    target_gain: Arc<AtomicU32>,
    last_target_gain: f32,
    current_gain: f32,
    old_gain: f32,
    ramp_frames: usize,
    current_frame: usize,
    is_ramping: bool,
}

impl GainRamp {
    pub fn new(initial_gain: f32, sample_rate: u32, ramp_ms: u32) -> Self {
        let ramp_frames = ((ramp_ms as f64 / 1000.0) * sample_rate as f64).round() as usize;
        Self {
            target_gain: Arc::new(AtomicU32::new(initial_gain.to_bits())),
            last_target_gain: initial_gain,
            current_gain: initial_gain,
            old_gain: initial_gain,
            ramp_frames: ramp_frames.max(1),
            current_frame: 0,
            is_ramping: false,
        }
    }

    pub fn get_handle(&self) -> VolumeNormalizerHandle {
        VolumeNormalizerHandle {
            target_gain: self.target_gain.clone(),
        }
    }

    /// 在每一个 Frame 级调用一次，更新并返回当前 Frame 内所有声道共同使用的 Fixed Gain
    #[inline]
    pub fn next_frame_gain(&mut self) -> f32 {
        let target = f32::from_bits(self.target_gain.load(Ordering::Relaxed));

        // 连续指令状态机抗震逻辑：检测到目标偏离上一次的稳态目标
        if (target - self.last_target_gain).abs() > 0.00001 {
            // 重置状态机，以实际 current_gain 作为新的线性渐变起点
            self.old_gain = self.current_gain;
            self.last_target_gain = target;
            self.current_frame = 0;
            self.is_ramping = true;
        }

        if self.is_ramping {
            self.current_frame += 1;
            let progress = self.current_frame as f32 / self.ramp_frames as f32;
            if progress >= 1.0 {
                self.current_gain = target;
                self.is_ramping = false;
            } else {
                // 线性插值，平滑音量过渡，消除咔哒声
                self.current_gain = self.old_gain + (target - self.old_gain) * progress;
            }
        }

        self.current_gain
    }
}

// =========================================================================
// 3. VolumeNormalizer 过滤器 (共享模式 Source 深度实现)
// =========================================================================

pub struct VolumeNormalizer<I> {
    inner: I,
    ramp: GainRamp,
    channels: u16,
    current_channel: u16,
    current_frame_gain: f32,
}

impl<I> VolumeNormalizer<I>
where
    I: Source<Item = f32>,
{
    pub fn new(inner: I, initial_gain: f32, ramp_ms: u32) -> (Self, VolumeNormalizerHandle) {
        let sample_rate = inner.sample_rate();
        let channels = inner.channels();
        let ramp = GainRamp::new(initial_gain, sample_rate, ramp_ms);
        let handle = ramp.get_handle();

        let normalizer = Self {
            inner,
            ramp,
            channels,
            current_channel: 0,
            current_frame_gain: initial_gain,
        };
        (normalizer, handle)
    }
}

impl<I> Iterator for VolumeNormalizer<I>
where
    I: Source<Item = f32>,
{
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;

        // 保证在同一个 Frame 的所有声道均使用相同的 Gain，稳定声像
        if self.current_channel == 0 {
            self.current_frame_gain = self.ramp.next_frame_gain();
        }

        self.current_channel += 1;
        if self.current_channel >= self.channels {
            self.current_channel = 0;
        }

        Some(sample * self.current_frame_gain)
    }
}

impl<I> Source for VolumeNormalizer<I>
where
    I: Source<Item = f32>,
{
    #[inline]
    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    #[inline]
    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    #[inline]
    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    #[inline]
    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    #[inline]
    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        // 跳转后重置声道计数器，防止声道边界错位
        self.current_channel = 0;
        self.inner.try_seek(pos)
    }
}

// =========================================================================
// 4. SQLite 缓存读写服务
// =========================================================================

#[derive(serde::Serialize, serde::Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LoudnessRecord {
    pub song_id: i64,
    pub song_path: String,
    pub loudness_lufs: Option<f64>,
    pub estimated_loudness_lufs: Option<f64>,
    pub sample_peak: Option<f64>,
    pub true_peak: Option<f64>,
    pub tag_track_gain_db: Option<f64>,
    pub tag_track_peak: Option<f64>,
    pub tag_album_gain_db: Option<f64>,
    pub tag_album_peak: Option<f64>,
    pub tag_r128_track_gain_db: Option<f64>,
    pub tag_r128_album_gain_db: Option<f64>,
    pub file_size: i64,
    pub file_modified_at: i64,
    pub scan_source: String,
    pub analyzer_name: Option<String>,
    pub analyzer_version: i32,
    pub scan_status: String,
    pub scanned_at: Option<i64>,
    pub error_message: Option<String>,
}

/// 从 SQLite 查询特定歌曲的音量缓存记录
pub fn get_song_loudness_record(
    conn: &Connection,
    song_id: i64,
) -> Result<Option<LoudnessRecord>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT song_id, song_path, loudness_lufs, estimated_loudness_lufs, sample_peak, true_peak,
                    tag_track_gain_db, tag_track_peak, tag_album_gain_db, tag_album_peak,
                    tag_r128_track_gain_db, tag_r128_album_gain_db, file_size, file_modified_at,
                    scan_source, analyzer_name, analyzer_version, scan_status, scanned_at, error_message
             FROM song_loudness WHERE song_id = ?1",
        )
        .map_err(|e| e.to_string())?;

    let record = stmt
        .query_row(params![song_id], |row| {
            Ok(LoudnessRecord {
                song_id: row.get(0)?,
                song_path: row.get(1)?,
                loudness_lufs: row.get(2)?,
                estimated_loudness_lufs: row.get(3)?,
                sample_peak: row.get(4)?,
                true_peak: row.get(5)?,
                tag_track_gain_db: row.get(6)?,
                tag_track_peak: row.get(7)?,
                tag_album_gain_db: row.get(8)?,
                tag_album_peak: row.get(9)?,
                tag_r128_track_gain_db: row.get(10)?,
                tag_r128_album_gain_db: row.get(11)?,
                file_size: row.get(12)?,
                file_modified_at: row.get(13)?,
                scan_source: row.get(14)?,
                analyzer_name: row.get(15)?,
                analyzer_version: row.get(16)?,
                scan_status: row.get(17)?,
                scanned_at: row.get(18)?,
                error_message: row.get(19)?,
            })
        })
        .optional()
        .map_err(|e| e.to_string())?;

    Ok(record)
}

/// 将客观提取指标写入或更新到数据库中
pub fn upsert_song_loudness_record(
    conn: &Connection,
    record: &LoudnessRecord,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO song_loudness (
            song_id, song_path, loudness_lufs, estimated_loudness_lufs, sample_peak, true_peak,
            tag_track_gain_db, tag_track_peak, tag_album_gain_db, tag_album_peak,
            tag_r128_track_gain_db, tag_r128_album_gain_db, file_size, file_modified_at,
            scan_source, analyzer_name, analyzer_version, scan_status, scanned_at, error_message
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20)
         ON CONFLICT(song_id) DO UPDATE SET
            song_path = excluded.song_path,
            loudness_lufs = excluded.loudness_lufs,
            estimated_loudness_lufs = excluded.estimated_loudness_lufs,
            sample_peak = excluded.sample_peak,
            true_peak = excluded.true_peak,
            tag_track_gain_db = excluded.tag_track_gain_db,
            tag_track_peak = excluded.tag_track_peak,
            tag_album_gain_db = excluded.tag_album_gain_db,
            tag_album_peak = excluded.tag_album_peak,
            tag_r128_track_gain_db = excluded.tag_r128_track_gain_db,
            tag_r128_album_gain_db = excluded.tag_r128_album_gain_db,
            file_size = excluded.file_size,
            file_modified_at = excluded.file_modified_at,
            scan_source = excluded.scan_source,
            analyzer_name = excluded.analyzer_name,
            analyzer_version = excluded.analyzer_version,
            scan_status = excluded.scan_status,
            scanned_at = excluded.scanned_at,
            error_message = excluded.error_message",
        params![
            record.song_id,
            record.song_path,
            record.loudness_lufs,
            record.estimated_loudness_lufs,
            record.sample_peak,
            record.true_peak,
            record.tag_track_gain_db,
            record.tag_track_peak,
            record.tag_album_gain_db,
            record.tag_album_peak,
            record.tag_r128_track_gain_db,
            record.tag_r128_album_gain_db,
            record.file_size,
            record.file_modified_at,
            record.scan_source,
            record.analyzer_name,
            record.analyzer_version,
            record.scan_status,
            record.scanned_at,
            record.error_message,
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

/// 快速将一首歌标记为待扫描意图 `'pending'` 写入数据库
pub fn create_pending_loudness_record(
    conn: &Connection,
    song_id: i64,
    song_path: &str,
    file_size: i64,
    file_modified_at: i64,
) -> Result<(), String> {
    conn.execute(
        "INSERT INTO song_loudness (
            song_id, song_path, file_size, file_modified_at, scan_source, scan_status
         ) VALUES (?1, ?2, ?3, ?4, 'none', 'pending')
         ON CONFLICT(song_id) DO UPDATE SET
            song_path = excluded.song_path,
            file_size = excluded.file_size,
            file_modified_at = excluded.file_modified_at,
            scan_source = 'none',
            scan_status = 'pending'",
        params![song_id, song_path, file_size, file_modified_at],
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

// =========================================================================
// 5. ReplayGain 音量增益与防削波动态计算
// =========================================================================

/// 为播放引擎动态计算实际需应用的 Linear Gain 倍数
pub fn calculate_playback_gain(
    record: &LoudnessRecord,
    gain_offset_db: f32,
    prevent_clipping: bool,
) -> f32 {
    let mut gain_db = 0.0;
    let mut has_lufs_reference = false;

    // 1. 如果有客观分析的 loudness_lufs，优先计算
    if let Some(lufs) = record.loudness_lufs {
        gain_db = (-18.0 + gain_offset_db) - lufs as f32;
        has_lufs_reference = true;
    }
    // 2. 否则，使用 ReplayGain 标签计算，并叠加用户设置的整体 dB 偏移。
    else if let Some(tag_gain) = record.tag_track_gain_db {
        gain_db = tag_gain as f32 + gain_offset_db;
        has_lufs_reference = true;
    }

    if !has_lufs_reference {
        return 1.0; // 降级策略：原始音量播放
    }

    let mut linear_gain = 10.0_f32.powf(gain_db / 20.0);

    // 3. 破音保护逻辑 (Clipping Prevention)
    if prevent_clipping {
        // 读取 Peak 指标
        let peak = record.sample_peak.or(record.tag_track_peak);

        match peak {
            Some(p) => {
                let p_f32 = p as f32;
                if linear_gain * p_f32 > 0.98 {
                    let safe_linear_gain = 0.98 / p_f32;
                    linear_gain = safe_linear_gain;
                }
            }
            None => {
                // 降级兜底防削波：开启了防削波且缺失 peak 时，不应用任何正增益，增益上限直接压平在 0 dB
                if gain_db > 0.0 {
                    linear_gain = 1.0; // 限制增益最高为 0 dB (即线性系数 1.0，只减不增)
                }
            }
        }
    }

    linear_gain
}

/// 尝试在一首歌起播时提取标签，有标签则应用并存入 SQLite，无标签则只做 pending 意图标记
pub fn process_song_on_play(
    conn: &Connection,
    song_id: i64,
    song_path: &str,
) -> Result<LoudnessRecord, String> {
    let path = Path::new(song_path);
    let metadata = fs::metadata(path).map_err(|e| e.to_string())?;
    let file_size = metadata.len() as i64;
    let file_modified_at = metadata
        .modified()
        .map_err(|e| e.to_string())?
        .duration_since(UNIX_EPOCH)
        .map_err(|e| e.to_string())?
        .as_secs() as i64;

    // 1. 先查数据库
    if let Ok(Some(cached)) = get_song_loudness_record(conn, song_id) {
        // 如果文件未发生改变，直接使用
        if cached.file_size == file_size && cached.file_modified_at == file_modified_at {
            return Ok(cached);
        }
    }

    // 2. 文件是新添加或发生变化，快速仅提取内置标签 (容错耗时低)
    if let Some((tag_gain, tag_peak)) = extract_replaygain_from_path(path) {
        let estimated_lufs = -18.0 - tag_gain;
        let record = LoudnessRecord {
            song_id,
            song_path: song_path.to_string(),
            loudness_lufs: None,
            estimated_loudness_lufs: Some(estimated_lufs as f64),
            sample_peak: None,
            true_peak: None,
            tag_track_gain_db: Some(tag_gain as f64),
            tag_track_peak: tag_peak.map(|p| p as f64),
            tag_album_gain_db: None,
            tag_album_peak: None,
            tag_r128_track_gain_db: None,
            tag_r128_album_gain_db: None,
            file_size,
            file_modified_at,
            scan_source: "tag_replaygain".to_string(),
            analyzer_name: None,
            analyzer_version: 1,
            scan_status: "scanned".to_string(), // scanned + tag_replaygain = 标签成功就绪
            scanned_at: Some(
                SystemTime::now()
                    .duration_since(UNIX_EPOCH)
                    .unwrap_or_default()
                    .as_secs() as i64,
            ),
            error_message: None,
        };

        upsert_song_loudness_record(conn, &record)?;
        return Ok(record);
    }

    // 3. 完全没有内置标签，标记待扫意图 'pending'，播放以 1.0 (原始) 播放
    create_pending_loudness_record(conn, song_id, song_path, file_size, file_modified_at)?;

    let pending_record = LoudnessRecord {
        song_id,
        song_path: song_path.to_string(),
        loudness_lufs: None,
        estimated_loudness_lufs: None,
        sample_peak: None,
        true_peak: None,
        tag_track_gain_db: None,
        tag_track_peak: None,
        tag_album_gain_db: None,
        tag_album_peak: None,
        tag_r128_track_gain_db: None,
        tag_r128_album_gain_db: None,
        file_size,
        file_modified_at,
        scan_source: "none".to_string(),
        analyzer_name: None,
        analyzer_version: 1,
        scan_status: "pending".to_string(),
        scanned_at: None,
        error_message: None,
    };

    Ok(pending_record)
}
