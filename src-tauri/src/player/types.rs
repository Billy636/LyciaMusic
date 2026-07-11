use crate::player::equalizer::EqualizerSettings;
use rodio::source::SeekError;
use rodio::Source;
use serde::{Deserialize, Serialize};
use souvlaki::MediaControls;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const VISUALIZER_BAND_COUNT: usize = 48;
pub const VISUALIZER_WINDOW_SIZE: usize = 2048;

fn relative_media_seconds(absolute_seconds: f64, cue_start_offset_ms: u64) -> f64 {
    let cue_offset_seconds = cue_start_offset_ms as f64 / 1000.0;
    (absolute_seconds - cue_offset_seconds).max(0.0)
}

pub struct SharedVisualizer {
    samples: Vec<AtomicU32>,
    pub cursor: AtomicU64,
    generation: AtomicU64,
    enabled: AtomicBool,
}

impl SharedVisualizer {
    pub fn new() -> Self {
        Self {
            samples: (0..VISUALIZER_WINDOW_SIZE)
                .map(|_| AtomicU32::new(0))
                .collect(),
            cursor: AtomicU64::new(0),
            generation: AtomicU64::new(0),
            enabled: AtomicBool::new(false),
        }
    }

    fn clear_samples(&self) {
        for sample in &self.samples {
            sample.store(0.0_f32.to_bits(), Ordering::Relaxed);
        }
    }

    fn reset_cursor(&self) {
        self.cursor.store(0, Ordering::Relaxed);
        self.generation.fetch_add(1, Ordering::Relaxed);
    }

    pub fn reset(&self) {
        if self.is_enabled() {
            self.clear_samples();
        }
        self.reset_cursor();
    }

    pub fn set_enabled(&self, enabled: bool) {
        if self.enabled.load(Ordering::Relaxed) == enabled {
            return;
        }

        if enabled {
            self.clear_samples();
            self.reset_cursor();
            self.enabled.store(true, Ordering::Relaxed);
        } else {
            self.enabled.store(false, Ordering::Relaxed);
            self.reset_cursor();
        }
    }

    pub fn is_enabled(&self) -> bool {
        self.enabled.load(Ordering::Relaxed)
    }

    pub fn generation(&self) -> u64 {
        self.generation.load(Ordering::Relaxed)
    }

    pub fn push_sample(&self, sample: f32) {
        if !self.is_enabled() {
            return;
        }
        let cursor = self.cursor.fetch_add(1, Ordering::Relaxed) as usize;
        self.samples[cursor % VISUALIZER_WINDOW_SIZE]
            .store(sample.clamp(-1.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    pub fn snapshot_into(&self, output: &mut [f32]) -> (u64, u64) {
        let cursor = self.cursor.load(Ordering::Relaxed) as usize;
        let generation = self.generation();
        let window_size = output.len().min(VISUALIZER_WINDOW_SIZE);
        let written = cursor.min(window_size);
        let empty = window_size - written;
        output.fill(0.0);

        for logical_position in 0..written {
            let index = if cursor < VISUALIZER_WINDOW_SIZE {
                logical_position
            } else {
                (cursor + logical_position) % VISUALIZER_WINDOW_SIZE
            };
            output[empty + logical_position] =
                f32::from_bits(self.samples[index].load(Ordering::Relaxed));
        }

        (generation, cursor as u64)
    }
}

pub struct TimedSource<S> {
    pub inner: S,
    pub samples_played: Arc<AtomicU64>,
    pub visualizer: Arc<SharedVisualizer>,
    channel_sum: f32,
    channel_samples: u16,
    visualizer_enabled_for_frame: bool,
}

impl<S> TimedSource<S>
where
    S: Source<Item = f32>,
{
    pub fn new(
        inner: S,
        samples_played: Arc<AtomicU64>,
        visualizer: Arc<SharedVisualizer>,
    ) -> Self {
        Self {
            inner,
            samples_played,
            visualizer,
            channel_sum: 0.0,
            channel_samples: 0,
            visualizer_enabled_for_frame: false,
        }
    }
}

impl<S> Iterator for TimedSource<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next();
        if let Some(value) = sample {
            self.samples_played.fetch_add(1, Ordering::Relaxed);
            if self.channel_samples == 0 {
                self.visualizer_enabled_for_frame = self.visualizer.is_enabled();
            }
            if self.visualizer_enabled_for_frame {
                self.channel_sum += value;
            }
            self.channel_samples += 1;

            if self.channel_samples >= self.channels() {
                if self.visualizer_enabled_for_frame {
                    self.visualizer
                        .push_sample(self.channel_sum / self.channel_samples as f32);
                }
                self.channel_sum = 0.0;
                self.channel_samples = 0;
            }
        }
        sample
    }
}

impl<S> Source for TimedSource<S>
where
    S: Source<Item = f32>,
{
    fn channels(&self) -> u16 {
        self.inner.channels()
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len()
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.inner.try_seek(pos)
    }
}

pub struct SharedProgress {
    pub samples_played: Arc<AtomicU64>,
    pub sample_rate: Arc<AtomicU32>,
    pub channels: Arc<AtomicU32>,
    pub cue_start_offset_ms: AtomicU64,
    pub visualizer: Arc<SharedVisualizer>,
}

impl SharedProgress {
    pub fn absolute_seconds(&self) -> f64 {
        let samples = self.samples_played.load(Ordering::Relaxed);
        let rate = self.sample_rate.load(Ordering::Relaxed);
        let channels = self.channels.load(Ordering::Relaxed);

        if rate == 0 || channels == 0 {
            return 0.0;
        }

        samples as f64 / (rate as f64 * channels as f64)
    }

    pub fn media_seconds_from_absolute(&self, absolute_seconds: f64) -> f64 {
        relative_media_seconds(
            absolute_seconds,
            self.cue_start_offset_ms.load(Ordering::Relaxed),
        )
    }

    pub fn media_seconds(&self) -> f64 {
        self.media_seconds_from_absolute(self.absolute_seconds())
    }
}

#[cfg(test)]
mod shared_progress_tests {
    use super::{relative_media_seconds, SharedVisualizer, TimedSource};
    use rodio::buffer::SamplesBuffer;
    use std::sync::atomic::{AtomicU64, Ordering};
    use std::sync::Arc;

    #[test]
    fn converts_absolute_cue_position_to_track_position() {
        assert_eq!(relative_media_seconds(73.5, 60_000), 13.5);
    }

    #[test]
    fn clamps_positions_before_cue_start_to_zero() {
        assert_eq!(relative_media_seconds(59.0, 60_000), 0.0);
    }

    #[test]
    fn leaves_regular_track_position_unchanged() {
        assert_eq!(relative_media_seconds(13.5, 0), 13.5);
    }

    #[test]
    fn disabled_visualizer_skips_samples_and_resets_when_hidden() {
        let visualizer = SharedVisualizer::new();
        visualizer.push_sample(0.5);
        assert_eq!(visualizer.cursor.load(Ordering::Relaxed), 0);

        visualizer.set_enabled(true);
        visualizer.push_sample(0.5);
        assert_eq!(visualizer.cursor.load(Ordering::Relaxed), 1);

        visualizer.set_enabled(false);
        assert_eq!(visualizer.cursor.load(Ordering::Relaxed), 0);
    }

    #[test]
    fn timed_source_keeps_progress_counting_while_visualizer_is_disabled() {
        let samples_played = Arc::new(AtomicU64::new(0));
        let visualizer = Arc::new(SharedVisualizer::new());
        let source = SamplesBuffer::new(2, 44_100, vec![0.1_f32, 0.2, 0.3, 0.4]);
        let output = TimedSource::new(source, samples_played.clone(), visualizer.clone())
            .collect::<Vec<_>>();

        assert_eq!(output.len(), 4);
        assert_eq!(samples_played.load(Ordering::Relaxed), 4);
        assert_eq!(visualizer.cursor.load(Ordering::Relaxed), 0);
    }
}

pub enum AudioCommand {
    Play {
        source: AudioSource,
        output_mode: AudioOutputMode,
        start_offset_ms: Option<u64>,
        volume_balance_gain: f32,
        duration_ms: Option<u64>,
        cue_start_offset_ms: Option<u64>,
        playback_id: u64,
    },
    Pause,
    Stop,
    Resume,
    Seek {
        time: f64,
        is_playing: bool,
        request_id: u64,
    },
    SetVolume(f32),
    SetVolumeBalance {
        enabled: bool,
        target_gain: f32,
    },
    SetEqualizerSettings {
        settings: EqualizerSettings,
    },
    SetDevice(Option<String>),
    SetOutputMode(AudioOutputMode),
}

#[derive(Clone, Debug)]
pub enum AudioSource {
    LocalFile(String),
    RemoteWebDav(crate::remote::cache::RemoteStreamSource),
}

impl AudioSource {
    pub fn display_path(&self) -> String {
        match self {
            AudioSource::LocalFile(path) => path.clone(),
            AudioSource::RemoteWebDav(source) => source.remote_uri.clone(),
        }
    }

    pub fn is_remote(&self) -> bool {
        matches!(self, AudioSource::RemoteWebDav(_))
    }
}

pub struct PlayerState {
    pub tx: Mutex<Sender<AudioCommand>>,
    pub progress: Arc<SharedProgress>,
    pub playback_id: Arc<AtomicU64>,
    pub controls: Arc<Mutex<Option<MediaControls>>>,
    pub output_status: Arc<Mutex<AudioOutputStatus>>,
    pub visualizer_analysis: Mutex<crate::player::spectrum::SpectrumAnalyzer>,
}

#[derive(Serialize, Clone)]
pub struct AudioDevice {
    pub id: String,
    pub name: String,
}

#[derive(Serialize, Clone, Default)]
pub struct AudioOutputStatus {
    pub selected_device_id: Option<String>,
    pub active_device_name: Option<String>,
    pub follows_system_default: bool,
    pub requested_output_mode: AudioOutputMode,
    pub active_output_mode: AudioOutputMode,
    pub fallback_reason: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Copy, Debug, Eq, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub enum AudioOutputMode {
    #[default]
    Shared,
    WasapiExclusive,
}

#[derive(Serialize, Clone)]
pub(crate) struct SeekCompletedPayload {
    pub request_id: u64,
    pub time: f64,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct PlaybackFinishedPayload {
    pub playback_id: u64,
}
