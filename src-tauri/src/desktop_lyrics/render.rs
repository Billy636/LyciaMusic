//! Cached DirectWrite layouts drawn into a premultiplied BGRA Direct2D surface.
//! GDI is used only to present that surface to the layered Win32 window.
use super::flow::{self, Cue};
use super::model::*;
use std::{mem::size_of, path::Path};
use windows::{
    core::{w, Interface, Result, PCWSTR},
    Win32::{
        Foundation::{COLORREF, HWND, POINT, RECT, SIZE},
        Graphics::{
            Direct2D::{Common::*, *},
            DirectWrite::*,
            Dxgi::Common::DXGI_FORMAT_B8G8R8A8_UNORM,
            Gdi::*,
        },
        UI::WindowsAndMessaging::{UpdateLayeredWindow, ULW_ALPHA},
    },
};
use windows_numerics::{Matrix3x2, Vector2};

fn point(x: f32, y: f32) -> Vector2 {
    Vector2 { X: x, Y: y }
}
fn rect(x: f32, y: f32, width: f32, height: f32) -> D2D_RECT_F {
    D2D_RECT_F {
        left: x,
        top: y,
        right: x + width,
        bottom: y + height,
    }
}
fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(Some(0)).collect()
}
fn color(hex: &str, alpha: f32) -> D2D1_COLOR_F {
    let rgb = css_rgb(hex).unwrap_or([1., 1., 1.]);
    D2D1_COLOR_F {
        r: rgb[0],
        g: rgb[1],
        b: rgb[2],
        a: alpha,
    }
}

struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    #[cfg(test)]
    bits: *const u8,
}
impl Surface {
    unsafe fn new(width: i32, height: i32) -> Result<Self> {
        let dc = CreateCompatibleDC(None);
        if dc.is_invalid() {
            return Err(windows::core::Error::from_win32());
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: width,
                biHeight: -height,
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        match CreateDIBSection(Some(dc), &info, DIB_RGB_COLORS, &mut bits, None, 0) {
            Ok(bitmap) => Ok(Self {
                dc,
                bitmap,
                previous: SelectObject(dc, bitmap.into()),
                #[cfg(test)]
                bits: bits.cast(),
            }),
            Err(error) => {
                let _ = DeleteDC(dc);
                Err(error)
            }
        }
    }
}
impl Drop for Surface {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.previous);
            let _ = DeleteObject(self.bitmap.into());
            let _ = DeleteDC(self.dc);
        }
    }
}

struct Text {
    layout: IDWriteTextLayout,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    timing: Option<(f64, f64)>,
    gradient: Option<ID2D1LinearGradientBrush>,
    base: D2D1_COLOR_F,
    played: D2D1_COLOR_F,
    shadow: f32,
}

struct Lane {
    range: std::ops::Range<usize>,
    width: f32,
    top: f32,
    height: f32,
    cues: Vec<Cue>,
    start: f64,
    end: f64,
    phase: i8, // -1 upcoming, 0 current, 1 completed
}
impl Lane {
    fn offset(&self, time: f64, available: f32) -> f32 {
        let position = match self.phase {
            -1 => 0.,
            1 => self.width,
            _ => flow::playhead(&self.cues, time, self.start, self.end, self.width),
        };
        flow::scroll_offset(position, self.width, available)
    }
}

/// Rasterize coverage once. The two karaoke colors share complementary physical-pixel clips.
struct GlyphMask {
    bitmap: ID2D1Bitmap,
    bounds: D2D_RECT_F,
    decoration: Option<ID2D1Bitmap>,
}

impl GlyphMask {
    unsafe fn tiles(
        target: &ID2D1RenderTarget,
        text: &Text,
        scale: f32,
        settings: &Settings,
    ) -> Result<Vec<Self>> {
        let overhang = text.layout.GetOverhangMetrics()?;
        let pad = 8.; // Includes stroke/shadow overhang, not just the fill.
        let left = ((text.x - overhang.left.max(0.) - pad) * scale).floor();
        let top = ((text.y - overhang.top.max(0.) - pad) * scale).floor();
        let right = ((text.x + text.width.max(text.layout.GetMaxWidth() + overhang.right) + pad)
            * scale)
            .ceil()
            .max(left + 1.);
        let bottom = ((text.y
            + text
                .height
                .max(text.layout.GetMaxHeight() + overhang.bottom)
            + pad)
            * scale)
            .ceil()
            .max(top + 1.);
        let tile_width = target.GetMaximumBitmapSize().min(1024) as f32;
        let mut tiles = Vec::new();
        let mut tile_left = left;
        while tile_left < right {
            let tile_right = (tile_left + tile_width).min(right);
            let bounds = rect(
                tile_left / scale,
                top / scale,
                (tile_right - tile_left) / scale,
                (bottom - top) / scale,
            );
            tiles.push(Self::tile(target, text, scale, bounds, settings)?);
            tile_left = tile_right;
        }
        Ok(tiles)
    }

    unsafe fn tile(
        target: &ID2D1RenderTarget,
        text: &Text,
        scale: f32,
        bounds: D2D_RECT_F,
        settings: &Settings,
    ) -> Result<Self> {
        let pixels = D2D_SIZE_U {
            width: ((bounds.right - bounds.left) * scale).round().max(1.) as u32,
            height: ((bounds.bottom - bounds.top) * scale).round().max(1.) as u32,
        };
        let size = D2D_SIZE_F {
            width: pixels.width as f32 / scale,
            height: pixels.height as f32 / scale,
        };
        let mask_target = target.CreateCompatibleRenderTarget(
            Some(&size),
            Some(&pixels),
            None,
            D2D1_COMPATIBLE_RENDER_TARGET_OPTIONS_NONE,
        )?;
        mask_target.SetDpi(96. * scale, 96. * scale);
        mask_target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
        let white = mask_target.CreateSolidColorBrush(&color("#ffffff", 1.), None)?;
        mask_target.BeginDraw();
        mask_target.Clear(Some(&color("#000000", 0.)));
        mask_target.DrawTextLayout(
            point(text.x - bounds.left, text.y - bounds.top),
            &text.layout,
            &white,
            D2D1_DRAW_TEXT_OPTIONS_NONE,
        );
        mask_target.EndDraw(None, None)?;
        let decoration = if text.shadow > 0. || settings.text_stroke_depth > 0. {
            let decoration_target = target.CreateCompatibleRenderTarget(
                Some(&size),
                Some(&pixels),
                None,
                D2D1_COMPATIBLE_RENDER_TARGET_OPTIONS_NONE,
            )?;
            decoration_target.SetDpi(96. * scale, 96. * scale);
            decoration_target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
            let brush = decoration_target
                .CreateSolidColorBrush(&color(&settings.text_shadow_color, 1.), None)?;
            let stroke = settings.text_stroke_depth.clamp(0., 100.) * 0.03;
            let outline = if stroke > 0. {
                Some(super::outline::renderer(
                    &decoration_target,
                    &brush,
                    stroke,
                    scale,
                )?)
            } else {
                None
            };
            decoration_target.BeginDraw();
            decoration_target.Clear(Some(&color("#000000", 0.)));
            let x = text.x - bounds.left;
            let y = text.y - bounds.top;
            if text.shadow > 0. {
                let strength = text.shadow.clamp(0., 100.) / 100.;
                brush.SetColor(&color(
                    &settings.text_shadow_color,
                    text.base.a * strength / 5.,
                ));
                for i in 0..12 {
                    let angle = i as f32 * std::f32::consts::TAU / 12.;
                    decoration_target.DrawTextLayout(
                        point(
                            x + angle.cos() * (1. + strength * 5.),
                            y + 1. + angle.sin() * (1. + strength * 5.),
                        ),
                        &text.layout,
                        &brush,
                        D2D1_DRAW_TEXT_OPTIONS_NONE,
                    );
                }
            }
            if let Some(outline) = &outline {
                brush.SetColor(&color(&settings.text_stroke_color, text.base.a));
                text.layout.Draw(None, outline, x, y)?;
            }
            decoration_target.EndDraw(None, None)?;
            Some(decoration_target.GetBitmap()?)
        } else {
            None
        };
        Ok(Self {
            bitmap: mask_target.GetBitmap()?,
            bounds,
            decoration,
        })
    }

    unsafe fn fill(&self, target: &ID2D1RenderTarget, brush: &ID2D1Brush, clip: D2D_RECT_F) {
        if clip.right <= clip.left {
            return;
        }
        target.PushAxisAlignedClip(&clip, D2D1_ANTIALIAS_MODE_ALIASED);
        let source = rect(
            0.,
            0.,
            self.bounds.right - self.bounds.left,
            self.bounds.bottom - self.bounds.top,
        );
        target.FillOpacityMask(
            &self.bitmap,
            brush,
            D2D1_OPACITY_MASK_CONTENT_GRAPHICS,
            Some(&self.bounds),
            Some(&source),
        );
        target.PopAxisAlignedClip();
    }
}

pub struct Renderer {
    target: ID2D1DCRenderTarget,
    write: IDWriteFactory,
    brush: ID2D1SolidColorBrush,
    surface: Surface,
    width: i32,
    height: i32,
    scale: f32,
    texts: Vec<Text>,
    lanes: Vec<Lane>,
    glyph_tiles: Vec<(usize, GlyphMask)>,
    fade_brushes: Vec<ID2D1Brush>,
    fade_layer: ID2D1Layer,
    font_key: String,
    family: String,
    collection: Option<IDWriteFontCollection>,
    custom_dir: std::path::PathBuf,
}

impl Renderer {
    pub unsafe fn new(
        width: i32,
        height: i32,
        scale: f32,
        custom_dir: std::path::PathBuf,
    ) -> Result<Self> {
        let factory: ID2D1Factory = D2D1CreateFactory(D2D1_FACTORY_TYPE_SINGLE_THREADED, None)?;
        let target = factory.CreateDCRenderTarget(&D2D1_RENDER_TARGET_PROPERTIES {
            r#type: D2D1_RENDER_TARGET_TYPE_SOFTWARE,
            pixelFormat: D2D1_PIXEL_FORMAT {
                format: DXGI_FORMAT_B8G8R8A8_UNORM,
                alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
            },
            dpiX: 96. * scale,
            dpiY: 96. * scale,
            usage: D2D1_RENDER_TARGET_USAGE_NONE,
            minLevel: D2D1_FEATURE_LEVEL_DEFAULT,
        })?;
        let surface = Surface::new(width, height)?;
        target.BindDC(
            surface.dc,
            &RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            },
        )?;
        target.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
        let brush = target.CreateSolidColorBrush(&color("#ffffff", 1.), None)?;
        let fade_layer = target.CreateLayer(None)?;
        Ok(Self {
            target,
            write: DWriteCreateFactory(DWRITE_FACTORY_TYPE_SHARED)?,
            brush,
            surface,
            width,
            height,
            scale,
            texts: vec![],
            lanes: vec![],
            glyph_tiles: vec![],
            fade_brushes: vec![],
            fade_layer,
            font_key: String::new(),
            family: "Segoe UI".into(),
            collection: None,
            custom_dir,
        })
    }

    pub unsafe fn resize(&mut self, width: i32, height: i32, scale: f32) -> Result<bool> {
        if (width, height, scale) == (self.width, self.height, self.scale) {
            return Ok(false);
        }
        let surface = Surface::new(width, height)?;
        self.target.BindDC(
            surface.dc,
            &RECT {
                left: 0,
                top: 0,
                right: width,
                bottom: height,
            },
        )?;
        self.target.SetDpi(96. * scale, 96. * scale);
        self.surface = surface;
        self.width = width;
        self.height = height;
        self.scale = scale;
        self.glyph_tiles.clear();
        Ok(true)
    }

    unsafe fn select_font(&mut self, state: &Snapshot) -> Result<()> {
        let preset = &state.settings.player_font_preset;
        let imported = state
            .custom_lyrics_fonts
            .iter()
            .find(|font| &font.family == preset);
        let key = format!(
            "{}:{}",
            preset,
            imported.map(|f| f.file_path.as_str()).unwrap_or_default()
        );
        if self.font_key == key {
            return Ok(());
        }
        self.collection = None;
        self.family = font_family(preset).into();
        if let Some(font) = imported {
            // Do not allow the IPC payload to load arbitrary files as fonts.
            let path = Path::new(&font.file_path)
                .canonicalize()
                .map_err(|_| windows::core::Error::from_win32())?;
            let allowed = self
                .custom_dir
                .canonicalize()
                .map_err(|_| windows::core::Error::from_win32())?;
            if !path.starts_with(allowed) {
                return Err(windows::core::Error::from_hresult(windows::core::HRESULT(
                    0x80070005u32 as i32,
                )));
            }
            let factory: IDWriteFactory5 = self.write.cast()?;
            let builder = factory.CreateFontSetBuilder()?;
            let filename = wide(&path.to_string_lossy());
            let file = self
                .write
                .CreateFontFileReference(PCWSTR(filename.as_ptr()), None)?;
            builder.AddFontFile(&file)?;
            let collection = factory.CreateFontCollectionFromFontSet(&builder.CreateFontSet()?)?;
            let names = collection.GetFontFamily(0)?.GetFamilyNames()?;
            let mut name = vec![0; names.GetStringLength(0)? as usize + 1];
            names.GetString(0, &mut name)?;
            self.family = String::from_utf16_lossy(&name[..name.len() - 1]);
            self.collection = Some(collection.cast()?);
        }
        self.font_key = key;
        Ok(())
    }

    unsafe fn layout(
        &self,
        text: &str,
        size: f32,
        width: f32,
        wrap: bool,
    ) -> Result<(IDWriteTextLayout, f32, f32)> {
        let family = wide(&self.family);
        let format = self.write.CreateTextFormat(
            PCWSTR(family.as_ptr()),
            self.collection.as_ref(),
            DWRITE_FONT_WEIGHT_BOLD,
            DWRITE_FONT_STYLE_NORMAL,
            DWRITE_FONT_STRETCH_NORMAL,
            size,
            w!("zh-CN"),
        )?;
        format.SetWordWrapping(if wrap {
            DWRITE_WORD_WRAPPING_WRAP
        } else {
            DWRITE_WORD_WRAPPING_NO_WRAP
        })?;
        let layout = self.write.CreateTextLayout(
            // A semantic lyric line stays one lane; explicit newlines must not bypass
            // the overflow policy (especially multi-line translation strings).
            &text
                .replace(['\r', '\n'], " ")
                .encode_utf16()
                .collect::<Vec<_>>(),
            &format,
            width.max(1.),
            4096.,
        )?;
        let mut metrics = DWRITE_TEXT_METRICS::default();
        layout.GetMetrics(&mut metrics)?;
        Ok((
            layout,
            metrics.widthIncludingTrailingWhitespace,
            metrics.height,
        ))
    }

    pub unsafe fn rebuild(&mut self, state: &Snapshot, page: usize, active: usize) -> Result<()> {
        self.rebuild_fitted(state, page, active, 1., 0)
    }

    unsafe fn rebuild_fitted(
        &mut self,
        state: &Snapshot,
        page: usize,
        active: usize,
        vertical_scale: f32,
        attempt: u8,
    ) -> Result<()> {
        if let Err(error) = self.select_font(state) {
            // Missing/deleted custom fonts should not make the lyrics window unusable.
            eprintln!("Native lyrics font unavailable, using Segoe UI: {error}");
            self.family = "Segoe UI".into();
            self.collection = None;
            self.font_key = format!(
                "{}:{}",
                state.settings.player_font_preset,
                state
                    .custom_lyrics_fonts
                    .iter()
                    .find(|f| f.family == state.settings.player_font_preset)
                    .map(|f| f.file_path.as_str())
                    .unwrap_or_default()
            );
        }
        self.texts.clear();
        self.lanes.clear();
        self.glyph_tiles.clear();
        self.fade_brushes.clear();
        let s = &state.settings;
        let width = self.width as f32 / self.scale;
        let height = self.height as f32 / self.scale;
        let available = (width - 48.).max(1.);
        let scale = s.player_font_scale.clamp(0.5, 3.) * vertical_scale;
        let gap = s.player_line_gap.clamp(0.5, 3.) * vertical_scale;
        let wrap = s.overflow_mode == "wrap";
        let alpha = s.text_opacity.clamp(0., 1.);
        let theme_colors: Vec<_> = state
            .theme_colors
            .iter()
            .filter(|c| css_rgb(c).is_some())
            .collect();
        let palette = match s.color_scheme.as_str() {
            "pink" => ["#f472b6", "#fb7185", "#f9a8d4"],
            "blue" => ["#60a5fa", "#38bdf8", "#93c5fd"],
            "green" => ["#34d399", "#22c55e", "#6ee7b7"],
            "white" => ["#ffffff", "#f3f4f6", "#d1d5db"],
            "default" => ["#EC4141", "#ff8364", "#f7b267"],
            "custom" => [
                s.custom_played_color.as_str(),
                s.custom_romaji_played_color.as_str(),
                s.custom_translation_color.as_str(),
            ],
            _ => [
                theme_colors
                    .first()
                    .map(|c| c.as_str())
                    .unwrap_or("#8ec5ff"),
                theme_colors
                    .get(1)
                    .or(theme_colors.first())
                    .map(|c| c.as_str())
                    .unwrap_or("#ff8cab"),
                theme_colors
                    .get(2)
                    .or(theme_colors.last())
                    .map(|c| c.as_str())
                    .unwrap_or("#88f3c2"),
            ],
        };
        let mut y = 0.;
        let mut row_ranges = Vec::new();
        let count = if s.show_double_line { 2 } else { 1 };
        for index in page..(page + count).min(state.parsed_lyrics.len()) {
            let line_start = self.texts.len();
            let line_top = y;
            let line = &state.parsed_lyrics[index];
            let is_active = index == active;
            let opacity = alpha * if is_active { 1. } else { 0.74 };
            let mut font_size = if is_active {
                26_f32.max((width * 0.048).min(height * 0.06))
            } else {
                20_f32.max((width * 0.036).min(height * 0.048))
            } * scale;
            let sub_size = 14_f32.max((width * 0.0225).min(height * 0.0275)) * scale;
            let shadow = if is_active {
                s.first_line_text_shadow_strength
            } else {
                s.second_line_text_shadow_strength
            };
            let played = color(palette[0], opacity);
            let base = color(
                if s.color_scheme == "custom" {
                    &s.custom_unplayed_color
                } else {
                    "#ffffff"
                },
                opacity,
            );
            let roman_base = color(
                if s.color_scheme == "custom" {
                    &s.custom_romaji_unplayed_color
                } else {
                    "#dddddd"
                },
                opacity,
            );
            let roman_played = color(palette[1], opacity);
            let words = display_words(state, index);
            let relevant: Vec<_> = words.iter().filter(|w| !w.text.trim().is_empty()).collect();
            let aligned = s.show_romaji
                && !relevant.is_empty()
                && relevant
                    .iter()
                    .all(|w| w.romaji.as_ref().is_some_and(|r| !r.trim().is_empty()));
            let mut widths = Vec::new();
            if words.is_empty() {
                let measured = self.layout(&line.text, font_size, available, false)?.1;
                if wrap {
                    widths.extend([measured / 2.; 2]);
                } else {
                    widths.push(measured);
                }
            } else {
                for word in &words {
                    let mut w = self.layout(&word.text, font_size, available, false)?.1;
                    if aligned {
                        w = w.max(
                            self.layout(
                                word.romaji.as_deref().unwrap_or(""),
                                font_size * 0.46,
                                available,
                                false,
                            )?
                            .1,
                        );
                    }
                    widths.push(w);
                }
            }
            font_size *= flow::width_scale(&widths, available, wrap);
            let mut cues = Vec::new();
            let main_start = self.texts.len();
            let main_top = y;
            let main_width;
            let alignment = if s.player_alignment == "split-corners" {
                if index == page {
                    "left"
                } else {
                    "right"
                }
            } else {
                &s.player_alignment
            };
            if words.is_empty() {
                let (layout, w, h) = self.layout(&line.text, font_size, available, wrap)?;
                if wrap {
                    layout.SetTextAlignment(match alignment {
                        "left" => DWRITE_TEXT_ALIGNMENT_LEADING,
                        "right" => DWRITE_TEXT_ALIGNMENT_TRAILING,
                        _ => DWRITE_TEXT_ALIGNMENT_CENTER,
                    })?;
                }
                self.texts.push(Text {
                    layout,
                    x: 0.,
                    y,
                    width: w,
                    height: h,
                    timing: None,
                    gradient: None,
                    base: if is_active { played } else { base },
                    played,
                    shadow,
                });
                if !wrap {
                    align_row(&mut self.texts[main_start..], available, w, alignment);
                }
                main_width = if wrap { available } else { w };
                y += h;
            } else {
                // Keep words and their aligned romanization in the same horizontal cell.
                let mut x = 0.;
                let mut row_height: f32 = 0.;
                let mut row_start = self.texts.len();
                for word in words {
                    let (layout, w, h) = self.layout(&word.text, font_size, available, false)?;
                    let roman = if aligned {
                        Some(self.layout(
                            word.romaji.as_deref().unwrap_or(""),
                            font_size * 0.46,
                            available,
                            false,
                        )?)
                    } else {
                        None
                    };
                    let cell_width = w.max(roman.as_ref().map(|r| r.1).unwrap_or(0.));
                    if wrap && x > 0. && x + cell_width > available {
                        align_row(&mut self.texts[row_start..], available, x, alignment);
                        y += row_height;
                        x = 0.;
                        row_height = 0.;
                        row_start = self.texts.len();
                    }
                    cues.push(Cue {
                        start: word.start,
                        end: word.end,
                        x,
                        width: cell_width,
                    });
                    let timing = if is_active {
                        Some((word.start, word.end))
                    } else {
                        None
                    };
                    let gradient = if is_active && s.color_scheme != "custom" {
                        let stops = self.target.CreateGradientStopCollection(
                            &[
                                D2D1_GRADIENT_STOP {
                                    position: 0.,
                                    color: played,
                                },
                                D2D1_GRADIENT_STOP {
                                    position: 1.,
                                    color: color(palette[1], opacity),
                                },
                            ],
                            D2D1_GAMMA_2_2,
                            D2D1_EXTEND_MODE_CLAMP,
                        )?;
                        Some(self.target.CreateLinearGradientBrush(
                            &D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES {
                                startPoint: point(0., 0.),
                                endPoint: point(w, 0.),
                            },
                            None,
                            &stops,
                        )?)
                    } else {
                        None
                    };
                    self.texts.push(Text {
                        layout,
                        x: x + (cell_width - w) / 2.,
                        y,
                        width: w,
                        height: h,
                        timing,
                        gradient,
                        base,
                        played,
                        shadow,
                    });
                    let mut cell_height = h;
                    if let Some((layout, w, h2)) = roman {
                        self.texts.push(Text {
                            layout,
                            x: x + (cell_width - w) / 2.,
                            y: y + h,
                            width: w,
                            height: h2,
                            timing,
                            gradient: None,
                            base: roman_base,
                            played: roman_played,
                            shadow,
                        });
                        cell_height += h2;
                    }
                    x += cell_width;
                    row_height = row_height.max(cell_height);
                }
                align_row(&mut self.texts[row_start..], available, x, alignment);
                main_width = if wrap { available } else { x };
                y += row_height;
            }
            let phase = if index < active {
                1
            } else if index > active {
                -1
            } else {
                0
            };
            self.lanes.push(Lane {
                range: main_start..self.texts.len(),
                width: main_width,
                top: main_top,
                height: y - main_top,
                cues: cues.clone(),
                start: line.time,
                end: line_end(state, index),
                phase,
            });
            for (text, roman) in [(&line.romaji, true), (&line.translation, false)] {
                if text.is_empty()
                    || (roman && (!s.show_romaji || aligned))
                    || (!roman && !s.show_translation)
                {
                    continue;
                }
                y += 2. * gap;
                let natural_width = self.layout(text, sub_size, available, false)?.1;
                let fitted = if wrap {
                    (available * 2. / natural_width.max(1.)).min(1.) * 0.999
                } else {
                    flow::width_scale(&[natural_width], available, false)
                };
                let (layout, w, h) = self.layout(text, sub_size * fitted, available, wrap)?;
                if wrap {
                    layout.SetTextAlignment(match alignment {
                        "left" => DWRITE_TEXT_ALIGNMENT_LEADING,
                        "right" => DWRITE_TEXT_ALIGNMENT_TRAILING,
                        _ => DWRITE_TEXT_ALIGNMENT_CENTER,
                    })?;
                }
                let sub_start = self.texts.len();
                self.texts.push(Text {
                    layout,
                    x: 0.,
                    y,
                    width: if wrap { available } else { w },
                    height: h,
                    timing: if roman && is_active {
                        Some((line.time, line_end(state, index)))
                    } else {
                        None
                    },
                    base: if roman {
                        roman_base
                    } else {
                        color(
                            if s.color_scheme == "custom" {
                                &s.custom_translation_color
                            } else {
                                "#dddddd"
                            },
                            opacity * 0.88,
                        )
                    },
                    played: roman_played,
                    gradient: None,
                    shadow,
                });
                if !wrap {
                    align_row(&mut self.texts[sub_start..], available, w, alignment);
                }
                self.lanes.push(Lane {
                    range: sub_start..self.texts.len(),
                    width: if wrap { available } else { w },
                    top: y,
                    height: h,
                    cues: if wrap {
                        vec![]
                    } else {
                        cues.iter()
                            .map(|c| Cue {
                                x: c.x * w / main_width.max(1.),
                                width: c.width * w / main_width.max(1.),
                                ..c.clone()
                            })
                            .collect()
                    },
                    start: line.time,
                    end: line_end(state, index),
                    phase,
                });
                y += h;
            }
            row_ranges.push((line_start, self.texts.len(), line_top, y - line_top));
            y += 3.52 * gap;
        }
        if self.texts.is_empty() {
            let text = match state.lyrics_status.as_str() {
                "loading" => "Loading lyrics...",
                "error" => "Lyrics unavailable",
                _ => &state.fallback_text,
            };
            let (layout, w, h) = self.layout(text, 18. * scale, available, true)?;
            layout.SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER)?;
            self.texts.push(Text {
                layout,
                x: 0.,
                y: 0.,
                width: w,
                height: h,
                timing: None,
                gradient: None,
                base: color("#ffffff", alpha),
                played: color("#ffffff", alpha),
                shadow: s.first_line_text_shadow_strength,
            });
            y = h;
            self.lanes.push(Lane {
                range: 0..self.texts.len(),
                width: available,
                top: 0.,
                height: h,
                cues: vec![],
                start: 0.,
                end: 1.,
                phase: -1,
            });
        }
        let body_top = 52.;
        let body_bottom = (height - 20.).max(body_top + 1.);
        let body_height = body_bottom - body_top;
        if y > body_height && attempt < 4 {
            return self.rebuild_fitted(
                state,
                page,
                active,
                vertical_scale * (body_height / y) * 0.98,
                attempt + 1,
            );
        }
        let offset_x = width * s.player_offset_x.clamp(-100., 100.) / 100.;
        let offset_y = height * s.player_offset_y.clamp(-100., 100.) / 100.;
        let top = (((body_top + body_bottom - y) / 2.) + offset_y)
            .clamp(body_top, (body_bottom - y).max(body_top));
        if s.player_alignment == "split-corners" && s.show_double_line && row_ranges.len() == 2 {
            // The existing split-corners mode pins the two groups to opposite vertical corners.
            for (row, &(start, end, old_y, row_height)) in row_ranges.iter().enumerate() {
                let target_y = if row == 0 {
                    body_top
                } else {
                    (body_bottom - row_height).max(body_top)
                };
                for text in &mut self.texts[start..end] {
                    text.y += target_y - old_y - top;
                }
            }
        }
        for lane in &mut self.lanes {
            // Clamp manual offsets to keep every row inside the viewport.
            let left = self.texts[lane.range.clone()]
                .iter()
                .map(|t| t.x)
                .fold(f32::INFINITY, f32::min);
            let shift = if lane.width > available {
                0.
            } else {
                (left + offset_x).clamp(0., (available - lane.width).max(0.)) - left
            };
            for text in &mut self.texts[lane.range.clone()] {
                text.x += shift;
            }
            lane.top = self.texts[lane.range.clone()]
                .iter()
                .map(|t| t.y)
                .fold(f32::INFINITY, f32::min)
                + top;
        }
        for text in &mut self.texts {
            text.x += 24.;
            text.y += top;
        }

        // Cache glyph-local tiles, including offscreen words, so panning never rerasterizes text.
        for (index, text) in self.texts.iter().enumerate() {
            for tile in GlyphMask::tiles(&self.target, text, self.scale, s)? {
                self.glyph_tiles.push((index, tile));
            }
        }
        for flags in 0..4 {
            let edge = (16. / available).min(0.25);
            let stops = self.target.CreateGradientStopCollection(
                &[
                    D2D1_GRADIENT_STOP {
                        position: 0.,
                        color: color("#ffffff", if flags & 1 != 0 { 0. } else { 1. }),
                    },
                    D2D1_GRADIENT_STOP {
                        position: edge,
                        color: color("#ffffff", 1.),
                    },
                    D2D1_GRADIENT_STOP {
                        position: 1. - edge,
                        color: color("#ffffff", 1.),
                    },
                    D2D1_GRADIENT_STOP {
                        position: 1.,
                        color: color("#ffffff", if flags & 2 != 0 { 0. } else { 1. }),
                    },
                ],
                D2D1_GAMMA_2_2,
                D2D1_EXTEND_MODE_CLAMP,
            )?;
            self.fade_brushes.push(
                self.target
                    .CreateLinearGradientBrush(
                        &D2D1_LINEAR_GRADIENT_BRUSH_PROPERTIES {
                            startPoint: point(24., 0.),
                            endPoint: point(width - 24., 0.),
                        },
                        None,
                        &stops,
                    )?
                    .cast()?,
            );
        }
        Ok(())
    }

    pub unsafe fn draw(
        &self,
        hwnd: HWND,
        state: &Snapshot,
        time: f64,
        toolbar: bool,
        surface: bool,
        hover: Option<usize>,
        playing: bool,
        opacity: f32,
    ) -> Result<()> {
        let width = self.width as f32 / self.scale;
        let height = self.height as f32 / self.scale;
        self.target.BeginDraw();
        // Alpha 1/255 keeps the unlocked transparent surface draggable without a visible box.
        self.target.Clear(Some(&color(
            "#101018",
            if surface {
                0.42
            } else if state.settings.is_locked {
                0.
            } else {
                1. / 255.
            },
        )));
        self.paint_lyrics(time);
        self.target
            .SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
        if surface {
            self.brush.SetColor(&color("#ffffff", 0.16));
            self.target.DrawRectangle(
                &rect(0.5, 0.5, width - 1., height - 1.),
                &self.brush,
                1.,
                None,
            );
        }
        if toolbar {
            self.toolbar(width, state.settings.is_locked, playing, hover);
        }
        self.target.EndDraw(None, None)?;
        UpdateLayeredWindow(
            hwnd,
            None,
            None,
            Some(&SIZE {
                cx: self.width,
                cy: self.height,
            }),
            Some(self.surface.dc),
            Some(&POINT::default()),
            COLORREF(0),
            Some(&BLENDFUNCTION {
                BlendOp: AC_SRC_OVER as u8,
                BlendFlags: 0,
                SourceConstantAlpha: (opacity.clamp(0., 1.) * 255.) as u8,
                AlphaFormat: AC_SRC_ALPHA as u8,
            }),
            ULW_ALPHA,
        )
    }

    unsafe fn paint_lyrics(&self, time: f64) {
        use std::mem::ManuallyDrop;
        let available = (self.width as f32 / self.scale - 48.).max(1.);
        let identity = Matrix3x2 {
            M11: 1.,
            M22: 1.,
            ..Default::default()
        };
        for lane in &self.lanes {
            let offset = (lane.offset(time, available) * self.scale).round() / self.scale;
            let viewport = rect(24., (lane.top - 8.).max(44.), available, lane.height + 16.);
            let overflow = lane.width > available + 0.5;
            if overflow {
                let flags = usize::from(offset > 0.)
                    | (usize::from(offset + available < lane.width - 0.5) << 1);
                let mut parameters = D2D1_LAYER_PARAMETERS {
                    contentBounds: viewport,
                    geometricMask: ManuallyDrop::new(None),
                    maskAntialiasMode: D2D1_ANTIALIAS_MODE_ALIASED,
                    maskTransform: identity,
                    opacity: 1.,
                    opacityBrush: ManuallyDrop::new(Some(self.fade_brushes[flags].clone())),
                    layerOptions: D2D1_LAYER_OPTIONS_NONE,
                };
                self.target.PushLayer(&parameters, &self.fade_layer);
                ManuallyDrop::drop(&mut parameters.opacityBrush);
            } else {
                self.target
                    .PushAxisAlignedClip(&viewport, D2D1_ANTIALIAS_MODE_ALIASED);
            }
            self.target.SetTransform(&Matrix3x2 {
                M31: -offset,
                ..identity
            });
            // Decorations move with the fills and remain underneath every word in this lane.
            for (index, mask) in &self.glyph_tiles {
                if !lane.range.contains(index)
                    || mask.bounds.right - offset < 24.
                    || mask.bounds.left - offset > available + 24.
                {
                    continue;
                }
                if let Some(bitmap) = &mask.decoration {
                    self.target.DrawBitmap(
                        bitmap,
                        Some(&mask.bounds),
                        1.,
                        D2D1_BITMAP_INTERPOLATION_MODE_LINEAR,
                        None,
                    );
                }
            }
            // FillOpacityMask requires aliased geometry AA; coverage AA lives in the cached mask.
            self.target.SetAntialiasMode(D2D1_ANTIALIAS_MODE_ALIASED);
            for (index, mask) in &self.glyph_tiles {
                if !lane.range.contains(index)
                    || mask.bounds.right - offset < 24.
                    || mask.bounds.left - offset > available + 24.
                {
                    continue;
                }
                let text = &self.texts[*index];
                let Some((start, end)) = text.timing else {
                    self.brush.SetColor(&text.base);
                    mask.fill(&self.target, &self.brush, mask.bounds);
                    continue;
                };
                let amount = progress(start, end, time);
                let cut = if amount <= 0. {
                    mask.bounds.left
                } else if amount >= 1. {
                    mask.bounds.right
                } else {
                    ((text.x + text.width * amount) * self.scale).round() / self.scale
                }
                .clamp(mask.bounds.left, mask.bounds.right);
                self.brush.SetColor(&text.base);
                mask.fill(
                    &self.target,
                    &self.brush,
                    D2D_RECT_F {
                        left: cut,
                        ..mask.bounds
                    },
                );
                let played_clip = D2D_RECT_F {
                    right: cut,
                    ..mask.bounds
                };
                if let Some(gradient) = &text.gradient {
                    gradient.SetStartPoint(point(text.x, text.y));
                    gradient.SetEndPoint(point(text.x + (text.width * amount).max(0.01), text.y));
                    mask.fill(&self.target, gradient, played_clip);
                } else {
                    self.brush.SetColor(&text.played);
                    mask.fill(&self.target, &self.brush, played_clip);
                }
            }
            self.target.SetTransform(&identity);
            if overflow {
                self.target.PopLayer();
            } else {
                self.target.PopAxisAlignedClip();
            }
        }
    }

    unsafe fn toolbar(&self, width: f32, locked: bool, playing: bool, hover: Option<usize>) {
        let count = if locked { 1 } else { 5 };
        let left = width / 2. - count as f32 * 38. / 2.;
        for index in 0..count {
            let x = left + index as f32 * 38. + 19.;
            let y = 22.;
            if hover == Some(index) {
                self.brush.SetColor(&color("#ffffff", 0.18));
                self.target.FillEllipse(
                    &D2D1_ELLIPSE {
                        point: point(x, y),
                        radiusX: 15.,
                        radiusY: 15.,
                    },
                    &self.brush,
                );
            }
            self.brush.SetColor(&color("#ffffff", 0.94));
            let line = |x1, y1, x2, y2| {
                self.target
                    .DrawLine(point(x1, y1), point(x2, y2), &self.brush, 1.8, None)
            };
            match index {
                0 => {
                    self.target.DrawRectangle(
                        &rect(x - 6., y - 1., 12., 9.),
                        &self.brush,
                        1.7,
                        None,
                    );
                    line(x - 4., y - 1., x - 4., y - 7.);
                    line(x - 4., y - 7., x + 4., y - 7.);
                    if !locked {
                        line(x + 4., y - 7., x + 4., y - 1.);
                    }
                }
                1 => {
                    line(x - 6., y - 7., x - 6., y + 7.);
                    line(x + 5., y - 6., x - 3., y);
                    line(x - 3., y, x + 5., y + 6.);
                    line(x + 5., y + 6., x + 5., y - 6.);
                }
                2 if playing => {
                    self.target
                        .FillRectangle(&rect(x - 5., y - 7., 3., 14.), &self.brush);
                    self.target
                        .FillRectangle(&rect(x + 2., y - 7., 3., 14.), &self.brush);
                }
                2 => {
                    line(x - 4., y - 7., x + 6., y);
                    line(x + 6., y, x - 4., y + 7.);
                    line(x - 4., y + 7., x - 4., y - 7.);
                }
                3 => {
                    line(x + 6., y - 7., x + 6., y + 7.);
                    line(x - 5., y - 6., x + 3., y);
                    line(x + 3., y, x - 5., y + 6.);
                    line(x - 5., y + 6., x - 5., y - 6.);
                }
                _ => {
                    line(x - 5., y - 5., x + 5., y + 5.);
                    line(x + 5., y - 5., x - 5., y + 5.);
                }
            }
        }
    }
}

fn align_row(texts: &mut [Text], available: f32, used: f32, alignment: &str) {
    let offset = match alignment {
        "left" => 0.,
        "right" => available - used,
        _ => (available - used) / 2.,
    };
    for text in texts {
        text.x += offset.max(0.);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use windows::Win32::{
        System::{
            Com::*,
            Threading::{GetCurrentProcess, GetGuiResources, GR_GDIOBJECTS},
        },
        UI::WindowsAndMessaging::*,
    };

    #[test]
    fn narrow_window_fits_two_sentences_and_scrolls_cached_words() {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Lyric overflow regression"),
                WS_POPUP,
                0,
                0,
                1040,
                320,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            let words: Vec<_> = "真夜中のドアをたたき帰らないでと泣いたあの季節がいま目の前にいる"
                .chars()
                .enumerate()
                .map(|(i, c)| Word {
                    text: c.to_string(),
                    start: i as f64 * 0.5,
                    end: (i + 1) as f64 * 0.5,
                    romaji: Some("roman".into()),
                })
                .collect();
            let state = Snapshot {
                settings: Settings {
                    is_locked: true,
                    show_double_line: true,
                    show_romaji: true,
                    show_translation: true,
                    player_font_scale: 3.,
                    text_stroke_depth: 30.,
                    ..Settings::default()
                },
                parsed_lyrics: vec![
                    Line {
                        time: 0.,
                        end_time: 20.,
                        text: words.iter().map(|w| w.text.as_str()).collect(),
                        translation: "不要离开我，这个漫长的夜晚，让这段旋律陪着我走过每一个季节。"
                            .into(),
                        romaji: "romanization of this very long line".into(),
                        words,
                    },
                    Line {
                        time: 30.,
                        end_time: 40.,
                        text: "stay with me... 下一句仍然完整保留".into(),
                        translation: "留在我的身边，不要因为上一句太长就把下一句挤出窗口。".into(),
                        ..Line::default()
                    },
                ],
                ..Snapshot::default()
            };
            for scale in [1., 1.5, 2.] {
                let (w, h) = ((520. * scale) as i32, (160. * scale) as i32);
                let mut renderer = Renderer::new(w, h, scale, std::env::temp_dir()).unwrap();
                renderer.rebuild(&state, 0, 0).unwrap();
                assert_eq!(
                    renderer.lanes.len(),
                    4,
                    "two original sentences each retain their translation"
                );
                for text in &renderer.texts {
                    let mut metrics = DWRITE_TEXT_METRICS::default();
                    text.layout.GetMetrics(&mut metrics).unwrap();
                    assert_eq!(metrics.lineCount, 1, "scroll mode must not wrap");
                    assert!(
                        text.y >= 51.9 && text.y + text.height <= 140.1,
                        "all rows must fit vertically: y={} h={}",
                        text.y,
                        text.height
                    );
                }
                let main = &renderer.lanes[0];
                assert!(main.width > 472.);
                assert_eq!(main.offset(0., 472.), 0.);
                assert!(main.offset(8., 472.) > 0.);
                assert!((main.offset(25., 472.) - (main.width - 472.)).abs() < 0.01);
                assert_eq!(
                    renderer.lanes[2].offset(25., 472.),
                    0.,
                    "upcoming line stays at its beginning"
                );
                assert!(renderer.glyph_tiles.iter().all(|(_, tile)| tile
                    .bitmap
                    .GetPixelSize()
                    .width
                    <= 1024));
                let cache_count = renderer.glyph_tiles.len();
                for (label, time) in [("start", 0.), ("repeat", 0.), ("middle", 8.), ("end", 25.)] {
                    renderer
                        .draw(hwnd, &state, time, false, false, None, true, 1.)
                        .unwrap();
                    assert_eq!(renderer.glyph_tiles.len(), cache_count);
                    let pixels =
                        std::slice::from_raw_parts(renderer.surface.bits, (w * h * 4) as usize);
                    assert!(pixels.chunks_exact(4).filter(|p| p[3] > 20).count() > 200);
                    let preview = image::RgbImage::from_raw(
                        w as u32,
                        h as u32,
                        pixels
                            .chunks_exact(4)
                            .flat_map(|p| [p[2], p[1], p[0]])
                            .collect(),
                    )
                    .unwrap();
                    preview
                        .save(std::env::temp_dir().join(format!(
                            "lycia-overflow-{}-{label}.png",
                            (scale * 100.) as u32
                        )))
                        .unwrap();
                    for (i, lane) in renderer.lanes.iter().enumerate() {
                        let top = (lane.top * scale) as usize;
                        let bottom = ((lane.top + lane.height) * scale) as usize;
                        let lit = pixels
                            .chunks_exact((w * 4) as usize)
                            .skip(top)
                            .take(bottom - top)
                            .flat_map(|row| row.chunks_exact(4))
                            .filter(|p| p[3] > 20)
                            .count();
                        assert!(
                            lit > 20,
                            "lane {i} must remain visible during scrolling ({label}, DPI {scale})"
                        );
                    }
                }
                let mut wrap_state = state.clone();
                wrap_state.settings.overflow_mode = "wrap".into();
                renderer.rebuild(&wrap_state, 0, 0).unwrap();
                assert!(renderer.lanes.iter().all(|l| l.width <= 472.1));
                assert!(renderer.texts.iter().all(|t| t.y + t.height <= 140.1));
                let main_rows: std::collections::BTreeSet<_> = renderer.texts
                    [renderer.lanes[0].range.clone()]
                .iter()
                .step_by(2)
                .map(|t| (t.y * 100.).round() as i32)
                .collect();
                assert!(
                    main_rows.len() <= 2,
                    "wrapped main lyrics must use at most two rows"
                );
                for text in &renderer.texts {
                    let mut metrics = DWRITE_TEXT_METRICS::default();
                    text.layout.GetMetrics(&mut metrics).unwrap();
                    assert!(metrics.lineCount <= 2);
                }
                renderer
                    .draw(hwnd, &wrap_state, 8., false, false, None, true, 1.)
                    .unwrap();
                let mut plain = state.clone();
                plain.settings.enable_word_effect = false;
                plain.parsed_lyrics[0].romaji = "romanization without per-word timing ".repeat(5);
                renderer.rebuild(&plain, 0, 0).unwrap();
                assert_eq!(
                    renderer.lanes.len(),
                    5,
                    "standalone romanization receives its own reserved row"
                );
                assert!(renderer.texts.iter().all(|t| t.y + t.height <= 140.1));
                assert!(renderer.lanes[0].offset(18., 472.) >= renderer.lanes[0].offset(2., 472.));
                renderer
                    .draw(hwnd, &plain, 18., false, false, None, false, 1.)
                    .unwrap();
                let paused =
                    std::slice::from_raw_parts(renderer.surface.bits, (w * h * 4) as usize)
                        .to_vec();
                renderer
                    .draw(hwnd, &plain, 18., false, false, None, false, 1.)
                    .unwrap();
                assert_eq!(
                    paused,
                    std::slice::from_raw_parts(renderer.surface.bits, (w * h * 4) as usize),
                    "paused scroll must be stable"
                );
                renderer.rebuild(&state, 0, 1).unwrap();
                assert_eq!(
                    renderer.lanes[0].offset(31., 472.),
                    (renderer.lanes[0].width - 472.).max(0.),
                    "completed sentence stays at its end"
                );
            }
            DestroyWindow(hwnd).unwrap();
            CoUninitialize();
        }
    }

    #[test]
    fn karaoke_recolor_preserves_coverage_without_white_fringe() {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Lyric edge regression"),
                WS_POPUP,
                0,
                0,
                900,
                280,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            let state = Snapshot {
                settings: Settings {
                    is_locked: true,
                    color_scheme: "custom".into(),
                    custom_played_color: "#ff0000".into(),
                    custom_unplayed_color: "#ffffff".into(),
                    player_font_scale: 1.7,
                    show_translation: false,
                    ..Settings::default()
                },
                parsed_lyrics: vec![Line {
                    text: "不要对我说再见 AVgy".into(),
                    time: 0.,
                    end_time: 10.,
                    words: vec![Word {
                        text: "不要对我说再见 AVgy".into(),
                        start: 0.,
                        end: 10.,
                        romaji: None,
                    }],
                    ..Line::default()
                }],
                ..Snapshot::default()
            };
            for scale in [1., 1.25, 1.5, 2.] {
                let mut renderer = Renderer::new(900, 280, scale, std::env::temp_dir()).unwrap();
                renderer.rebuild(&state, 0, 0).unwrap();
                renderer
                    .draw(hwnd, &state, 0., false, false, None, true, 1.)
                    .unwrap();
                let before =
                    std::slice::from_raw_parts(renderer.surface.bits, 900 * 280 * 4).to_vec();
                renderer
                    .draw(hwnd, &state, 11., false, false, None, true, 1.)
                    .unwrap();
                let after =
                    std::slice::from_raw_parts(renderer.surface.bits, 900 * 280 * 4).to_vec();
                // Save a black-background preview before assertions, also on the old failing renderer.
                let preview = image::RgbImage::from_raw(
                    900,
                    280,
                    after
                        .chunks_exact(4)
                        .flat_map(|p| [p[2], p[1], p[0]])
                        .collect(),
                )
                .unwrap();
                preview
                    .save(
                        std::env::temp_dir()
                            .join(format!("lycia-lyric-edge-{}.png", (scale * 100.) as u32)),
                    )
                    .unwrap();
                assert!(
                    after.chunks_exact(4).any(|p| p[3] > 0 && p[3] < 255),
                    "antialiased edge pixels must exist"
                );
                assert!(
                    after.chunks_exact(4).all(|p| p[0] == 0 && p[1] == 0),
                    "fully red glyphs must not retain white base pixels at {scale}x DPI"
                );
                assert!(
                    before
                        .chunks_exact(4)
                        .zip(after.chunks_exact(4))
                        .all(|(a, b)| a[3].abs_diff(b[3]) <= 1),
                    "recolor must not thicken antialiased edges"
                );
                renderer
                    .draw(hwnd, &state, 3.73, false, false, None, true, 1.)
                    .unwrap();
                let partial = std::slice::from_raw_parts(renderer.surface.bits, 900 * 280 * 4);
                assert!(
                    before
                        .chunks_exact(4)
                        .zip(partial.chunks_exact(4))
                        .all(|(a, b)| a[3].abs_diff(b[3]) <= 1),
                    "partial highlight must not leave gaps or double coverage"
                );
            }
            DestroyWindow(hwnd).unwrap();
            CoUninitialize();
        }
    }

    // Uses a hidden HWND and real Direct2D/DirectWrite, not a mocked drawing backend.
    #[test]
    fn native_render_smoke() {
        unsafe {
            CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok().unwrap();
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TOOLWINDOW,
                w!("STATIC"),
                w!("Lycia native render test"),
                WS_POPUP,
                0,
                0,
                900,
                280,
                None,
                None,
                None,
                None,
            )
            .unwrap();
            let state = Snapshot {
                settings: Settings {
                    show_double_line: true,
                    show_romaji: true,
                    text_stroke_depth: 40.,
                    first_line_text_shadow_strength: 50.,
                    second_line_text_shadow_strength: 30.,
                    ..Settings::default()
                },
                parsed_lyrics: vec![
                    Line {
                        time: 0.,
                        end_time: 4.,
                        text: "你好 世界 Hello".into(),
                        translation: "Hello world · 原生桌面歌词".into(),
                        words: vec![
                            Word {
                                text: "你好 ".into(),
                                start: 0.,
                                end: 1.,
                                romaji: Some("ni hao".into()),
                            },
                            Word {
                                text: "世界 ".into(),
                                start: 1.,
                                end: 2.,
                                romaji: Some("shi jie".into()),
                            },
                            Word {
                                text: "Hello".into(),
                                start: 2.,
                                end: 4.,
                                romaji: Some("hello".into()),
                            },
                        ],
                        ..Line::default()
                    },
                    Line {
                        time: 4.,
                        end_time: 8.,
                        text: "下一句歌词 · Second line".into(),
                        translation: "双行显示保持原有顺序".into(),
                        ..Line::default()
                    },
                ],
                ..Snapshot::default()
            };
            let mut renderer = Renderer::new(900, 280, 1., std::env::temp_dir()).unwrap();
            renderer.rebuild(&state, 0, 0).unwrap();
            assert!(renderer.texts.len() >= 8);
            renderer
                .draw(hwnd, &state, 0., true, false, None, true, 1.)
                .unwrap();
            let before = std::slice::from_raw_parts(renderer.surface.bits, 900 * 280 * 4).to_vec();
            renderer
                .draw(hwnd, &state, 1.5, true, false, Some(2), true, 1.)
                .unwrap();
            let pixels = std::slice::from_raw_parts(renderer.surface.bits, 900 * 280 * 4);
            assert!(
                pixels
                    .chunks_exact(4)
                    .all(|p| p[0] <= p[3] && p[1] <= p[3] && p[2] <= p[3]),
                "layered window pixels must be premultiplied"
            );
            assert!(
                pixels.chunks_exact(4).filter(|p| p[3] > 100).count() > 500,
                "text must have non-transparent pixels"
            );
            assert!(
                pixels.iter().zip(&before).filter(|(a, b)| a != b).count() > 100,
                "karaoke fill must animate"
            );
            let mut image = image::RgbaImage::new(900, 280);
            for (pixel, bgra) in image.pixels_mut().zip(pixels.chunks_exact(4)) {
                let alpha = bgra[3] as u32;
                let straight = |v: u8| {
                    if alpha == 0 {
                        0
                    } else {
                        (v as u32 * 255 / alpha).min(255) as u8
                    }
                };
                *pixel = image::Rgba([
                    straight(bgra[2]),
                    straight(bgra[1]),
                    straight(bgra[0]),
                    bgra[3],
                ]);
            }
            let preview = std::env::temp_dir().join("lycia-native-lyrics-smoke.png");
            image.save(&preview).unwrap();
            println!("Native render preview: {}", preview.display());
            assert!(renderer.resize(1350, 420, 1.5).unwrap());
            renderer.rebuild(&state, 0, 1).unwrap();
            renderer
                .draw(hwnd, &state, 4.5, false, false, None, true, 1.)
                .unwrap();
            let mut split = state.clone();
            split.settings.player_alignment = "split-corners".into();
            renderer.rebuild(&split, 0, 0).unwrap();
            let first_y = renderer.texts.first().unwrap().y;
            let last_y = renderer.texts.last().unwrap().y;
            assert!(
                last_y - first_y > 150.,
                "split-corners must separate the groups vertically"
            );
            let fonts =
                std::path::PathBuf::from(std::env::var_os("WINDIR").expect("Windows directory"))
                    .join("Fonts");
            let font_file = fonts.join("segoeui.ttf");
            let mut custom = state.clone();
            custom.settings.player_font_preset = "Lycia imported test alias".into();
            custom.custom_lyrics_fonts = vec![ImportedFont {
                family: custom.settings.player_font_preset.clone(),
                file_path: font_file.to_string_lossy().into_owned(),
            }];
            renderer.custom_dir = fonts;
            renderer.select_font(&custom).unwrap();
            assert!(
                renderer.collection.is_some(),
                "imported fonts need a private DirectWrite collection"
            );
            assert_ne!(
                renderer.family, custom.settings.player_font_preset,
                "CSS aliases must resolve to the font's internal family"
            );
            drop(renderer);
            // Warm DirectWrite's process caches first, then ensure per-window GDI handles return.
            let baseline = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
            for _ in 0..10 {
                let mut renderer = Renderer::new(900, 280, 1., std::env::temp_dir()).unwrap();
                assert!(
                    GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS) >= baseline + 2,
                    "resource probe must see the live DIB/DC"
                );
                renderer.rebuild(&state, 0, 0).unwrap();
                renderer
                    .draw(hwnd, &state, 1.5, false, false, None, true, 1.)
                    .unwrap();
                assert!(renderer.resize(1000, 300, 1.).unwrap());
                renderer.rebuild(&state, 0, 1).unwrap();
                drop(renderer);
            }
            let after = GetGuiResources(GetCurrentProcess(), GR_GDIOBJECTS);
            assert!(
                after <= baseline + 2,
                "GDI resource leak: before={baseline}, after={after}"
            );
            println!(
                "GDI handles after 10 renderer create/resize/drop cycles: {baseline} -> {after}"
            );
            DestroyWindow(hwnd).unwrap();
            CoUninitialize();
        }
    }
}
