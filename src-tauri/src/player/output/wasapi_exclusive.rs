use crate::player::equalizer::{EqualizerHandle, EqualizerSettings};
use crate::player::output::OutputError;
use crate::player::types::{SharedProgress, SharedVisualizer};
use rodio::{Decoder, Source};
use std::fs::File;
use std::io::BufReader;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::mpsc::{channel, sync_channel, Receiver, RecvTimeoutError, Sender, TryRecvError};
use std::sync::Arc;
use std::thread::{self, JoinHandle};
use std::time::Duration;

use wasapi::{
    deinitialize, initialize_mta, DeviceEnumerator, Direction, SampleType, StreamMode, WaveFormat,
};

const EXCLUSIVE_PERIOD_HNS: i64 = 200_000;
const EXCLUSIVE_BUFFER_MULTIPLIER: i64 = 4;

pub(crate) struct WasapiExclusivePlayback {
    tx: Sender<ExclusiveCommand>,
    result_rx: Receiver<Result<(), String>>,
    join_handle: Option<JoinHandle<()>>,
    active_device_name: String,
}

pub(crate) struct ExclusivePlayRequest {
    pub path: String,
    pub device_name: Option<String>,
    pub volume: f32,
    pub is_playing: bool,
    pub progress: Arc<SharedProgress>,
    pub start_time: Duration,
    pub volume_balance_gain: f32,
    pub equalizer_handle: Arc<EqualizerHandle>,
    pub user_volume: Arc<AtomicU32>,
}

enum ExclusiveCommand {
    Pause,
    Resume,
    Seek { time: Duration, is_playing: bool },
    Stop,
    SetVolumeBalance { enabled: bool, target_gain: f32 },
    SetEqualizerSettings { settings: EqualizerSettings },
}

impl WasapiExclusivePlayback {
    pub(crate) fn start(request: ExclusivePlayRequest) -> Result<Self, OutputError> {
        let (command_tx, command_rx) = channel::<ExclusiveCommand>();
        let (init_tx, init_rx) = sync_channel::<Result<String, String>>(1);
        let (result_tx, result_rx) = channel::<Result<(), String>>(); // 独占模式的退出消息类型

        let join_handle = thread::spawn(move || {
            let result = run_exclusive_playback(request, command_rx, init_tx);
            if let Err(error) = &result {
                eprintln!("WASAPI exclusive playback failed: {error}");
            }
            let _ = result_tx.send(result);
            deinitialize();
        });

        match init_rx.recv_timeout(Duration::from_secs(3)) {
            Ok(Ok(active_device_name)) => Ok(Self {
                tx: command_tx,
                result_rx,
                join_handle: Some(join_handle),
                active_device_name,
            }),
            Ok(Err(error)) => {
                let _ = command_tx.send(ExclusiveCommand::Stop);
                let _ = join_handle.join();
                Err(OutputError::Exclusive(error))
            }
            Err(RecvTimeoutError::Timeout) => {
                let _ = command_tx.send(ExclusiveCommand::Stop);
                Err(OutputError::Exclusive(format!(
                    "WASAPI exclusive initialization timed out after 3 seconds"
                )))
            }
            Err(RecvTimeoutError::Disconnected) => {
                let _ = join_handle.join();
                Err(OutputError::Exclusive(
                    "WASAPI exclusive initialization thread disconnected".to_string(),
                ))
            }
        }
    }

    pub(crate) fn active_device_name(&self) -> &str {
        &self.active_device_name
    }

    pub(crate) fn pause(&self) {
        let _ = self.tx.send(ExclusiveCommand::Pause);
    }

    pub(crate) fn resume(&self) {
        let _ = self.tx.send(ExclusiveCommand::Resume);
    }

    pub(crate) fn seek(&self, time: Duration, is_playing: bool) {
        let _ = self.tx.send(ExclusiveCommand::Seek { time, is_playing });
    }

    pub(crate) fn set_volume_balance(&self, enabled: bool, target_gain: f32) {
        let _ = self.tx.send(ExclusiveCommand::SetVolumeBalance {
            enabled,
            target_gain,
        });
    }

    pub(crate) fn set_equalizer_settings(&self, settings: EqualizerSettings) {
        let _ = self
            .tx
            .send(ExclusiveCommand::SetEqualizerSettings { settings });
    }

    pub(crate) fn stop(&mut self) {
        let _ = self.tx.send(ExclusiveCommand::Stop);
        if let Some(join_handle) = self.join_handle.take() {
            let _ = join_handle.join();
        }
    }

    pub(crate) fn try_finished(&self) -> Option<Result<(), String>> {
        match self.result_rx.try_recv() {
            Ok(result) => Some(result),
            Err(TryRecvError::Empty) => None,
            Err(TryRecvError::Disconnected) => Some(Err(
                "WASAPI exclusive playback thread disconnected".to_string(),
            )),
        }
    }
}

impl Drop for WasapiExclusivePlayback {
    fn drop(&mut self) {
        self.stop();
    }
}

struct ExclusiveSource {
    source: Box<dyn Source<Item = f32> + Send>,
    progress: Arc<SharedProgress>,
    visualizer: Arc<SharedVisualizer>,
    channels: u16,
    channel_sum: f32,
    channel_samples: u16,
    normalizer_handle: crate::player::loudness::VolumeNormalizerHandle,
}

#[derive(Clone, Copy)]
enum ExclusiveSampleFormat {
    Float32,
    Int32,
    Int32Valid24,
    Int24,
    Int16,
}

struct ExclusiveOutputFormat {
    wave_format: WaveFormat,
    sample_format: ExclusiveSampleFormat,
    bytes_per_frame: usize,
}

impl ExclusiveSource {
    fn open(
        path: &str,
        start_time: Duration,
        progress: Arc<SharedProgress>,
        volume_balance_gain: f32,
        equalizer_handle: Arc<EqualizerHandle>,
        user_volume: Arc<AtomicU32>,
    ) -> Result<(Self, u32, u16), String> {
        let file = File::open(path).map_err(|error| error.to_string())?;
        let reader = BufReader::with_capacity(512 * 1024, file);
        let decoder = Decoder::new(reader).map_err(|error| error.to_string())?;
        let sample_rate = decoder.sample_rate();
        let channels = decoder.channels();
        let samples_at_target =
            (start_time.as_secs_f64() * sample_rate as f64 * channels as f64).round() as u64;

        progress.sample_rate.store(sample_rate, Ordering::Relaxed);
        progress.channels.store(channels as u32, Ordering::Relaxed);
        progress
            .samples_played
            .store(samples_at_target, Ordering::Relaxed);
        progress.visualizer.reset();

        // 按照管线顺序装配: Decoder -> VolumeNormalizer -> Equalizer -> UserVolumeSource -> ClipGuardSource
        let decoded = decoder.convert_samples::<f32>().skip_duration(start_time);
        let (normalized, normalizer_handle) = crate::player::loudness::VolumeNormalizer::new(
            decoded,
            volume_balance_gain,
            100, // ramp 100ms
        );
        let eq_source = crate::player::equalizer::Equalizer::new(normalized, equalizer_handle);
        let vol_source = crate::player::equalizer::UserVolumeSource::new(eq_source, user_volume);
        let clip_source = crate::player::equalizer::ClipGuardSource::new(vol_source);

        Ok((
            Self {
                source: Box::new(clip_source),
                visualizer: progress.visualizer.clone(),
                progress,
                channels,
                channel_sum: 0.0,
                channel_samples: 0,
                normalizer_handle,
            },
            sample_rate,
            channels,
        ))
    }

    fn read_frames_into(
        &mut self,
        frame_count: usize,
        sample_format: ExclusiveSampleFormat,
        output: &mut Vec<u8>,
    ) -> bool {
        let mut ended = false;
        output.clear();

        for _ in 0..frame_count {
            for _ in 0..self.channels {
                let sample = match self.source.next() {
                    Some(sample) => {
                        self.progress.samples_played.fetch_add(1, Ordering::Relaxed);
                        self.channel_sum += sample;
                        self.channel_samples += 1;

                        if self.channel_samples >= self.channels {
                            self.visualizer
                                .push_sample(self.channel_sum / self.channel_samples as f32);
                            self.channel_sum = 0.0;
                            self.channel_samples = 0;
                        }

                        sample
                    }
                    None => {
                        ended = true;
                        0.0
                    }
                };

                // 音量平衡（VolumeNormalizer）已被移至管线最前端，
                // 在这里我们无需再做任何额外乘以 volume_balance_gain 的操作，直接将样本安全写入 WASAPI
                push_sample_bytes(output, sample, sample_format);
            }
        }

        ended
    }
}

fn push_sample_bytes(output: &mut Vec<u8>, sample: f32, sample_format: ExclusiveSampleFormat) {
    let sample = sample.clamp(-1.0, 1.0);

    match sample_format {
        ExclusiveSampleFormat::Float32 => output.extend_from_slice(&sample.to_le_bytes()),
        ExclusiveSampleFormat::Int32 => {
            let value = (sample * i32::MAX as f32).round() as i32;
            output.extend_from_slice(&value.to_le_bytes());
        }
        ExclusiveSampleFormat::Int32Valid24 => {
            let value = ((sample * 8_388_607.0).round() as i32) << 8;
            output.extend_from_slice(&value.to_le_bytes());
        }
        ExclusiveSampleFormat::Int24 => {
            let value = (sample * 8_388_607.0).round() as i32;
            output.extend_from_slice(&value.to_le_bytes()[..3]);
        }
        ExclusiveSampleFormat::Int16 => {
            let value = (sample * i16::MAX as f32).round() as i16;
            output.extend_from_slice(&value.to_le_bytes());
        }
    }
}

fn exclusive_format_candidates() -> [(usize, usize, SampleType, ExclusiveSampleFormat); 5] {
    [
        (32, 32, SampleType::Float, ExclusiveSampleFormat::Float32),
        (32, 24, SampleType::Int, ExclusiveSampleFormat::Int32Valid24),
        (24, 24, SampleType::Int, ExclusiveSampleFormat::Int24),
        (32, 32, SampleType::Int, ExclusiveSampleFormat::Int32),
        (16, 16, SampleType::Int, ExclusiveSampleFormat::Int16),
    ]
}

fn negotiate_exclusive_format(
    audio_client: &wasapi::AudioClient,
    sample_rate: u32,
    channels: u16,
) -> Result<ExclusiveOutputFormat, String> {
    for (store_bits, valid_bits, sample_type, sample_format) in exclusive_format_candidates() {
        let requested_format = WaveFormat::new(
            store_bits,
            valid_bits,
            &sample_type,
            sample_rate as usize,
            channels as usize,
            None,
        );

        if let Ok(wave_format) = audio_client.is_supported_exclusive_with_quirks(&requested_format)
        {
            return Ok(ExclusiveOutputFormat {
                bytes_per_frame: wave_format.get_blockalign() as usize,
                wave_format,
                sample_format,
            });
        }
    }

    Err(format!(
        "Unsupported WASAPI exclusive format: {sample_rate} Hz, {channels} channels"
    ))
}

fn run_exclusive_playback(
    request: ExclusivePlayRequest,
    command_rx: Receiver<ExclusiveCommand>,
    init_tx: std::sync::mpsc::SyncSender<Result<String, String>>,
) -> Result<(), String> {
    initialize_mta()
        .ok()
        .map_err(|error| format!("COM initialization failed: {error}"))?;

    // 初始化主音量原子浮点数快照
    request
        .user_volume
        .store(request.volume.to_bits(), Ordering::Relaxed);

    let mut current_volume_balance_gain = request.volume_balance_gain;
    let (mut source, sample_rate, channels) = ExclusiveSource::open(
        &request.path,
        request.start_time,
        request.progress.clone(),
        current_volume_balance_gain,
        request.equalizer_handle.clone(),
        request.user_volume.clone(),
    )?;

    let enumerator = DeviceEnumerator::new().map_err(|error| error.to_string())?;
    let device = if let Some(name) = request.device_name.as_deref() {
        let collection = enumerator
            .get_device_collection(&Direction::Render)
            .map_err(|error| error.to_string())?;
        collection
            .get_device_with_name(name)
            .map_err(|error| error.to_string())?
    } else {
        enumerator
            .get_default_device(&Direction::Render)
            .map_err(|error| error.to_string())?
    };
    let active_device_name = device
        .get_friendlyname()
        .map_err(|error| error.to_string())?;
    let mut audio_client = device
        .get_iaudioclient()
        .map_err(|error| error.to_string())?;
    let exclusive_format = negotiate_exclusive_format(&audio_client, sample_rate, channels)?;
    let period_hns = audio_client
        .calculate_aligned_period_near(
            EXCLUSIVE_PERIOD_HNS,
            Some(128),
            &exclusive_format.wave_format,
        )
        .unwrap_or(EXCLUSIVE_PERIOD_HNS);
    let mode = StreamMode::PollingExclusive {
        buffer_duration_hns: period_hns * EXCLUSIVE_BUFFER_MULTIPLIER,
        period_hns,
    };

    audio_client
        .initialize_client(&exclusive_format.wave_format, &Direction::Render, &mode)
        .map_err(|error| error.to_string())?;
    let render_client = audio_client
        .get_audiorenderclient()
        .map_err(|error| error.to_string())?;
    let buffer_size = audio_client
        .get_buffer_size()
        .map_err(|error| error.to_string())? as usize;

    let mut write_buffer =
        Vec::with_capacity(buffer_size.saturating_mul(exclusive_format.bytes_per_frame));
    let _ = source.read_frames_into(
        buffer_size,
        exclusive_format.sample_format,
        &mut write_buffer,
    );
    render_client
        .write_to_device(buffer_size, &write_buffer, None)
        .map_err(|error| error.to_string())?;

    if request.is_playing {
        audio_client
            .start_stream()
            .map_err(|error| error.to_string())?;
    }

    let _ = init_tx.send(Ok(active_device_name));

    let mut is_playing = request.is_playing;

    loop {
        while let Ok(command) = command_rx.try_recv() {
            match command {
                ExclusiveCommand::Pause => {
                    if is_playing {
                        let _ = audio_client.stop_stream();
                    }
                    is_playing = false;
                }
                ExclusiveCommand::Resume => {
                    if !is_playing {
                        audio_client
                            .start_stream()
                            .map_err(|error| error.to_string())?;
                    }
                    is_playing = true;
                }
                ExclusiveCommand::Seek {
                    time,
                    is_playing: next_playing,
                } => {
                    if is_playing {
                        let _ = audio_client.stop_stream();
                    }
                    audio_client
                        .reset_stream()
                        .map_err(|error| error.to_string())?;
                    source = ExclusiveSource::open(
                        &request.path,
                        time,
                        request.progress.clone(),
                        current_volume_balance_gain,
                        request.equalizer_handle.clone(),
                        request.user_volume.clone(),
                    )?
                    .0;
                    let _ = source.read_frames_into(
                        buffer_size,
                        exclusive_format.sample_format,
                        &mut write_buffer,
                    );
                    render_client
                        .write_to_device(buffer_size, &write_buffer, None)
                        .map_err(|error| error.to_string())?;
                    if next_playing {
                        audio_client
                            .start_stream()
                            .map_err(|error| error.to_string())?;
                    }
                    is_playing = next_playing;
                }
                ExclusiveCommand::Stop => {
                    let _ = audio_client.stop_stream();
                    let _ = audio_client.reset_stream();
                    return Ok(());
                }
                ExclusiveCommand::SetVolumeBalance {
                    enabled,
                    target_gain,
                } => {
                    let next_gain = if enabled { target_gain } else { 1.0 };
                    current_volume_balance_gain = next_gain;
                    source.normalizer_handle.set_target_gain(next_gain);
                }
                ExclusiveCommand::SetEqualizerSettings { settings } => {
                    request.equalizer_handle.set_settings(settings);
                }
            }
        }

        if !is_playing {
            thread::sleep(Duration::from_millis(20));
            continue;
        }

        let available_frames = audio_client
            .get_available_space_in_frames()
            .map_err(|error| error.to_string())? as usize;
        if available_frames == 0 {
            thread::sleep(Duration::from_millis(5));
            continue;
        }

        let ended = source.read_frames_into(
            available_frames,
            exclusive_format.sample_format,
            &mut write_buffer,
        );
        render_client
            .write_to_device(available_frames, &write_buffer, None)
            .map_err(|error| error.to_string())?;

        if ended {
            let _ = audio_client.stop_stream();
            return Ok(());
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn int32_valid24_samples_are_left_aligned_in_32_bit_container() {
        let mut output = Vec::new();

        push_sample_bytes(&mut output, 0.5, ExclusiveSampleFormat::Int32Valid24);

        assert_eq!(output, vec![0x00, 0x00, 0x00, 0x40]);
    }

    #[test]
    fn format_candidates_prefer_32_bit_container_with_24_valid_bits() {
        let candidates = exclusive_format_candidates();

        assert_eq!(candidates[1].0, 32);
        assert_eq!(candidates[1].1, 24);
        assert!(matches!(
            candidates[1].3,
            ExclusiveSampleFormat::Int32Valid24
        ));
    }
}
