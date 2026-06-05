use rodio::source::SeekError;
use rodio::Source;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

// 精确的 10 段中心频率表 (Hz)
pub const BANDS: [f32; 10] = [
    31.25, 62.5, 125.0, 250.0, 500.0, 1000.0, 2000.0, 4000.0, 8000.0, 16000.0,
];

#[derive(Clone, Debug, PartialEq)]
pub struct EqualizerSettings {
    pub enabled: bool,
    pub preamp: f32,      // preamp 增益 (dB)
    pub gains: [f32; 10], // 10个频带的增益 (dB)
}

impl Default for EqualizerSettings {
    fn default() -> Self {
        Self {
            enabled: false,
            preamp: 0.0,
            gains: [0.0; 10],
        }
    }
}

pub struct EqualizerHandle {
    pub settings: Arc<Mutex<EqualizerSettings>>,
    pub dirty: Arc<AtomicBool>,
}

impl EqualizerHandle {
    pub fn new(settings: EqualizerSettings) -> Self {
        Self {
            settings: Arc::new(Mutex::new(settings)),
            dirty: Arc::new(AtomicBool::new(false)),
        }
    }

    pub fn set_settings(&self, new_settings: EqualizerSettings) {
        if let Ok(mut s) = self.settings.lock() {
            *s = new_settings;
        }
        self.dirty.store(true, Ordering::Relaxed);
    }
}

#[derive(Clone, Default)]
struct BiquadState {
    s1: f32,
    s2: f32,
}

struct BiquadFilter {
    frequency: f32,
    b0: f32,
    b1: f32,
    b2: f32,
    a1: f32,
    a2: f32,
    states: Vec<BiquadState>,
}

impl BiquadFilter {
    fn new(frequency: f32, sample_rate: f32, q: f32, gain_db: f32, channels: usize) -> Self {
        let mut filter = Self {
            frequency,
            b0: 1.0,
            b1: 0.0,
            b2: 0.0,
            a1: 0.0,
            a2: 0.0,
            states: vec![BiquadState::default(); channels],
        };
        filter.calculate_coefficients(sample_rate, q, gain_db);
        filter
    }

    fn calculate_coefficients(&mut self, sample_rate: f32, q: f32, gain_db: f32) {
        let gain_db = gain_db.clamp(-12.0, 12.0);

        // 奈奎斯特频率硬性保护
        let nyquist = sample_rate / 2.0;
        let mut target_freq = self.frequency;

        if target_freq >= nyquist - 100.0 {
            // 如果高于奈奎斯特频率，强行 clamp 到 0.45 * fs 以内
            target_freq = sample_rate * 0.45;
            // 如果 clamp 后的目标频率仍然超出奈奎斯特限制，或者太低，退化为无损直通
            if target_freq >= nyquist || target_freq <= 10.0 {
                self.b0 = 1.0;
                self.b1 = 0.0;
                self.b2 = 0.0;
                self.a1 = 0.0;
                self.a2 = 0.0;
                return;
            }
        }

        // 如果增益非常接近 0，则该滤波器完全直通，避免量化舍入噪声并提升性能
        if gain_db.abs() < 0.01 {
            self.b0 = 1.0;
            self.b1 = 0.0;
            self.b2 = 0.0;
            self.a1 = 0.0;
            self.a2 = 0.0;
            return;
        }

        let a = 10.0_f32.powf(gain_db / 40.0);
        let w0 = 2.0 * std::f32::consts::PI * target_freq / sample_rate;
        let alpha = w0.sin() / (2.0 * q);
        let cos_w0 = w0.cos();

        let b0_raw = 1.0 + alpha * a;
        let b1_raw = -2.0 * cos_w0;
        let b2_raw = 1.0 - alpha * a;
        let a0_raw = 1.0 + alpha / a;
        let a1_raw = -2.0 * cos_w0;
        let a2_raw = 1.0 - alpha / a;

        // TDF2 要求对 a0 实施归一化
        self.b0 = b0_raw / a0_raw;
        self.b1 = b1_raw / a0_raw;
        self.b2 = b2_raw / a0_raw;
        self.a1 = a1_raw / a0_raw;
        self.a2 = a2_raw / a0_raw;
    }

    #[inline]
    fn process(&mut self, sample: f32, channel_index: usize) -> f32 {
        if channel_index >= self.states.len() {
            self.states
                .resize(channel_index + 1, BiquadState::default());
        }
        let state = &mut self.states[channel_index];

        // Transposed Direct Form II (TDF2) 差分方程
        let out = self.b0 * sample + state.s1;
        state.s1 = self.b1 * sample - self.a1 * out + state.s2;
        state.s2 = self.b2 * sample - self.a2 * out;

        if !out.is_finite() {
            state.s1 = 0.0;
            state.s2 = 0.0;
            return sample;
        }
        out
    }

    fn reset_state(&mut self) {
        for state in &mut self.states {
            state.s1 = 0.0;
            state.s2 = 0.0;
        }
    }
}

pub struct Equalizer<I> {
    inner: I,
    shared_settings: Arc<Mutex<EqualizerSettings>>,

    // 音频线程专有的 target 及平滑状态，跨线程不共享
    last_target_settings: EqualizerSettings,
    current_preamp: f32,      // 当前线性的 preamp (不是 dB)
    target_preamp: f32,       // 目标线性的 preamp
    current_gains: [f32; 10], // 当前各频段增益 (dB)
    target_gains: [f32; 10],  // 目标各频段增益 (dB)

    // 渐变状态
    ramp_frames: usize,
    current_frame: usize,
    is_ramping: bool,

    // 物理 Bypass 及清空重置状态
    is_hard_bypassed: bool,
    is_fade_out_for_disable: bool,

    filters: Vec<BiquadFilter>,
    channels: u16,
    current_channel: u16,
    sample_rate: u32,

    // 非阻塞同步帧计数
    frame_counter: usize,
}

impl<I> Equalizer<I>
where
    I: Source<Item = f32>,
{
    pub fn new(inner: I, handle: Arc<EqualizerHandle>) -> Self {
        let initial_settings = if let Ok(s) = handle.settings.lock() {
            s.clone()
        } else {
            EqualizerSettings::default()
        };

        let sample_rate = inner.sample_rate();
        let channels = inner.channels();
        // 50ms 渐变周期
        let ramp_frames = ((0.05 * sample_rate as f64).round() as usize).max(1);

        let mut eq = Self {
            inner,
            shared_settings: handle.settings.clone(),
            last_target_settings: initial_settings.clone(),
            current_preamp: 1.0,
            target_preamp: 1.0,
            current_gains: [0.0; 10],
            target_gains: [0.0; 10],
            ramp_frames,
            current_frame: 0,
            is_ramping: false,
            is_hard_bypassed: true,
            is_fade_out_for_disable: false,
            filters: Vec::new(),
            channels,
            current_channel: 0,
            sample_rate,
            frame_counter: 0,
        };

        eq.initialize_parameters(&initial_settings);
        eq.rebuild_filters();
        eq
    }

    fn initialize_parameters(&mut self, settings: &EqualizerSettings) {
        if settings.enabled {
            self.target_preamp = 10.0_f32.powf(settings.preamp.clamp(-12.0, 12.0) / 20.0);
            self.target_gains = settings.gains;
            self.is_hard_bypassed = false;
            self.is_fade_out_for_disable = false;
        } else {
            self.target_preamp = 1.0;
            self.target_gains = [0.0; 10];
            self.is_hard_bypassed = true;
            self.is_fade_out_for_disable = false;
        }
        self.current_preamp = self.target_preamp;
        self.current_gains = self.target_gains;
        self.is_ramping = false;
    }

    fn rebuild_filters(&mut self) {
        self.channels = self.inner.channels();
        self.sample_rate = self.inner.sample_rate();

        // 如果处于硬 Bypass 状态，完全不需要重建或分配滤波器，保持空集合
        if self.is_hard_bypassed {
            self.filters.clear();
            return;
        }

        if self.filters.len() != BANDS.len() {
            self.filters = BANDS
                .iter()
                .map(|&freq| {
                    BiquadFilter::new(
                        freq,
                        self.sample_rate as f32,
                        1.0,
                        0.0,
                        self.channels as usize,
                    )
                })
                .collect();
        }

        for (i, filter) in self.filters.iter_mut().enumerate() {
            if filter.states.len() != self.channels as usize {
                filter
                    .states
                    .resize(self.channels as usize, BiquadState::default());
            }
            filter.calculate_coefficients(self.sample_rate as f32, 1.0, self.current_gains[i]);
        }
    }

    fn reset_all_filters(&mut self) {
        for filter in &mut self.filters {
            filter.reset_state();
        }
    }

    // 音频线程非阻塞参数读取与平滑状态检查
    fn sync_settings_nonblocking(&mut self) {
        // 每 256 个完整样本帧读取一次共享快照，防频繁 Mutex 锁碰撞
        self.frame_counter += 1;
        if self.frame_counter < 256 {
            return;
        }
        self.frame_counter = 0;

        // try_lock() 非阻塞尝试获取共享 Settings
        if let Ok(new_settings) = self.shared_settings.try_lock() {
            // 通过 new_settings != last_target_settings 结构体比对判断设置是否变化
            if *new_settings != self.last_target_settings {
                self.last_target_settings = new_settings.clone();
                self.ramp_frames = ((0.05 * self.sample_rate as f64).round() as usize).max(1);
                self.current_frame = 0;
                self.is_ramping = true;

                if new_settings.enabled {
                    self.target_preamp =
                        10.0_f32.powf(new_settings.preamp.clamp(-12.0, 12.0) / 20.0);
                    self.target_gains = new_settings.gains;
                    self.is_hard_bypassed = false;
                    self.is_fade_out_for_disable = false;
                } else {
                    // 如果被关闭，启动平滑淡出，目标暂置回 preamp=0dB, gains=0dB
                    self.target_preamp = 1.0;
                    self.target_gains = [0.0; 10];
                    self.is_fade_out_for_disable = true;
                }
            }
        }
    }

    // 渐进插值更新
    fn step_parameter_smoothing(&mut self) {
        if !self.is_ramping {
            return;
        }

        self.current_frame += 1;
        let progress = self.current_frame as f32 / self.ramp_frames as f32;

        if progress >= 1.0 {
            self.current_preamp = self.target_preamp;
            self.current_gains = self.target_gains;
            self.is_ramping = false;

            // 如果此时是执行关闭 EQ 的淡出过程，并且参数均已完全回归到中性状态
            if self.is_fade_out_for_disable {
                self.is_hard_bypassed = true;
                self.is_fade_out_for_disable = false;
                // 正式 Bypass 的瞬间，清空重置所有滤波器的状态变量，消灭残留脏数据
                self.reset_all_filters();
            }
        } else {
            // 线性平滑插值
            self.current_preamp =
                self.current_preamp + (self.target_preamp - self.current_preamp) * progress;
            for i in 0..10 {
                self.current_gains[i] = self.current_gains[i]
                    + (self.target_gains[i] - self.current_gains[i]) * progress;
            }
        }

        // 每次系数变化时，重新构建滤波器系数 (Decimated 降采样系数重算，每 32 帧对 sample 级处理也是一种平滑)
    }
}

impl<I> Iterator for Equalizer<I>
where
    I: Source<Item = f32>,
{
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;

        // 声道边界检查与校正
        if self.current_channel == 0 {
            // 在每一帧的开头做非阻塞设置同步
            self.sync_settings_nonblocking();

            // 采样率或声道数由于换轨发生瞬变时，重新初始化底层滤波器组并清空状态
            let current_rate = self.inner.sample_rate();
            let current_ch = self.inner.channels();
            if current_rate != self.sample_rate || current_ch != self.channels {
                self.sample_rate = current_rate;
                self.channels = current_ch;
                self.rebuild_filters();
                self.reset_all_filters();
            }

            // 检查并执行参数平滑渐变
            if self.is_ramping {
                self.step_parameter_smoothing();
                // 仅当参数变化帧且不处于完全 Bypass 时重构滤波器系数组
                if !self.is_hard_bypassed {
                    self.rebuild_filters();
                }
            }

            // Flat 状态下的 Hard Bypass 优化仅在非渐变期间启用。
            // 运行中从旁路启用时，前几帧仍接近 0dB，不能把状态重新锁回硬旁路。
            if !self.is_ramping
                && (self.current_preamp - 1.0).abs() < 0.001
                && self.current_gains.iter().all(|g| g.abs() < 0.01)
            {
                self.is_hard_bypassed = true;
            }
        }

        // Hard Bypass 极速直通，零 CPU 开销，完美高保真无损输出
        if self.is_hard_bypassed {
            self.current_channel += 1;
            if self.current_channel >= self.channels {
                self.current_channel = 0;
            }
            return Some(sample);
        }

        // 1. 前级 Preamp 增益乘法
        let preamped_sample = sample * self.current_preamp;

        // 2. 10 段 Peaking EQ 级联滤波运算 (TDF2)
        let mut out = preamped_sample;
        let channel_idx = self.current_channel as usize;
        for filter in &mut self.filters {
            out = filter.process(out, channel_idx);
        }

        self.current_channel += 1;
        if self.current_channel >= self.channels {
            self.current_channel = 0;
        }

        Some(out)
    }
}

impl<I> Source for Equalizer<I>
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
        self.current_channel = 0;
        // Seek 跳转瞬间强重置滤波器缓存状态，防 click 啸叫声
        self.reset_all_filters();
        self.inner.try_seek(pos)
    }
}

// =========================================================================
// Custom UserVolumeSource (自定义主音量控制源)
// =========================================================================

pub struct UserVolumeSource<I> {
    inner: I,
    volume: Arc<AtomicU32>, // 共享的 f32 音量快照
    current_volume: f32,
    target_volume: f32,
    ramp_frames: usize,
    current_frame: usize,
    is_ramping: bool,
    channels: u16,
    current_channel: u16,
}

impl<I> UserVolumeSource<I>
where
    I: Source<Item = f32>,
{
    pub fn new(inner: I, volume: Arc<AtomicU32>) -> Self {
        let vol = f32::from_bits(volume.load(Ordering::Relaxed)).clamp(0.0, 1.0);
        let sample_rate = inner.sample_rate();
        let channels = inner.channels();
        let ramp_frames = ((0.05 * sample_rate as f64).round() as usize).max(1);
        Self {
            inner,
            volume,
            current_volume: vol,
            target_volume: vol,
            ramp_frames,
            current_frame: 0,
            is_ramping: false,
            channels,
            current_channel: 0,
        }
    }
}

impl<I> Iterator for UserVolumeSource<I>
where
    I: Source<Item = f32>,
{
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;

        if self.current_channel == 0 {
            let next_target = f32::from_bits(self.volume.load(Ordering::Relaxed)).clamp(0.0, 1.0);
            if (next_target - self.target_volume).abs() > 0.00001 {
                self.target_volume = next_target;
                self.ramp_frames =
                    ((0.05 * self.inner.sample_rate() as f64).round() as usize).max(1);
                self.current_frame = 0;
                self.is_ramping = true;
            }

            if self.is_ramping {
                self.current_frame += 1;
                let progress = self.current_frame as f32 / self.ramp_frames as f32;
                if progress >= 1.0 {
                    self.current_volume = self.target_volume;
                    self.is_ramping = false;
                } else {
                    self.current_volume =
                        self.current_volume + (self.target_volume - self.current_volume) * progress;
                }
            }
        }

        self.current_channel += 1;
        if self.current_channel >= self.channels {
            self.current_channel = 0;
        }

        Some(sample * self.current_volume)
    }
}

impl<I> Source for UserVolumeSource<I>
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
        self.current_channel = 0;
        self.inner.try_seek(pos)
    }
}

// =========================================================================
// Custom ClipGuardSource (自定义最终安全防削波限幅源)
// =========================================================================

pub struct ClipGuardSource<I> {
    inner: I,
}

impl<I> ClipGuardSource<I> {
    pub fn new(inner: I) -> Self {
        Self { inner }
    }
}

impl<I> Iterator for ClipGuardSource<I>
where
    I: Source<Item = f32>,
{
    type Item = f32;

    #[inline]
    fn next(&mut self) -> Option<Self::Item> {
        let sample = self.inner.next()?;
        // 强制 clamp 到 [-0.98, 0.98] 之间兜底，不溢出硬件动态极限
        Some(sample.clamp(-0.98, 0.98))
    }
}

impl<I> Source for ClipGuardSource<I>
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
        self.inner.try_seek(pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    struct SignalSource {
        samples: Vec<f32>,
        cursor: usize,
        channels: u16,
        sample_rate: u32,
    }

    impl SignalSource {
        fn new(samples: Vec<f32>, channels: u16, sample_rate: u32) -> Self {
            Self {
                samples,
                cursor: 0,
                channels,
                sample_rate,
            }
        }
    }

    impl Iterator for SignalSource {
        type Item = f32;
        fn next(&mut self) -> Option<Self::Item> {
            if self.cursor < self.samples.len() {
                let sample = self.samples[self.cursor];
                self.cursor += 1;
                Some(sample)
            } else {
                None
            }
        }
    }

    impl Source for SignalSource {
        fn channels(&self) -> u16 {
            self.channels
        }
        fn sample_rate(&self) -> u32 {
            self.sample_rate
        }
        fn current_frame_len(&self) -> Option<usize> {
            Some(self.samples.len() - self.cursor)
        }
        fn total_duration(&self) -> Option<Duration> {
            None
        }
        fn try_seek(&mut self, _pos: Duration) -> Result<(), SeekError> {
            self.cursor = 0;
            Ok(())
        }
    }

    #[test]
    fn test_invalid_parameters_clamping() {
        // 验证 BiquadFilter 内部对增益的 clamp 功能，强 clamp 限制到 ±12 dB 范围
        let filter = BiquadFilter::new(1000.0, 44100.0, 1.0, 24.0, 2);
        assert!(filter.b0.is_finite());
        assert!(filter.a1.is_finite());
    }

    #[test]
    fn test_flat_bypass_equality() {
        let samples = vec![0.1, -0.2, 0.3, -0.4, 0.5, -0.6];
        let source = SignalSource::new(samples.clone(), 2, 44100);
        let settings = EqualizerSettings {
            enabled: false,
            preamp: 0.0,
            gains: [0.0; 10],
        };
        let handle = EqualizerHandle::new(settings);
        let mut eq = Equalizer::new(source, Arc::new(handle));

        // 默认 bypass 直通，误差为 0
        for &orig in &samples {
            assert_eq!(eq.next().unwrap(), orig);
        }
    }

    #[test]
    fn test_nyquist_frequency_clamp() {
        // 低采样率 8000 Hz，奈奎斯特频率为 4000 Hz
        // 高于 4000 Hz 的中心频率（如 16000 Hz）必须安全地被 clamp 到 0.45 * fs (3600 Hz) 以内，收敛且不产生 NaN
        let filter = BiquadFilter::new(16000.0, 8000.0, 1.0, 6.0, 2);
        assert!(filter.b0.is_finite());
        assert!(filter.b1.is_finite());
        assert!(filter.b2.is_finite());
        assert!(filter.a1.is_finite());
        assert!(filter.a2.is_finite());
    }

    #[test]
    fn test_stereo_channel_isolation() {
        let mut samples = Vec::new();
        for _ in 0..100 {
            samples.push(0.5); // 左声道恒为 0.5
            samples.push(-0.5); // 右声道恒为 -0.5
        }
        let source = SignalSource::new(samples, 2, 44100);
        let settings = EqualizerSettings {
            enabled: true,
            preamp: 0.0,
            gains: [6.0; 10],
        };
        let handle = EqualizerHandle::new(settings);
        let mut eq = Equalizer::new(source, Arc::new(handle));

        let mut left_out = Vec::new();
        let mut right_out = Vec::new();
        while let Some(l) = eq.next() {
            left_out.push(l);
            if let Some(r) = eq.next() {
                right_out.push(r);
            }
        }

        // 双声道独立延迟，输出全部有限，互不干扰产生 NaN
        for l in left_out {
            assert!(l.is_finite());
        }
        for r in right_out {
            assert!(r.is_finite());
        }
    }

    #[test]
    fn test_clip_guard_limit() {
        let samples = vec![2.5, -3.0, 1.2, -0.99, 0.98, 0.0];
        let source = SignalSource::new(samples, 1, 44100);
        let mut clip_guard = ClipGuardSource::new(source);

        // 强行 clamp 至 [-0.98, 0.98] 之间
        assert_eq!(clip_guard.next().unwrap(), 0.98);
        assert_eq!(clip_guard.next().unwrap(), -0.98);
        assert_eq!(clip_guard.next().unwrap(), 0.98);
        assert_eq!(clip_guard.next().unwrap(), -0.98);
        assert_eq!(clip_guard.next().unwrap(), 0.98);
        assert_eq!(clip_guard.next().unwrap(), 0.0);
    }

    #[test]
    fn test_enabling_equalizer_after_bypass_changes_output() {
        let samples = vec![0.25; 8_000];
        let source = SignalSource::new(samples, 1, 44100);
        let handle = Arc::new(EqualizerHandle::new(EqualizerSettings::default()));
        let mut eq = Equalizer::new(source, handle.clone());

        for _ in 0..300 {
            assert_eq!(eq.next().unwrap(), 0.25);
        }

        handle.set_settings(EqualizerSettings {
            enabled: true,
            preamp: 6.0,
            gains: [0.0; 10],
        });

        let mut last = 0.25;
        for _ in 0..4_000 {
            last = eq.next().unwrap();
        }

        assert!(
            last > 0.35,
            "expected enabled preamp to raise output, got {last}"
        );
    }
}
