use crate::player::types::SharedVisualizer;
use rustfft::num_complex::Complex;
use rustfft::{Fft, FftPlanner};
use std::sync::{Arc, OnceLock};

const MIN_VISUALIZER_FREQUENCY_HZ: f32 = 40.0;
const MAX_VISUALIZER_FREQUENCY_HZ: f32 = 16_000.0;
const CACHED_FFT_SIZE: usize = 2048;

static FFT_2048: OnceLock<Arc<dyn Fft<f32>>> = OnceLock::new();

fn plan_fft(sample_count: usize) -> Arc<dyn Fft<f32>> {
    if sample_count == CACHED_FFT_SIZE {
        return FFT_2048
            .get_or_init(|| {
                let mut planner = FftPlanner::<f32>::new();
                planner.plan_fft_forward(CACHED_FFT_SIZE)
            })
            .clone();
    }

    let mut planner = FftPlanner::<f32>::new();
    planner.plan_fft_forward(sample_count)
}

pub struct SpectrumAnalyzer {
    samples: Vec<f32>,
    fft_buffer: Vec<Complex<f32>>,
    bands: Vec<f32>,
    fft: Arc<dyn Fft<f32>>,
    last_generation: u64,
    last_cursor: u64,
    last_sample_rate: u32,
    has_cached_result: bool,
}

impl SpectrumAnalyzer {
    pub fn new(sample_count: usize, band_count: usize) -> Self {
        Self {
            samples: vec![0.0; sample_count],
            fft_buffer: vec![Complex::new(0.0, 0.0); sample_count],
            bands: vec![0.0; band_count],
            fft: plan_fft(sample_count),
            last_generation: 0,
            last_cursor: 0,
            last_sample_rate: 0,
            has_cached_result: false,
        }
    }

    pub fn bands_for(&mut self, visualizer: &SharedVisualizer, sample_rate: u32) -> &[f32] {
        if !visualizer.is_enabled() || sample_rate == 0 {
            self.bands.fill(0.0);
            self.has_cached_result = false;
            return &self.bands;
        }

        let generation = visualizer.generation();
        let cursor = visualizer.cursor.load(std::sync::atomic::Ordering::Relaxed);
        if self.has_cached_result
            && self.last_generation == generation
            && self.last_cursor == cursor
            && self.last_sample_rate == sample_rate
        {
            return &self.bands;
        }

        let (snapshot_generation, snapshot_cursor) = visualizer.snapshot_into(&mut self.samples);
        build_frequency_bands_into(
            &self.samples,
            sample_rate,
            &mut self.bands,
            &mut self.fft_buffer,
            &self.fft,
        );
        self.last_generation = snapshot_generation;
        self.last_cursor = snapshot_cursor;
        self.last_sample_rate = sample_rate;
        self.has_cached_result = true;
        &self.bands
    }

    #[cfg(test)]
    fn process_samples(&mut self, samples: &[f32], sample_rate: u32) -> &[f32] {
        build_frequency_bands_into(
            samples,
            sample_rate,
            &mut self.bands,
            &mut self.fft_buffer,
            &self.fft,
        );
        &self.bands
    }
}

fn build_frequency_bands_into(
    samples: &[f32],
    sample_rate: u32,
    bands: &mut [f32],
    fft_buffer: &mut [Complex<f32>],
    fft: &Arc<dyn Fft<f32>>,
) {
    bands.fill(0.0);
    if bands.is_empty()
        || samples.is_empty()
        || sample_rate == 0
        || samples.len() != fft_buffer.len()
    {
        return;
    }

    let sample_len = samples.len() as f32;
    for (index, (sample, output)) in samples.iter().zip(fft_buffer.iter_mut()).enumerate() {
        let window = 0.5 - 0.5 * (std::f32::consts::TAU * index as f32 / sample_len).cos();
        *output = Complex::new(sample.clamp(-1.0, 1.0) * window, 0.0);
    }

    fft.process(fft_buffer);

    let max_frequency = ((sample_rate as f32) * 0.5).min(MAX_VISUALIZER_FREQUENCY_HZ);
    if max_frequency <= MIN_VISUALIZER_FREQUENCY_HZ {
        return;
    }

    let half_len = samples.len() / 2;
    let magnitude_scale = samples.len() as f32 * 0.25;
    let band_count = bands.len();

    for (band, output) in bands.iter_mut().enumerate() {
        let start_ratio = band as f32 / band_count as f32;
        let end_ratio = (band + 1) as f32 / band_count as f32;
        let start_frequency = MIN_VISUALIZER_FREQUENCY_HZ
            + (max_frequency - MIN_VISUALIZER_FREQUENCY_HZ) * start_ratio.powi(2);
        let end_frequency = MIN_VISUALIZER_FREQUENCY_HZ
            + (max_frequency - MIN_VISUALIZER_FREQUENCY_HZ) * end_ratio.powi(2);
        let start_bin = ((start_frequency * samples.len() as f32) / sample_rate as f32)
            .floor()
            .max(1.0) as usize;
        let end_bin = ((end_frequency * samples.len() as f32) / sample_rate as f32)
            .ceil()
            .max((start_bin + 1) as f32) as usize;
        let capped_end = end_bin.min(half_len);

        if start_bin >= capped_end {
            continue;
        }

        let peak = fft_buffer[start_bin..capped_end]
            .iter()
            .map(|value| value.norm() / magnitude_scale)
            .fold(0.0_f32, f32::max);
        *output = peak.powf(0.55).min(1.0);
    }
}

#[cfg(test)]
fn build_frequency_bands(samples: &[f32], sample_rate: u32, band_count: usize) -> Vec<f32> {
    if band_count == 0 {
        return Vec::new();
    }

    if samples.is_empty() {
        return vec![0.0; band_count];
    }

    let mut analyzer = SpectrumAnalyzer::new(samples.len(), band_count);
    analyzer.process_samples(samples, sample_rate).to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sine_wave(frequency_hz: f32, sample_rate: u32, sample_count: usize) -> Vec<f32> {
        (0..sample_count)
            .map(|index| {
                let phase =
                    index as f32 * frequency_hz * std::f32::consts::TAU / sample_rate as f32;
                phase.sin()
            })
            .collect()
    }

    #[test]
    fn silent_frame_outputs_zero_bands() {
        let bands = build_frequency_bands(&vec![0.0; 2048], 44_100, 32);

        assert_eq!(bands.len(), 32);
        assert!(bands.iter().all(|level| *level == 0.0));
    }

    #[test]
    fn sine_wave_energy_lands_in_expected_band() {
        let sample_rate = 44_100;
        let bands = build_frequency_bands(&sine_wave(440.0, sample_rate, 2048), sample_rate, 32);
        let peak_index = bands
            .iter()
            .enumerate()
            .max_by(|(_, left), (_, right)| left.total_cmp(right))
            .map(|(index, _)| index)
            .unwrap();

        assert!(
            (3..=6).contains(&peak_index),
            "peak_index={peak_index}, bands={bands:?}"
        );
        assert!(bands[peak_index] > 0.35, "peak={}", bands[peak_index]);
    }

    #[test]
    fn analyzer_returns_zero_bands_while_visualizer_is_disabled() {
        let visualizer = SharedVisualizer::new();
        let mut analyzer = SpectrumAnalyzer::new(2048, 48);

        assert!(analyzer
            .bands_for(&visualizer, 44_100)
            .iter()
            .all(|level| *level == 0.0));
    }
}
