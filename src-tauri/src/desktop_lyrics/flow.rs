//! Pure layout policy for fixed-size lyric overlays.
#[derive(Clone, Debug)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub x: f32,
    pub width: f32,
}

pub fn width_scale(widths: &[f32], available: f32, wrap: bool) -> f32 {
    if !wrap {
        return (available / widths.iter().sum::<f32>().max(1.)).clamp(0.85, 1.);
    }
    // Keep optional wrapping to at most two visual rows, without splitting timed cells.
    let fits = |scale: f32| {
        let mut rows = 1;
        let mut x = 0.;
        for width in widths {
            let w = width * scale;
            if w > available {
                return false;
            }
            if x > 0. && x + w > available {
                rows += 1;
                x = 0.;
            }
            x += w;
        }
        rows <= 2
    };
    if fits(1.) {
        return 1.;
    }
    let (mut low, mut high) = (0., 1.);
    for _ in 0..24 {
        let mid = (low + high) / 2.;
        if fits(mid) {
            low = mid;
        } else {
            high = mid;
        }
    }
    low * 0.999 // Leave room for floating-point layout differences after measuring again.
}

pub fn playhead(cues: &[Cue], time: f64, start: f64, end: f64, width: f32) -> f32 {
    if cues.is_empty() {
        return super::model::progress(start, end, time) * width;
    }
    let mut position: f32 = 0.;
    for cue in cues {
        if time < cue.start {
            break;
        }
        position =
            position.max(cue.x + cue.width * super::model::progress(cue.start, cue.end, time));
    }
    position.clamp(0., width)
}

pub fn scroll_offset(position: f32, width: f32, available: f32) -> f32 {
    // Keep the current syllable around 60% of the viewport, with look-ahead room.
    (position - available * 0.6).clamp(0., (width - available).max(0.))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn limited_shrink_then_scroll() {
        assert_eq!(width_scale(&[100.], 200., false), 1.);
        assert!((width_scale(&[210.], 200., false) - 200. / 210.).abs() < 0.001);
        assert_eq!(width_scale(&[1000.], 200., false), 0.85);
        assert_eq!(scroll_offset(0., 1000., 200.), 0.);
        assert_eq!(scroll_offset(500., 1000., 200.), 380.);
        assert_eq!(scroll_offset(1000., 1000., 200.), 800.);
    }
    #[test]
    fn timing_drives_pan_and_seek_is_deterministic() {
        let cues = [
            Cue {
                start: 1.,
                end: 3.,
                x: 0.,
                width: 100.,
            },
            Cue {
                start: 5.,
                end: 6.,
                x: 100.,
                width: 300.,
            },
        ];
        assert_eq!(playhead(&cues, 2., 1., 6., 400.), 50.);
        assert_eq!(playhead(&cues, 4., 1., 6., 400.), 100.); // Hold through instrumental gaps.
        assert_eq!(playhead(&cues, 5.5, 1., 6., 400.), 250.);
        assert_eq!(playhead(&cues, 0., 1., 6., 400.), 0.); // Seek backwards.
        assert_eq!(playhead(&[], 5., 0., 10., 400.), 200.); // Plain LRC / translation.
    }
    #[test]
    fn wrap_fits_two_rows_even_for_a_single_long_word() {
        let scale = width_scale(&[300.; 5], 500., true);
        assert!(scale <= 500. / 900.);
        assert!(scale > 0.55);
        assert!(width_scale(&[2000.], 500., true) <= 0.25);
    }
}
