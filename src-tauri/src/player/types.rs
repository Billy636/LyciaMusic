use crate::player::equalizer::EqualizerSettings;
use rodio::source::SeekError;
use rodio::Source;
use serde::{Deserialize, Serialize};
use souvlaki::MediaControls;
use std::sync::atomic::{AtomicU32, AtomicU64, Ordering};
use std::sync::mpsc::Sender;
use std::sync::{Arc, Mutex};
use std::time::Duration;

pub const VISUALIZER_BAND_COUNT: usize = 48;
pub const VISUALIZER_WINDOW_SIZE: usize = 2048;

pub struct SharedVisualizer {
    samples: Vec<AtomicU32>,
    pub cursor: AtomicU64,
}

impl SharedVisualizer {
    pub fn new() -> Self {
        Self {
            samples: (0..VISUALIZER_WINDOW_SIZE)
                .map(|_| AtomicU32::new(0))
                .collect(),
            cursor: AtomicU64::new(0),
        }
    }

    pub fn reset(&self) {
        for sample in &self.samples {
            sample.store(0.0_f32.to_bits(), Ordering::Relaxed);
        }
        self.cursor.store(0, Ordering::Relaxed);
    }

    pub fn push_sample(&self, sample: f32) {
        let cursor = self.cursor.fetch_add(1, Ordering::Relaxed) as usize;
        self.samples[cursor % VISUALIZER_WINDOW_SIZE]
            .store(sample.clamp(-1.0, 1.0).to_bits(), Ordering::Relaxed);
    }

    pub fn snapshot(&self) -> Vec<f32> {
        let cursor = self.cursor.load(Ordering::Relaxed) as usize;
        let written = cursor.min(VISUALIZER_WINDOW_SIZE);
        let empty = VISUALIZER_WINDOW_SIZE - written;
        let mut output = Vec::with_capacity(VISUALIZER_WINDOW_SIZE);

        output.extend(std::iter::repeat(0.0).take(empty));

        for logical_position in 0..written {
            let index = if cursor < VISUALIZER_WINDOW_SIZE {
                logical_position
            } else {
                (cursor + logical_position) % VISUALIZER_WINDOW_SIZE
            };
            output.push(f32::from_bits(self.samples[index].load(Ordering::Relaxed)));
        }

        output
    }
}

pub struct TimedSource<S> {
    pub inner: S,
    pub samples_played: Arc<AtomicU64>,
    pub visualizer: Arc<SharedVisualizer>,
    channel_sum: f32,
    channel_samples: u16,
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
            self.channel_sum += value;
            self.channel_samples += 1;

            if self.channel_samples >= self.channels() {
                self.visualizer
                    .push_sample(self.channel_sum / self.channel_samples as f32);
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
    pub visualizer: Arc<SharedVisualizer>,
}

pub enum AudioCommand {
    Play {
        source: AudioSource,
        output_mode: AudioOutputMode,
        start_offset_ms: Option<u64>,
        volume_balance_gain: f32,
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
