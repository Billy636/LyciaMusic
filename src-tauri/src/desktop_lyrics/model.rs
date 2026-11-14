//! Platform-independent lyric selection and timing. Times from the frontend are seconds.
use serde::{Deserialize, Serialize};
use std::sync::LazyLock;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Word {
    pub text: String,
    pub start: f64,
    pub end: f64,
    pub romaji: Option<String>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Line {
    pub time: f64,
    pub end_time: f64,
    pub end_time_inferred: Option<String>,
    pub text: String,
    pub translation: String,
    pub romaji: String,
    #[serde(rename = "isBG")]
    pub is_bg: bool,
    pub words: Vec<Word>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub show_translation: bool,
    pub show_romaji: bool,
    pub is_always_on_top: bool,
    pub always_show_shadow_background: bool,
    pub auto_hide_when_fullscreen: bool,
    pub auto_hide_when_paused: bool,
    pub show_double_line: bool,
    pub overflow_mode: String,
    pub enable_word_effect: bool,
    pub is_locked: bool,
    pub center_horizontally: bool,
    pub color_scheme: String,
    pub custom_played_color: String,
    pub custom_unplayed_color: String,
    pub custom_romaji_played_color: String,
    pub custom_romaji_unplayed_color: String,
    pub custom_translation_color: String,
    pub text_opacity: f32,
    pub text_shadow_color: String,
    pub first_line_text_shadow_strength: f32,
    pub second_line_text_shadow_strength: f32,
    pub text_stroke_color: String,
    pub text_stroke_depth: f32,
    pub player_font_scale: f32,
    pub player_line_gap: f32,
    pub player_offset_x: f32,
    pub player_offset_y: f32,
    pub player_alignment: String,
    pub player_font_preset: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            show_translation: true,
            show_romaji: false,
            is_always_on_top: false,
            always_show_shadow_background: false,
            auto_hide_when_fullscreen: true,
            auto_hide_when_paused: false,
            show_double_line: false,
            overflow_mode: "scroll".into(),
            enable_word_effect: true,
            is_locked: false,
            center_horizontally: false,
            color_scheme: "auto".into(),
            custom_played_color: "#8ec5ff".into(),
            custom_unplayed_color: "#ffffff".into(),
            custom_romaji_played_color: "#ff8cab".into(),
            custom_romaji_unplayed_color: "#dddddd".into(),
            custom_translation_color: "#dddddd".into(),
            text_opacity: 1.,
            text_shadow_color: "#000000".into(),
            first_line_text_shadow_strength: 0.,
            second_line_text_shadow_strength: 0.,
            text_stroke_color: "#000000".into(),
            text_stroke_depth: 0.,
            player_font_scale: 1.,
            player_line_gap: 1.,
            player_offset_x: 0.,
            player_offset_y: 0.,
            player_alignment: "center".into(),
            player_font_preset: "system".into(),
        }
    }
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Playback {
    pub playback_time: f64,
    pub synced_at: f64,
    pub is_playing: bool,
    pub audio_delay: f64,
    pub seek_revision: Option<u64>,
    pub sample_sequence: Option<u64>,
    pub song_path: Option<String>,
    pub playback_id: Option<u64>,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Song {
    pub path: String,
    pub duration: f64,
}

#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct ImportedFont {
    pub family: String,
    pub file_path: String,
}

#[derive(Clone, Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Snapshot {
    pub song: Option<Song>,
    pub parsed_lyrics: Vec<Line>,
    pub lyrics_status: String,
    pub fallback_text: String,
    #[serde(flatten)]
    pub playback: Playback,
    pub settings: Settings,
    pub custom_lyrics_fonts: Vec<ImportedFont>,
    pub theme_colors: Vec<String>,
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq)]
pub struct Bounds {
    pub x: i32,
    pub y: i32,
    pub width: i32,
    pub height: i32,
}

pub struct Clock {
    sample: Playback,
    received: Instant,
    projected: f64,
    correction: f64,
    initialized: bool,
}

#[derive(Clone, Copy, Debug, PartialEq)]
pub enum ClockSync {
    Ignored,
    Updated,
    Discontinuity,
}

impl Clock {
    pub fn new(sample: Playback) -> Self {
        let mut clock = Self {
            sample: Playback::default(),
            received: Instant::now(),
            projected: 0.,
            correction: 0.,
            initialized: false,
        };
        clock.sync(sample);
        clock
    }
    pub fn sync(&mut self, sample: Playback) -> ClockSync {
        if !sample.playback_time.is_finite() || !sample.audio_delay.is_finite() {
            return ClockSync::Ignored;
        }
        if self.initialized {
            if let (Some(previous), Some(next)) =
                (self.sample.sample_sequence, sample.sample_sequence)
            {
                if next <= previous {
                    return ClockSync::Ignored;
                }
            } else if sample.synced_at > 0.
                && self.sample.synced_at > 0.
                && sample.synced_at < self.sample.synced_at
            {
                return ClockSync::Ignored;
            }
        }
        let now = Instant::now();
        let previous_time = self.position(now);
        let now_ms = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs_f64()
            * 1000.;
        let elapsed = if sample.is_playing && sample.synced_at.is_finite() && sample.synced_at > 0.
        {
            ((now_ms - sample.synced_at) / 1000.).max(0.)
        } else {
            0.
        };
        let target = (sample.playback_time + elapsed).max(0.);
        let explicit_seek = self.initialized
            && matches!((self.sample.seek_revision, sample.seek_revision), (Some(previous), Some(next)) if previous != next);
        let song_changed = self.initialized && self.sample.song_path != sample.song_path;
        let playback_changed = self.initialized && self.sample.playback_id != sample.playback_id;
        // Older senders lack the deliberate-seek marker; retain their large-jump
        // behavior. New senders distinguish even a short backward seek from drift.
        let legacy_seek = self.initialized
            && self.sample.seek_revision.is_none()
            && sample.seek_revision.is_none()
            && (target - previous_time).abs() > 1.5;
        let reanchor =
            !self.initialized || explicit_seek || song_changed || playback_changed || legacy_seek;
        let offset_changed = self.initialized && self.sample.audio_delay != sample.audio_delay;
        let forward_jump = self.initialized && target - previous_time > 1.5;
        self.correction = 0.;
        self.projected = if reanchor {
            target
        } else if !sample.is_playing && !self.sample.is_playing {
            // Repeated pause snapshots must not move the frozen word highlight.
            previous_time
        } else {
            let position = previous_time.max(target);
            if sample.is_playing {
                // Backend corrections can be slightly behind the locally rendered
                // frame. Repay that lead by slowing/holding, never by rewinding.
                self.correction = (position - target).max(0.);
            }
            position
        };
        self.sample = sample;
        self.received = now;
        self.initialized = true;
        if reanchor || offset_changed || forward_jump {
            ClockSync::Discontinuity
        } else {
            ClockSync::Updated
        }
    }
    fn position(&self, now: Instant) -> f64 {
        if !self.sample.is_playing {
            return self.projected;
        }
        let elapsed = now.duration_since(self.received).as_secs_f64();
        // Small drift converges at 80% speed. A larger lead first holds until the
        // audio timeline catches up, so underruns cannot cause unlimited drift.
        let hold = (self.correction - 0.2).max(0.);
        let advancing = (elapsed - hold).max(0.);
        self.projected + advancing - (advancing * 0.2).min(self.correction.min(0.2))
    }
    pub fn time(&self) -> f64 {
        (self.position(Instant::now()) - self.sample.audio_delay).max(0.)
    }
    pub fn playing(&self) -> bool {
        self.sample.is_playing
    }
}

pub fn active_index(lines: &[Line], time: f64) -> usize {
    let candidates = foreground_indices(lines);
    let target = if time.is_finite() { time } else { 0. };
    let mut latest: Option<usize> = None;
    let mut singing: Option<usize> = None;
    let mut first: Option<usize> = None;
    let mut blank_time = f64::NEG_INFINITY;
    for &index in &candidates {
        let line = &lines[index];
        let meaningful = !line.text.trim().is_empty();
        if meaningful && first.is_none_or(|previous| line.time < lines[previous].time) {
            first = Some(index);
        }
        if line.time > target {
            continue;
        }
        if !meaningful {
            blank_time = blank_time.max(line.time);
        }
        if latest.is_none_or(|previous| {
            line.time > lines[previous].time
                || (line.time == lines[previous].time
                    && (meaningful || lines[previous].text.trim().is_empty()))
        }) {
            latest = Some(index);
        }
        if meaningful
            && line.end_time.is_finite()
            && line.end_time > target
            && singing.is_none_or(|previous| line.time >= lines[previous].time)
        {
            singing = Some(index);
        }
    }
    singing
        .filter(|&index| lines[index].time >= blank_time)
        .or(latest)
        .or(first)
        .or_else(|| candidates.first().copied())
        .unwrap_or(0)
}

fn foreground_indices(lines: &[Line]) -> Vec<usize> {
    let has_foreground = lines
        .iter()
        .any(|line| line.time.is_finite() && !line.is_bg && !line.text.trim().is_empty());
    lines
        .iter()
        .enumerate()
        .filter(|(_, line)| line.time.is_finite() && (!has_foreground || !line.is_bg))
        .map(|(index, _)| index)
        .collect()
}

/// Match the playback page's seven-second interlude threshold. A timed blank
/// explicitly marks waiting even in a shorter gap; a song without lyrics or a
/// completed final verse keeps its usual fallback/last-line display.
pub fn interlude_range(state: &Snapshot, time: f64) -> Option<(f64, f64)> {
    if state.lyrics_status != "ready" || !time.is_finite() {
        return None;
    }
    let lines = &state.parsed_lyrics;
    let blank = lines
        .iter()
        .filter(|line| line.time.is_finite() && line.time <= time && line.text.trim().is_empty())
        .map(|line| line.time)
        .max_by(f64::total_cmp);
    let mut next = f64::INFINITY;
    let mut start: f64 = 0.;
    let mut latest_start = f64::NEG_INFINITY;
    for line in lines
        .iter()
        .filter(|line| line.time.is_finite() && !line.text.trim().is_empty())
    {
        if line.time > time {
            next = next.min(line.time);
            continue;
        }
        latest_start = latest_start.max(line.time);
        let word_end = line
            .words
            .iter()
            .filter(|word| word.start.is_finite() && word.end.is_finite() && word.end > word.start)
            .map(|word| word.end)
            .max_by(f64::total_cmp);
        let mut end = if line.end_time_inferred.as_deref() == Some("line") && word_end.is_some() {
            word_end.unwrap()
        } else if line.end_time.is_finite() && line.end_time > line.time {
            line.end_time
        } else if let Some(end) = word_end {
            end
        } else {
            // Untimed LRC cannot tell us when the singer stopped. Do not invent
            // an interlude unless the source supplies a later explicit blank.
            blank.filter(|blank| *blank > line.time)?
        };
        if let Some(blank) = blank.filter(|blank| *blank > line.time) {
            end = end.min(blank);
        }
        if end > time {
            return None;
        }
        start = start.max(end);
    }
    if !next.is_finite() {
        return None;
    }
    let explicit_wait = blank.is_some_and(|blank| blank > latest_start);
    if let Some(blank) = blank.filter(|blank| *blank >= start) {
        // An intro may contain a timed blank before the first real lyric.
        if start == 0. {
            start = blank;
        }
    }
    (time >= start && time < next && (explicit_wait || next - start >= 7.)).then_some((start, next))
}

pub fn visible_line_indices(lines: &[Line], active: usize, double: bool) -> Vec<usize> {
    let Some(active_line) = lines.get(active) else {
        return vec![];
    };
    // An explicit interlude clears the preview as well as the current lyric.
    if active_line.text.trim().is_empty() {
        return vec![active];
    }
    // Always promote the current lyric to the first row, including after seeking.
    foreground_indices(lines)
        .into_iter()
        .filter(|&index| index >= active)
        .take(if double { 2 } else { 1 })
        .collect()
}

pub fn progress(start: f64, end: f64, time: f64) -> f32 {
    ((time - start) / (end - start).max(0.001)).clamp(0., 1.) as f32
}

pub fn line_end(state: &Snapshot, index: usize) -> f64 {
    let line = &state.parsed_lyrics[index];
    let end = if line.end_time > line.time {
        line.end_time
    } else {
        line.time + 3.
    };
    let boundary = foreground_indices(&state.parsed_lyrics)
        .into_iter()
        .find(|&candidate| candidate > index && state.parsed_lyrics[candidate].time > line.time)
        .map(|candidate| state.parsed_lyrics[candidate].time)
        .or_else(|| state.song.as_ref().map(|s| s.duration));
    boundary
        .filter(|t| *t > line.time)
        .map(|t| end.min((t - 0.08).max(line.time + 0.001)))
        .unwrap_or(end)
}

pub fn display_words(state: &Snapshot, index: usize) -> Vec<Word> {
    if !state.settings.enable_word_effect {
        return vec![];
    }
    let line = &state.parsed_lyrics[index];
    let words: Vec<_> = line
        .words
        .iter()
        .filter(|w| {
            !w.text.is_empty() && w.start.is_finite() && w.end.is_finite() && w.end > w.start
        })
        .cloned()
        .collect();
    if !words.is_empty() {
        return words;
    }
    let mut segments: Vec<String> = Vec::new();
    let mut latin = String::new();
    static LATIN_WORD: LazyLock<regex::Regex> = LazyLock::new(|| {
        regex::Regex::new(r"^[\p{Latin}\p{Number}'’_-]$").expect("static word pattern")
    });
    for ch in line.text.chars() {
        if LATIN_WORD.is_match(ch.encode_utf8(&mut [0; 4])) {
            latin.push(ch);
        } else {
            if !latin.is_empty() {
                segments.push(std::mem::take(&mut latin));
            }
            if ch.is_whitespace() && !segments.is_empty() {
                segments.last_mut().unwrap().push(ch);
            } else {
                segments.push(ch.to_string());
            }
        }
    }
    if !latin.is_empty() {
        segments.push(latin);
    }
    let end = line_end(state, index);
    let duration = (end - line.time).max(0.001) / segments.len().max(1) as f64;
    segments
        .into_iter()
        .enumerate()
        .map(|(i, text)| Word {
            text,
            start: line.time + i as f64 * duration,
            end: line.time + (i + 1) as f64 * duration,
            romaji: None,
        })
        .collect()
}

pub fn font_family(preset: &str) -> &str {
    match preset {
        "system" => "Segoe UI",
        "yahei" => "Microsoft YaHei",
        "dengxian" => "DengXian",
        "songti" => "SimSun",
        "heiti" => "SimHei",
        "kaiti" => "KaiTi",
        "arial" => "Arial",
        "georgia" => "Georgia",
        "mono" => "Cascadia Mono",
        other => other,
    }
}

/// Cover extraction currently sends CSS hsl(), while user settings send #RRGGBB.
pub fn css_rgb(value: &str) -> Option<[f32; 3]> {
    let value = value.trim();
    if let Some(hex) = value.strip_prefix('#') {
        let rgb = u32::from_str_radix(hex, 16).ok()?;
        return match hex.len() {
            6 => Some([
                ((rgb >> 16) & 255) as f32 / 255.,
                ((rgb >> 8) & 255) as f32 / 255.,
                (rgb & 255) as f32 / 255.,
            ]),
            3 => Some([
                ((rgb >> 8) & 15) as f32 / 15.,
                ((rgb >> 4) & 15) as f32 / 15.,
                (rgb & 15) as f32 / 15.,
            ]),
            _ => None,
        };
    }
    let body = value.strip_prefix("hsl(")?.strip_suffix(')')?;
    let parts: Vec<_> = body.split(',').map(str::trim).collect();
    if parts.len() != 3 {
        return None;
    }
    let h = parts[0].parse::<f32>().ok()?.rem_euclid(360.) / 60.;
    let s = (parts[1].strip_suffix('%')?.parse::<f32>().ok()? / 100.).clamp(0., 1.);
    let l = (parts[2].strip_suffix('%')?.parse::<f32>().ok()? / 100.).clamp(0., 1.);
    if !h.is_finite() || !s.is_finite() || !l.is_finite() {
        return None;
    }
    let c = (1. - (2. * l - 1.).abs()) * s;
    let x = c * (1. - (h.rem_euclid(2.) - 1.).abs());
    let rgb = match h as u8 {
        0 => [c, x, 0.],
        1 => [x, c, 0.],
        2 => [0., c, x],
        3 => [0., x, c],
        4 => [x, 0., c],
        _ => [c, 0., x],
    };
    Some(rgb.map(|v| v + l - c / 2.))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn holds_phrases_but_clears_both_rows_at_explicit_blank_cues() {
        let lines = vec![
            Line {
                time: 1.,
                end_time: 2.,
                text: "One".into(),
                ..Line::default()
            },
            Line {
                time: 4.,
                end_time: 8.,
                ..Line::default()
            },
            Line {
                time: 8.,
                end_time: 9.,
                text: "Two".into(),
                ..Line::default()
            },
        ];
        assert_eq!(active_index(&lines, 0.), 0);
        assert_eq!(active_index(&lines, 3.), 0);
        assert_eq!(active_index(&lines, 4.), 1);
        assert_eq!(visible_line_indices(&lines, 1, true), vec![1]);
        assert_eq!(visible_line_indices(&lines, 2, true), vec![2]);
        assert_eq!(active_index(&lines, 100.), 2);
    }

    #[test]
    fn background_and_ended_overlaps_do_not_replace_the_ongoing_foreground() {
        let lines = vec![
            Line {
                time: 0.,
                end_time: 10.,
                text: "BG".into(),
                is_bg: true,
                ..Line::default()
            },
            Line {
                time: 1.,
                end_time: 8.,
                text: "Main".into(),
                ..Line::default()
            },
            Line {
                time: 1.,
                end_time: 2.,
                text: "Short voice".into(),
                ..Line::default()
            },
            Line {
                time: 1.,
                end_time: 2.,
                ..Line::default()
            },
            Line {
                time: 3.,
                end_time: 10.,
                text: "BG".into(),
                is_bg: true,
                ..Line::default()
            },
            Line {
                time: 9.,
                end_time: 12.,
                text: "Next".into(),
                ..Line::default()
            },
        ];
        assert_eq!(active_index(&lines, 0.), 1);
        assert_eq!(active_index(&lines, 4.), 1);
        assert_eq!(visible_line_indices(&lines, 1, true), vec![1, 2]);
        assert_eq!(active_index(&lines[..1], 1.), 0);
    }

    #[test]
    fn cover_palette_hsl_and_custom_hex_colors() {
        assert_eq!(css_rgb("hsl(0, 100%, 50%)"), Some([1., 0., 0.]));
        assert_eq!(css_rgb("hsl(120, 100%, 50%)"), Some([0., 1., 0.]));
        assert_eq!(css_rgb("hsl(240, 100%, 50%)"), Some([0., 0., 1.]));
        assert_eq!(css_rgb("#fff"), Some([1., 1., 1.]));
        assert_eq!(css_rgb("#ff0000"), Some([1., 0., 0.]));
        assert_eq!(css_rgb("transparent"), None);
    }
    #[test]
    fn selection_and_current_next_order_match_web() {
        let lines = vec![
            Line {
                time: 2.,
                text: "One".into(),
                ..Line::default()
            },
            Line {
                time: 5.,
                text: "Two".into(),
                ..Line::default()
            },
            Line {
                time: 8.,
                text: "Three".into(),
                ..Line::default()
            },
        ];
        assert_eq!(active_index(&lines, 0.), 0);
        assert_eq!(active_index(&lines, 5.), 1);
        assert_eq!(visible_line_indices(&lines, 1, true), vec![1, 2]);
        assert_eq!(visible_line_indices(&lines, 2, true), vec![2]);
        assert_eq!(visible_line_indices(&lines, 0, true), vec![0, 1]);
        assert_eq!(visible_line_indices(&lines, 1, false), vec![1]);
    }
    #[test]
    fn pseudo_words_finish_before_next_line() {
        let state = Snapshot {
            parsed_lyrics: vec![
                Line {
                    text: "Hello 世界".into(),
                    time: 1.,
                    end_time: 10.,
                    ..Line::default()
                },
                Line {
                    time: 4.,
                    ..Line::default()
                },
            ],
            ..Snapshot::default()
        };
        let words = display_words(&state, 0);
        assert_eq!(
            words.iter().map(|w| w.text.as_str()).collect::<Vec<_>>(),
            vec!["Hello ", "世", "界"]
        );
        assert!((words.last().unwrap().end - 3.92).abs() < 0.00001);
        assert_eq!(progress(1., 2., 0.), 0.);
        assert_eq!(progress(1., 2., 1.5), 0.5);
        assert_eq!(progress(1., 2., 3.), 1.);
    }
    #[test]
    fn paused_clock_and_delay() {
        let clock = Clock::new(Playback {
            playback_time: 10.,
            audio_delay: 0.5,
            ..Playback::default()
        });
        assert_eq!(clock.time(), 9.5);
    }
    #[test]
    fn snapshot_uses_existing_frontend_wire_format() {
        let snapshot: Snapshot = serde_json::from_value(serde_json::json!({ "playbackTime": 12., "isPlaying": true, "audioDelay": 0.2, "settings": {"isLocked":true,"showDoubleLine":true}, "parsedLyrics":[{"time":2.,"endTime":5.,"text":"歌词","isBG":true}] })).unwrap();
        assert_eq!(snapshot.playback.playback_time, 12.);
        assert!(snapshot.settings.is_locked && snapshot.settings.show_double_line);
        assert_eq!(snapshot.parsed_lyrics[0].end_time, 5.);
        assert!(snapshot.parsed_lyrics[0].is_bg);
    }
}
