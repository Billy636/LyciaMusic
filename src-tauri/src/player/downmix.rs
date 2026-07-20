use rodio::source::SeekError;
use rodio::Source;
use std::time::Duration;

const CENTER_GAIN: f32 = std::f32::consts::FRAC_1_SQRT_2;
const SURROUND_GAIN: f32 = std::f32::consts::FRAC_1_SQRT_2;
const LFE_GAIN: f32 = 0.5;

/// Converts FLAC/surround channel layouts to stereo without dropping the
/// center, LFE, or surround channels.
pub(crate) struct StereoDownmixer<S> {
    inner: S,
    input_channels: u16,
    frame: Vec<f32>,
    pending_right: Option<f32>,
}

impl<S> StereoDownmixer<S>
where
    S: Source<Item = f32>,
{
    pub(crate) fn new(inner: S) -> Self {
        let input_channels = inner.channels();
        assert!(input_channels > 2);
        Self {
            inner,
            input_channels,
            frame: vec![0.0; input_channels as usize],
            pending_right: None,
        }
    }

    fn mix_frame(&self) -> (f32, f32) {
        let channel = |index: usize| self.frame.get(index).copied().unwrap_or(0.0);
        let (left, right, gain_sum) = match self.input_channels {
            // FL, FR, FC
            3 => (
                channel(0) + CENTER_GAIN * channel(2),
                channel(1) + CENTER_GAIN * channel(2),
                1.0 + CENTER_GAIN,
            ),
            // FL, FR, BL, BR
            4 => (
                channel(0) + SURROUND_GAIN * channel(2),
                channel(1) + SURROUND_GAIN * channel(3),
                1.0 + SURROUND_GAIN,
            ),
            // FL, FR, FC, BL, BR
            5 => (
                channel(0) + CENTER_GAIN * channel(2) + SURROUND_GAIN * channel(3),
                channel(1) + CENTER_GAIN * channel(2) + SURROUND_GAIN * channel(4),
                1.0 + CENTER_GAIN + SURROUND_GAIN,
            ),
            // FL, FR, FC, LFE, BL, BR. This is the layout used by 5.1 FLAC.
            6 => (
                channel(0)
                    + CENTER_GAIN * channel(2)
                    + LFE_GAIN * channel(3)
                    + SURROUND_GAIN * channel(4),
                channel(1)
                    + CENTER_GAIN * channel(2)
                    + LFE_GAIN * channel(3)
                    + SURROUND_GAIN * channel(5),
                1.0 + CENTER_GAIN + LFE_GAIN + SURROUND_GAIN,
            ),
            // For uncommon layouts, retain every channel by distributing
            // additional channels alternately between left and right.
            _ => {
                let mut left = channel(0);
                let mut right = channel(1);
                let mut left_weight = 1.0;
                let mut right_weight = 1.0;
                for index in 2..self.input_channels as usize {
                    if index % 2 == 0 {
                        left += SURROUND_GAIN * channel(index);
                        left_weight += SURROUND_GAIN;
                    } else {
                        right += SURROUND_GAIN * channel(index);
                        right_weight += SURROUND_GAIN;
                    }
                }
                return (left / left_weight, right / right_weight);
            }
        };

        (left / gain_sum, right / gain_sum)
    }
}

impl<S> Iterator for StereoDownmixer<S>
where
    S: Source<Item = f32>,
{
    type Item = f32;

    fn next(&mut self) -> Option<Self::Item> {
        if let Some(right) = self.pending_right.take() {
            return Some(right);
        }

        for sample in &mut self.frame {
            *sample = self.inner.next()?;
        }
        let (left, right) = self.mix_frame();
        self.pending_right = Some(right);
        Some(left)
    }

    fn size_hint(&self) -> (usize, Option<usize>) {
        let (min, max) = self.inner.size_hint();
        let pending = usize::from(self.pending_right.is_some());
        let convert = |samples: usize| samples / self.input_channels as usize * 2 + pending;
        (convert(min), max.map(convert))
    }
}

impl<S> Source for StereoDownmixer<S>
where
    S: Source<Item = f32>,
{
    fn channels(&self) -> u16 {
        2
    }

    fn sample_rate(&self) -> u32 {
        self.inner.sample_rate()
    }

    fn current_frame_len(&self) -> Option<usize> {
        self.inner.current_frame_len().map(|samples| {
            samples / self.input_channels as usize * 2 + usize::from(self.pending_right.is_some())
        })
    }

    fn total_duration(&self) -> Option<Duration> {
        self.inner.total_duration()
    }

    fn try_seek(&mut self, pos: Duration) -> Result<(), SeekError> {
        self.pending_right = None;
        self.inner.try_seek(pos)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rodio::buffer::SamplesBuffer;

    #[test]
    fn downmixes_all_six_flac_channels_to_stereo() {
        let input = SamplesBuffer::new(6, 44_100, vec![1.0, 2.0, 3.0, 4.0, 5.0, 6.0]);
        let output = StereoDownmixer::new(input).collect::<Vec<_>>();
        let gain_sum = 1.0 + CENTER_GAIN + LFE_GAIN + SURROUND_GAIN;

        assert_eq!(output.len(), 2);
        assert!(
            (output[0]
                - (1.0 + 3.0 * CENTER_GAIN + 4.0 * LFE_GAIN + 5.0 * SURROUND_GAIN) / gain_sum)
                .abs()
                < 1e-6
        );
        assert!(
            (output[1]
                - (2.0 + 3.0 * CENTER_GAIN + 4.0 * LFE_GAIN + 6.0 * SURROUND_GAIN) / gain_sum)
                .abs()
                < 1e-6
        );
    }

    #[test]
    fn center_channel_is_present_in_both_stereo_channels() {
        let input = SamplesBuffer::new(6, 44_100, vec![0.0, 0.0, 1.0, 0.0, 0.0, 0.0]);
        let output = StereoDownmixer::new(input).collect::<Vec<_>>();

        assert!(output[0] > 0.0);
        assert_eq!(output[0], output[1]);
    }
}
