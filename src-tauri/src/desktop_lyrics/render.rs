//! Cached DirectWrite layouts drawn into a premultiplied BGRA Direct2D surface.
//! GDI is used only to present that surface to the layered Win32 window.
use super::flow::{self, Cue};
use super::model::*;
use std::{mem::size_of, path::Path, time::Instant};
#[cfg(test)]
use windows::core::w;
use windows::{
    core::{Interface, Result, PCWSTR},
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

/// 顶部工具栏中心在 y=22、半高约 8；留 10px 呼吸区后即歌词正文起点。
const BODY_TOP: f32 = 40.;
/// 歌词正文底部留白；窗口高度按正文实际高度自适应，避免小字号时出现大块空白。
const BODY_BOTTOM_MARGIN: f32 = 12.;

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

fn mix_color(a: D2D1_COLOR_F, b: D2D1_COLOR_F, amount: f32) -> D2D1_COLOR_F {
    let alpha = a.a * amount + b.a * (1. - amount);
    let channel = |x: f32, y: f32| (x * a.a * amount + y * b.a * (1. - amount)) / alpha.max(0.001);
    D2D1_COLOR_F {
        r: channel(a.r, b.r),
        g: channel(a.g, b.g),
        b: channel(a.b, b.b),
        a: alpha,
    }
}

const DESKTOP_BACKGROUND_DARK: &str = "#101018";
const DESKTOP_BACKGROUND_LIGHT: &str = "#ececec";

fn background_alpha(settings: &Settings) -> f32 {
    if settings.background_opacity.is_finite() {
        (settings.background_opacity / 100.).clamp(0., 1.)
    } else {
        0.42
    }
}

/// 背景盒颜色与明暗判断（dark / light / custom）。返回 (颜色, 是否浅色)。
fn background_palette(settings: &Settings) -> (D2D1_COLOR_F, bool) {
    let alpha = background_alpha(settings);
    match settings.background_color_mode.as_str() {
        "light" => (color(DESKTOP_BACKGROUND_LIGHT, alpha), true),
        "custom" => {
            let hex = if css_rgb(settings.custom_background_color.trim()).is_some() {
                settings.custom_background_color.as_str()
            } else {
                DESKTOP_BACKGROUND_DARK
            };
            let rgb = css_rgb(hex).unwrap_or([0.063, 0.063, 0.094]);
            let is_light = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) > 0.62;
            (color(hex, alpha), is_light)
        }
        _ => (color(DESKTOP_BACKGROUND_DARK, alpha), false),
    }
}

/// figma-squircle 同款圆角参数（均匀半径 + preserveSmoothing），与前端
/// taskbarSquircle.ts 使用相同的数学，保证与铃动窗一致的连续曲率。
struct SquircleCorner {
    radius: f32,
    a: f32,
    b: f32,
    c: f32,
    d: f32,
    p: f32,
    arc: f32,
}

fn squircle_corner(radius: f32, smoothing: f32, budget: f32) -> SquircleCorner {
    let p = (1. + smoothing) * radius;
    let arc_measure = 90. * (1. - smoothing);
    let arc = (arc_measure / 2.).to_radians().sin() * radius * std::f32::consts::SQRT_2;
    let angle_alpha = (90. - arc_measure) / 2.;
    let p3_to_p4 = radius * (angle_alpha / 2.).to_radians().tan();
    let angle_beta = 45. * smoothing;
    let c = p3_to_p4 * angle_beta.to_radians().cos();
    let d = c * angle_beta.to_radians().tan();
    let mut b = (p - arc - c - d) / 3.;
    let mut a = 2. * b;
    let mut p = p;
    if p > budget {
        // preserveSmoothing：预算不足时压缩 a/b，保持曲率平滑不被截断。
        let p1_to_p3_max = budget - d - arc - c;
        let min_a = p1_to_p3_max / 6.;
        let max_b = p1_to_p3_max - min_a;
        b = b.min(max_b);
        a = p1_to_p3_max - b;
        p = p.min(budget);
    }
    SquircleCorner {
        radius,
        a,
        b,
        c,
        d,
        p,
        arc,
    }
}

fn bezier(
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    x3: f32,
    y3: f32,
) -> D2D1_BEZIER_SEGMENT {
    D2D1_BEZIER_SEGMENT {
        point1: point(x1, y1),
        point2: point(x2, y2),
        point3: point(x3, y3),
    }
}

fn background_radius(width: f32, height: f32, _scale: f32) -> f32 {
    // 与铃动窗共用同一规则：半径 = 元素高度 × 16/44（44px 小条的 16px 圆角）。
    // height 是物理像素，比例换算后仍是物理像素，无需再乘缩放。
    let radius = height * 16. / 44.;
    radius.min(width.min(height) / 2.).max(0.)
}

fn font_locale(family: &str) -> &'static str {
    // Pan-CJK fonts use the locale for their localized Han glyph substitutions.
    // Honor an explicitly selected regional face, even in fragments without kana.
    let tokens: Vec<_> = family.split(|c: char| !c.is_ascii_alphanumeric()).collect();
    for (region, locale) in [
        ("JP", "ja-JP"),
        ("KR", "ko-KR"),
        ("SC", "zh-CN"),
        ("TC", "zh-TW"),
        ("HK", "zh-HK"),
    ] {
        if tokens
            .iter()
            .any(|token| token.eq_ignore_ascii_case(region))
        {
            return locale;
        }
    }
    "zh-CN"
}

fn shadow_padding(strength: f32) -> f32 {
    (strength.clamp(0., 100.) * 0.24)
        .round()
        .mul_add(3., 3.)
        .max(8.)
}

unsafe fn blurred_shadow(
    target: &ID2D1RenderTarget,
    text: &Text,
    scale: f32,
    bounds: D2D_RECT_F,
    settings: &Settings,
) -> Result<ID2D1Bitmap> {
    let sigma = ((text.shadow.clamp(0., 100.) * 0.24).round() * text.shadow_style.blur_scale)
        .max(0.5)
        * scale;
    // Rasterize beyond each tile before blurring, then crop. Otherwise long lines
    // acquire visible seams where their cached tiles meet.
    let margin = (sigma * 3. + 6. * scale).ceil() as u32 + 2;
    let width = ((bounds.right - bounds.left) * scale).round().max(1.) as u32;
    let height = ((bounds.bottom - bounds.top) * scale).round().max(1.) as u32;
    let source_width = width + 2 * margin;
    let source_height = height + 2 * margin;
    let surface = Surface::new(source_width as i32, source_height as i32)?;
    let raster = target
        .GetFactory()?
        .CreateDCRenderTarget(&D2D1_RENDER_TARGET_PROPERTIES {
            r#type: D2D1_RENDER_TARGET_TYPE_SOFTWARE,
            pixelFormat: D2D1_PIXEL_FORMAT {
                format: DXGI_FORMAT_B8G8R8A8_UNORM,
                alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
            },
            dpiX: 96. * scale,
            dpiY: 96. * scale,
            ..Default::default()
        })?;
    raster.BindDC(
        surface.dc,
        &RECT {
            left: 0,
            top: 0,
            right: source_width as i32,
            bottom: source_height as i32,
        },
    )?;
    raster.SetTextAntialiasMode(D2D1_TEXT_ANTIALIAS_MODE_GRAYSCALE);
    let white = raster.CreateSolidColorBrush(&color("#ffffff", 1.), None)?;
    raster.BeginDraw();
    raster.Clear(Some(&color("#000000", 0.)));
    let origin = point(
        text.x - bounds.left + margin as f32 / scale,
        text.y - bounds.top + margin as f32 / scale,
    );
    if settings.text_stroke_depth > 0. {
        let outline = super::outline::renderer(
            &raster,
            &white,
            settings.text_stroke_depth.clamp(0., 100.) * 0.03,
            scale,
        )?;
        text.layout.Draw(None, &outline, origin.X, origin.Y)?;
    }
    white.SetColor(&color("#ffffff", text.base.a));
    raster.DrawTextLayout(origin, &text.layout, &white, D2D1_DRAW_TEXT_OPTIONS_NONE);
    raster.EndDraw(None, None)?;
    let pixels = std::slice::from_raw_parts(
        surface.bits,
        source_width as usize * source_height as usize * 4,
    );
    let alpha = image::GrayImage::from_raw(
        source_width,
        source_height,
        pixels.chunks_exact(4).map(|pixel| pixel[3]).collect(),
    )
    .unwrap();
    let near = image::imageops::blur(&alpha, 2. * scale);
    let strength = text.shadow.clamp(0., 100.) / 100.;
    // CSS filters run in order: the broad shadow also receives the preceding
    // near shadow. Blurring two independent copies misses that soft outer halo.
    let combined = image::GrayImage::from_fn(source_width, source_height, |x, y| {
        let fill = alpha.get_pixel(x, y)[0] as f32 / 255.;
        let near_y = y.saturating_sub(scale.round() as u32);
        let close =
            near.get_pixel(x, near_y)[0] as f32 / 255. * strength * text.shadow_style.near_alpha;
        image::Luma([((fill + close * (1. - fill)) * 255.).round() as u8])
    });
    let soft = image::imageops::blur(&combined, sigma);
    let rgb = css_rgb(&settings.text_shadow_color).unwrap_or([0., 0., 0.]);
    let mut bgra = Vec::with_capacity(width as usize * height as usize * 4);
    for y in 0..height {
        for x in 0..width {
            let broad = soft.get_pixel(x + margin, y + margin)[0] as f32 / 255.
                * strength
                * text.shadow_style.far_alpha;
            let close_y = (y + margin).saturating_sub(scale.round() as u32);
            let close = near.get_pixel(x + margin, close_y)[0] as f32 / 255.
                * strength
                * text.shadow_style.near_alpha;
            let a = (1. - (1. - broad) * (1. - close)) * 255.;
            bgra.extend_from_slice(&[
                (rgb[2] * a).round() as u8,
                (rgb[1] * a).round() as u8,
                (rgb[0] * a).round() as u8,
                a.round() as u8,
            ]);
        }
    }
    target.CreateBitmap(
        D2D_SIZE_U { width, height },
        Some(bgra.as_ptr().cast()),
        width * 4,
        &D2D1_BITMAP_PROPERTIES {
            pixelFormat: D2D1_PIXEL_FORMAT {
                format: DXGI_FORMAT_B8G8R8A8_UNORM,
                alphaMode: D2D1_ALPHA_MODE_PREMULTIPLIED,
            },
            dpiX: 96. * scale,
            dpiY: 96. * scale,
        },
    )
}

unsafe fn text_baseline(layout: &IDWriteTextLayout) -> Result<f32> {
    // Each timed fragment has its own fallback font runs. Its layout origin is
    // therefore not a shared baseline, even when every fragment uses one size.
    let mut metrics = [DWRITE_LINE_METRICS::default()];
    let mut count = 0;
    layout.GetLineMetrics(Some(&mut metrics), &mut count)?;
    Ok(metrics[0].baseline)
}

struct Surface {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
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

#[derive(Clone, Copy)]
struct ShadowStyle {
    blur_scale: f32,
    near_alpha: f32,
    far_alpha: f32,
}
impl ShadowStyle {
    const MAIN: Self = Self {
        blur_scale: 1.,
        near_alpha: 0.55,
        far_alpha: 1.,
    };
    const NEXT: Self = Self {
        blur_scale: 1.,
        near_alpha: 0.48,
        far_alpha: 0.86,
    };
    const ROMAJI: Self = Self {
        blur_scale: 0.86,
        near_alpha: 0.48,
        far_alpha: 0.86,
    };
    const TRANSLATION: Self = Self {
        blur_scale: 0.82,
        near_alpha: 0.48,
        far_alpha: 0.82,
    };
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
    shadow_style: ShadowStyle,
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
    opacity: f32,
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

#[derive(Clone)]
struct Row {
    index: usize,
    lanes: std::ops::Range<usize>,
    top: f32,
    height: f32,
    anchor_x: f32,
    font_size: f32,
}

struct CachedLyrics {
    texts: Vec<Text>,
    lanes: Vec<Lane>,
    glyph_tiles: Vec<(usize, GlyphMask)>,
}

struct Transition {
    started: Instant,
    previous: CachedLyrics,
    outgoing: Row,
    frozen_time: f64,
    promotion_scale: f32,
    promotion_x: f32,
    promotion_y: f32,
    outgoing_distance: f32,
    incoming_distance: f32,
}

#[derive(Clone, Copy)]
struct Placement {
    scale: f32,
    x: f32,
    y: f32,
    opacity: f32,
}
impl Default for Placement {
    fn default() -> Self {
        Self {
            scale: 1.,
            x: 0.,
            y: 0.,
            opacity: 1.,
        }
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
        let pad = shadow_padding(text.shadow);
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
                let shadow = blurred_shadow(target, text, scale, bounds, settings)?;
                decoration_target.DrawBitmap(
                    &shadow,
                    Some(&rect(0., 0., size.width, size.height)),
                    1.,
                    D2D1_BITMAP_INTERPOLATION_MODE_LINEAR,
                    None,
                );
            }
            if let Some(outline) = &outline {
                brush.SetColor(&color(&settings.text_stroke_color, 1.));
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
    rows: Vec<Row>,
    glyph_tiles: Vec<(usize, GlyphMask)>,
    transition: Option<Transition>,
    /// 当前歌曲+设置下所需窗口高度的高水位（逻辑像素）。
    /// 同一首歌内只增不减，避免换句时窗口反复伸缩导致闪烁。
    desired_height: Option<f32>,
    /// desired_height 对应的歌曲与设置签名；变化时重新起算高水位。
    height_signature: String,
    showing_interlude: bool,
    fade_brushes: Vec<ID2D1Brush>,
    fade_layer: ID2D1Layer,
    /// 圆角背景路径缓存，键为 (物理宽, 物理高, 缩放千分位)。
    background_geometry: Option<(f32, f32, f32, ID2D1PathGeometry)>,
    font_key: String,
    family: String,
    weight: Option<DWRITE_FONT_WEIGHT>,
    style: DWRITE_FONT_STYLE,
    stretch: DWRITE_FONT_STRETCH,
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
            rows: vec![],
            glyph_tiles: vec![],
            transition: None,
            desired_height: None,
            height_signature: String::new(),
            showing_interlude: false,
            fade_brushes: vec![],
            fade_layer,
            background_geometry: None,
            font_key: String::new(),
            family: "Segoe UI".into(),
            weight: None,
            style: DWRITE_FONT_STYLE_NORMAL,
            stretch: DWRITE_FONT_STRETCH_NORMAL,
            collection: None,
            custom_dir,
        })
    }

    pub unsafe fn resize(&mut self, width: i32, height: i32, scale: f32) -> Result<bool> {
        if (width, height, scale) == (self.width, self.height, self.scale) {
            return Ok(false);
        }
        self.cancel_transition();
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
        self.background_geometry = None;
        Ok(true)
    }

    /// 连续曲率（squircle）背景路径，逻辑坐标系与目标变换一致；按窗口尺寸缓存。
    unsafe fn background_geometry(
        &mut self,
        width: f32,
        height: f32,
        radius: f32,
    ) -> Result<ID2D1PathGeometry> {
        // key 必须包含 radius：圆角矩形 ↔ 胶囊圆形只改半径，尺寸不变时
        // 若按 (宽, 高, 缩放) 缓存会复用旧几何，导致切换形状毫无变化。
        let key = (width, height, radius);
        if let Some((kw, kh, kradius, geometry)) = &self.background_geometry {
            if (*kw, *kh, *kradius) == key {
                return Ok(geometry.clone());
            }
        }
        let factory: ID2D1Factory = self.target.GetFactory()?;
        let geometry = factory.CreatePathGeometry()?;
        let sink = geometry.Open()?;
        let budget = width.min(height) / 2.;
        let r = radius.min(budget).max(0.);
        if r > 0. {
            let cp = squircle_corner(r, 0.6, budget);
            // 顶边起点 → 右上角 → 右边 → 右下角 → 底边 → 左下角 → 左边 → 左上角 → 闭合。
            sink.BeginFigure(point(cp.p, 0.), D2D1_FIGURE_BEGIN_FILLED);

            // 右上角
            sink.AddBezier(&bezier(
                width - cp.p + cp.a,
                0.,
                width - cp.p + cp.a + cp.b,
                0.,
                width - cp.p + cp.a + cp.b + cp.c,
                cp.d,
            ));
            sink.AddArc(&D2D1_ARC_SEGMENT {
                point: point(width - cp.p + cp.a + cp.b + cp.c + cp.arc, cp.d + cp.arc),
                size: D2D_SIZE_F {
                    width: cp.radius,
                    height: cp.radius,
                },
                rotationAngle: 0.,
                sweepDirection: D2D1_SWEEP_DIRECTION_CLOCKWISE,
                arcSize: D2D1_ARC_SIZE_SMALL,
            });
            sink.AddBezier(&bezier(
                width - cp.p + cp.a + cp.b + cp.c + cp.arc + cp.d,
                cp.d + cp.arc + cp.c,
                width - cp.p + cp.a + cp.b + cp.c + cp.arc + cp.d,
                cp.d + cp.arc + cp.b + cp.c,
                width,
                cp.p,
            ));

            // 右下角
            sink.AddLine(point(width, height - cp.p));
            sink.AddBezier(&bezier(
                width,
                height - cp.p + cp.a,
                width,
                height - cp.p + cp.a + cp.b,
                width - cp.d,
                height - cp.p + cp.a + cp.b + cp.c,
            ));
            sink.AddArc(&D2D1_ARC_SEGMENT {
                point: point(width - cp.d - cp.arc, height - cp.p + cp.a + cp.b + cp.c + cp.arc),
                size: D2D_SIZE_F {
                    width: cp.radius,
                    height: cp.radius,
                },
                rotationAngle: 0.,
                sweepDirection: D2D1_SWEEP_DIRECTION_CLOCKWISE,
                arcSize: D2D1_ARC_SIZE_SMALL,
            });
            sink.AddBezier(&bezier(
                width - cp.d - cp.arc - cp.c,
                height - cp.p + cp.a + cp.b + cp.c + cp.arc + cp.d,
                width - cp.d - cp.arc - cp.b - cp.c,
                height - cp.p + cp.a + cp.b + cp.c + cp.arc + cp.d,
                width - cp.p,
                height,
            ));

            // 左下角
            sink.AddLine(point(cp.p, height));
            sink.AddBezier(&bezier(
                cp.p - cp.a,
                height,
                cp.p - cp.a - cp.b,
                height,
                cp.p - cp.a - cp.b - cp.c,
                height - cp.d,
            ));
            sink.AddArc(&D2D1_ARC_SEGMENT {
                point: point(cp.p - cp.a - cp.b - cp.c - cp.arc, height - cp.d - cp.arc),
                size: D2D_SIZE_F {
                    width: cp.radius,
                    height: cp.radius,
                },
                rotationAngle: 0.,
                sweepDirection: D2D1_SWEEP_DIRECTION_CLOCKWISE,
                arcSize: D2D1_ARC_SIZE_SMALL,
            });
            sink.AddBezier(&bezier(
                cp.p - cp.a - cp.b - cp.c - cp.arc - cp.d,
                height - cp.d - cp.arc - cp.c,
                cp.p - cp.a - cp.b - cp.c - cp.arc - cp.d,
                height - cp.d - cp.arc - cp.b - cp.c,
                0.,
                height - cp.p,
            ));

            // 左上角
            sink.AddLine(point(0., cp.p));
            sink.AddBezier(&bezier(
                0.,
                cp.p - cp.a,
                0.,
                cp.p - cp.a - cp.b,
                cp.d,
                cp.p - cp.a - cp.b - cp.c,
            ));
            sink.AddArc(&D2D1_ARC_SEGMENT {
                point: point(cp.d + cp.arc, cp.p - cp.a - cp.b - cp.c - cp.arc),
                size: D2D_SIZE_F {
                    width: cp.radius,
                    height: cp.radius,
                },
                rotationAngle: 0.,
                sweepDirection: D2D1_SWEEP_DIRECTION_CLOCKWISE,
                arcSize: D2D1_ARC_SIZE_SMALL,
            });
            sink.AddBezier(&bezier(
                cp.d + cp.arc + cp.c,
                cp.p - cp.a - cp.b - cp.c - cp.arc - cp.d,
                cp.d + cp.arc + cp.b + cp.c,
                cp.p - cp.a - cp.b - cp.c - cp.arc - cp.d,
                cp.p,
                0.,
            ));

            sink.EndFigure(D2D1_FIGURE_END_CLOSED);
        } else {
            sink.BeginFigure(point(0., 0.), D2D1_FIGURE_BEGIN_FILLED);
            sink.AddLine(point(width, 0.));
            sink.AddLine(point(width, height));
            sink.AddLine(point(0., height));
            sink.EndFigure(D2D1_FIGURE_END_CLOSED);
        }
        sink.Close()?;
        self.background_geometry = Some((key.0, key.1, key.2, geometry.clone()));
        Ok(geometry)
    }

    /// 背景盒：形状（连续曲率圆角 / 胶囊圆形 / 方形）、颜色与不透明度均由设置驱动。
    unsafe fn paint_background(
        &mut self,
        width: f32,
        height: f32,
        settings: &Settings,
    ) -> Result<()> {
        let (bg, _) = background_palette(settings);
        if bg.a <= 0. {
            return Ok(());
        }
        self.brush.SetColor(&bg);
        if settings.background_shape == "square" {
            self.target.FillRectangle(&rect(0., 0., width, height), &self.brush);
            return Ok(());
        }
        // 胶囊圆形：半径取半高（两端半圆、连续曲率），与铃动窗的胶囊一致。
        let radius = if settings.background_shape == "pill" {
            (height / 2.).max(0.)
        } else {
            background_radius(width, height, self.scale)
        };
        if radius <= 0. {
            self.target.FillRectangle(&rect(0., 0., width, height), &self.brush);
            return Ok(());
        }
        // SAFETY: D2D geometry creation on the render thread only.
        let geometry = unsafe { self.background_geometry(width, height, radius)? };
        self.target.FillGeometry(&geometry, &self.brush, None);
        Ok(())
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
        self.weight = None;
        self.style = DWRITE_FONT_STYLE_NORMAL;
        self.stretch = DWRITE_FONT_STRETCH_NORMAL;
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
        } else {
            let mut system = None;
            self.write.GetSystemFontCollection(&mut system, true)?;
            let system = system.unwrap();
            let name = wide(&self.family);
            let mut index = 0;
            let mut exists = windows::core::BOOL(0);
            system.FindFamilyName(PCWSTR(name.as_ptr()), &mut index, &mut exists)?;
            if !exists.as_bool() {
                // The picker also exposes full face names (e.g. "Arial Bold").
                // CreateTextFormat only accepts family names, so resolve the face first.
                let factory: IDWriteFactory3 = self.write.cast()?;
                let fonts = factory.GetSystemFontSet()?;
                for property in [
                    DWRITE_FONT_PROPERTY_ID_FULL_NAME,
                    DWRITE_FONT_PROPERTY_ID_WIN32_FAMILY_NAME,
                    DWRITE_FONT_PROPERTY_ID_POSTSCRIPT_NAME,
                ] {
                    let matching = fonts.GetMatchingFonts2(&[DWRITE_FONT_PROPERTY {
                        propertyId: property,
                        propertyValue: PCWSTR(name.as_ptr()),
                        localeName: PCWSTR::null(),
                    }])?;
                    if matching.GetFontCount() == 0 {
                        continue;
                    }
                    let collection: IDWriteFontCollection =
                        factory.CreateFontCollectionFromFontSet(&matching)?.cast()?;
                    let family = collection.GetFontFamily(0)?;
                    let names = family.GetFamilyNames()?;
                    let mut value = vec![0; names.GetStringLength(0)? as usize + 1];
                    names.GetString(0, &mut value)?;
                    self.family = String::from_utf16_lossy(&value[..value.len() - 1]);
                    let face = family.GetFont(0)?;
                    self.weight = Some(face.GetWeight());
                    self.style = face.GetStyle();
                    self.stretch = face.GetStretch();
                    self.collection = Some(collection);
                    break;
                }
            }
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
        weight: DWRITE_FONT_WEIGHT,
    ) -> Result<(IDWriteTextLayout, f32, f32)> {
        let family = wide(&self.family);
        let locale = wide(font_locale(&self.family));
        let format = self.write.CreateTextFormat(
            PCWSTR(family.as_ptr()),
            self.collection.as_ref(),
            self.weight.unwrap_or(weight),
            self.style,
            self.stretch,
            size,
            PCWSTR(locale.as_ptr()),
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

    pub unsafe fn rebuild(&mut self, state: &Snapshot, active: usize) -> Result<()> {
        self.cancel_transition();
        self.rebuild_fitted(state, active, 1., 0)
    }

    /// 最近一次完整字号排版所需的逻辑窗口高度（含工具栏与底部留白）。
    pub fn pending_height(&self) -> Option<f32> {
        self.desired_height
    }

    pub fn cancel_transition(&mut self) {
        self.transition = None;
    }

    /// Remains true until draw presents the final frame, including while playback is paused.
    pub fn has_transition(&self) -> bool {
        self.transition.is_some()
    }

    pub unsafe fn transition_to(&mut self, state: &Snapshot, active: usize) -> Result<()> {
        // A second cue during a short transition starts from the previous target layout;
        // keep only one old layout rather than accumulating historical glyph caches.
        self.cancel_transition();
        let continuous = !self.showing_interlude
            && state.settings.show_double_line
            && self.rows.len() == 2
            && self.rows[1].index == active
            && self.rows.iter().all(|row| {
                state
                    .parsed_lyrics
                    .get(row.index)
                    .is_some_and(|line| !line.text.trim().is_empty())
            });
        if !continuous {
            return self.rebuild(state, active);
        }
        let outgoing = self.rows[0].clone();
        let preview = self.rows[1].clone();
        let mut previous = CachedLyrics {
            texts: std::mem::take(&mut self.texts),
            lanes: std::mem::take(&mut self.lanes),
            glyph_tiles: std::mem::take(&mut self.glyph_tiles),
        };
        // Only the departing sentence needs historical tiles. The promoted sentence
        // is drawn from the new cache at its interpolated size and position.
        let outgoing_end = previous.lanes[outgoing.lanes.end - 1].range.end;
        previous.texts.truncate(outgoing_end);
        previous.lanes.truncate(outgoing.lanes.end);
        previous
            .glyph_tiles
            .retain(|(index, _)| *index < outgoing_end);
        self.rebuild(state, active)?;
        let Some(current) = self.rows.first() else {
            return Ok(());
        };
        // Promote the preview as one group, smoothly increasing its font size as well
        // as moving its main text, aligned romanization and translation together.
        let promotion_scale = preview.font_size / current.font_size.max(0.001);
        self.transition = Some(Transition {
            started: Instant::now(),
            frozen_time: state.parsed_lyrics[active].time,
            promotion_x: preview.anchor_x - current.anchor_x * promotion_scale,
            promotion_y: preview.top - current.top * promotion_scale,
            promotion_scale,
            outgoing_distance: (outgoing.top + outgoing.height - BODY_TOP).max(0.) + 8.,
            incoming_distance: self.rows.get(1).map_or(0., |row| {
                (self.height as f32 / self.scale - BODY_BOTTOM_MARGIN - row.top + 8.).max(row.height + 8.)
            }),
            previous,
            outgoing,
        });
        Ok(())
    }

    unsafe fn rebuild_fitted(
        &mut self,
        state: &Snapshot,
        active: usize,
        vertical_scale: f32,
        attempt: u8,
    ) -> Result<()> {
        if let Err(error) = self.select_font(state) {
            // Missing/deleted custom fonts should not make the lyrics window unusable.
            eprintln!("Native lyrics font unavailable, using Segoe UI: {error}");
            self.family = "Segoe UI".into();
            self.collection = None;
            self.weight = None;
            self.style = DWRITE_FONT_STYLE_NORMAL;
            self.stretch = DWRITE_FONT_STRETCH_NORMAL;
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
        self.rows.clear();
        self.glyph_tiles.clear();
        self.fade_brushes.clear();
        let s = &state.settings;
        let width = self.width as f32 / self.scale;
        let height = self.height as f32 / self.scale;
        let available = (width - 48.).max(1.);
        let scale = s.player_font_scale.clamp(0.5, 2.) * vertical_scale;
        let gap_ratio = s.player_line_gap.clamp(0.5, 2.);
        let gap = gap_ratio * vertical_scale;
        let wrap = s.overflow_mode == "wrap";
        let alpha = s.text_opacity.clamp(0., 1.);
        let theme_colors: Vec<_> = state
            .theme_colors
            .iter()
            .filter(|c| css_rgb(c).is_some())
            .collect();
        let palette = match s.color_scheme.as_str() {
            "pink" => ["#f472b6", "#fb7185", "#f9a8d4", "#fbcfe8"],
            "blue" => ["#60a5fa", "#38bdf8", "#93c5fd", "#bfdbfe"],
            "green" => ["#34d399", "#22c55e", "#6ee7b7", "#bbf7d0"],
            "white" => ["#ffffff", "#f3f4f6", "#d1d5db", "#9ca3af"],
            "default" => ["#EC4141", "#ff8364", "#f7b267", "#ffd166"],
            "custom" => [
                s.custom_played_color.as_str(),
                s.custom_romaji_played_color.as_str(),
                s.custom_translation_color.as_str(),
                s.custom_unplayed_color.as_str(),
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
                theme_colors
                    .get(3)
                    .or(theme_colors.last())
                    .map(|c| c.as_str())
                    .unwrap_or("#ffe07d"),
            ],
        };
        let mut y = 0.;
        let mut row_ranges = Vec::new();
        for (visible_row, index) in
            visible_line_indices(&state.parsed_lyrics, active, s.show_double_line)
                .into_iter()
                .enumerate()
        {
            let line_start = self.texts.len();
            let lane_start = self.lanes.len();
            let line_top = y;
            let line = &state.parsed_lyrics[index];
            let is_active = index == active;
            let row_opacity = alpha * if is_active { 1. } else { 0.74 };
            let main_weight = if is_active {
                DWRITE_FONT_WEIGHT_BOLD
            } else {
                DWRITE_FONT_WEIGHT(650)
            };
            let shadow_style = if is_active {
                ShadowStyle::MAIN
            } else {
                ShadowStyle::NEXT
            };
            // 固定基准字号：原先按窗口高度取值会与高度自适应形成正反馈，
            // 换句重排时字号随高度变化 → 所需高度再变 → 窗口持续伸缩闪烁。
            let mut font_size = if is_active { 26. } else { 20. } * scale;
            let sub_size = 14. * scale;
            let shadow = if is_active {
                s.first_line_text_shadow_strength
            } else {
                s.second_line_text_shadow_strength
            };
            let played = color(palette[0], 1.);
            let base = color(
                if s.color_scheme == "custom" {
                    &s.custom_unplayed_color
                } else {
                    "#ffffff"
                },
                if s.color_scheme == "custom" { 1. } else { 0.98 },
            );
            let roman_base = if s.color_scheme == "custom" {
                color(&s.custom_romaji_unplayed_color, 1.)
            } else {
                mix_color(color(palette[3], 1.), color("#ffffff", 0.88), 0.42)
            };
            let roman_played = if s.color_scheme == "custom" {
                color(&s.custom_romaji_played_color, 1.)
            } else {
                mix_color(color(palette[1], 1.), roman_base, 0.58)
            };
            let words = display_words(state, index);
            let relevant: Vec<_> = words.iter().filter(|w| !w.text.trim().is_empty()).collect();
            let aligned = s.show_romaji
                && !relevant.is_empty()
                && relevant
                    .iter()
                    .all(|w| w.romaji.as_ref().is_some_and(|r| !r.trim().is_empty()));
            let mut widths = Vec::new();
            if words.is_empty() {
                let measured = self
                    .layout(&line.text, font_size, available, false, main_weight)?
                    .1;
                if wrap {
                    widths.extend([measured / 2.; 2]);
                } else {
                    widths.push(measured);
                }
            } else {
                for word in &words {
                    let mut w = self
                        .layout(&word.text, font_size, available, false, main_weight)?
                        .1;
                    if aligned {
                        w = w.max(
                            self.layout(
                                word.romaji.as_deref().unwrap_or(""),
                                font_size * 0.46,
                                available,
                                false,
                                DWRITE_FONT_WEIGHT(650),
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
                if visible_row == 0 {
                    "left"
                } else {
                    "right"
                }
            } else {
                &s.player_alignment
            };
            if words.is_empty() {
                let (layout, w, h) =
                    self.layout(&line.text, font_size, available, wrap, main_weight)?;
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
                    shadow_style,
                });
                if !wrap {
                    align_row(&mut self.texts[main_start..], available, w, alignment);
                }
                main_width = if wrap { available } else { w };
                y += h;
            } else {
                // Keep words and their aligned romanization in the same horizontal cell.
                // Align both text tiers by measured baselines, not layout tops: a
                // fallback run or trailing space can change one fragment's ascent.
                let mut shaped_words = Vec::with_capacity(words.len());
                let mut main_baseline: f32 = 0.;
                let mut main_descent: f32 = 0.;
                let mut roman_baseline: f32 = 0.;
                let mut roman_descent: f32 = 0.;
                for word in words {
                    let main = self.layout(&word.text, font_size, available, false, main_weight)?;
                    let baseline = text_baseline(&main.0)?;
                    main_baseline = main_baseline.max(baseline);
                    main_descent = main_descent.max(main.2 - baseline);
                    let roman = if aligned {
                        let (layout, w, h) = self.layout(
                            word.romaji.as_deref().unwrap_or(""),
                            font_size * 0.46,
                            available,
                            false,
                            DWRITE_FONT_WEIGHT(650),
                        )?;
                        let baseline = text_baseline(&layout)?;
                        roman_baseline = roman_baseline.max(baseline);
                        roman_descent = roman_descent.max(h - baseline);
                        Some((layout, w, h, baseline))
                    } else {
                        None
                    };
                    shaped_words.push((word, main, baseline, roman));
                }
                let main_height = main_baseline + main_descent;
                let roman_height = roman_baseline + roman_descent;
                let mut x = 0.;
                let row_height = main_height + roman_height;
                let mut row_start = self.texts.len();
                for (word, (layout, w, h), baseline, roman) in shaped_words {
                    let cell_width = w.max(roman.as_ref().map(|r| r.1).unwrap_or(0.));
                    if wrap && x > 0. && x + cell_width > available {
                        align_row(&mut self.texts[row_start..], available, x, alignment);
                        y += row_height;
                        x = 0.;
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
                                    color: color(palette[1], 1.),
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
                        y: y + main_baseline - baseline,
                        width: w,
                        height: h,
                        timing,
                        gradient,
                        base,
                        played,
                        shadow,
                        shadow_style,
                    });
                    if let Some((layout, w, h2, baseline)) = roman {
                        self.texts.push(Text {
                            layout,
                            x: x + (cell_width - w) / 2.,
                            y: y + main_height + roman_baseline - baseline,
                            width: w,
                            height: h2,
                            timing,
                            gradient: None,
                            base: roman_base,
                            played: roman_played,
                            shadow,
                            shadow_style: ShadowStyle::ROMAJI,
                        });
                    }
                    x += cell_width;
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
                opacity: row_opacity,
            });
            for (text, roman) in [(&line.romaji, true), (&line.translation, false)] {
                if text.is_empty()
                    || (roman && (!s.show_romaji || aligned))
                    || (!roman && !s.show_translation)
                {
                    continue;
                }
                y += 2. * gap;
                let weight = if roman {
                    DWRITE_FONT_WEIGHT(650)
                } else {
                    DWRITE_FONT_WEIGHT_NORMAL
                };
                let natural_width = self.layout(text, sub_size, available, false, weight)?.1;
                let fitted = if wrap {
                    (available * 2. / natural_width.max(1.)).min(1.) * 0.999
                } else {
                    flow::width_scale(&[natural_width], available, false)
                };
                let (layout, w, h) =
                    self.layout(text, sub_size * fitted, available, wrap, weight)?;
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
                        if s.color_scheme == "custom" {
                            color(&s.custom_translation_color, 1.)
                        } else {
                            mix_color(color(palette[2], 1.), color("#ffffff", 0.76), 0.28)
                        }
                    },
                    played: roman_played,
                    gradient: None,
                    shadow,
                    shadow_style: if roman {
                        ShadowStyle::ROMAJI
                    } else {
                        ShadowStyle::TRANSLATION
                    },
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
                    opacity: row_opacity,
                });
                y += h;
            }
            row_ranges.push((line_start, self.texts.len(), line_top, y - line_top));
            self.rows.push(Row {
                index,
                lanes: lane_start..self.lanes.len(),
                top: line_top,
                height: y - line_top,
                anchor_x: 0.,
                font_size,
            });
            // 100% 行距为默认最小间距；200% 时两行之间留出约一整行歌词的距离。
            // 额外间距按活动行字号计算，因此随字号线性变化。
            y += 3.52 * gap + (gap_ratio - 1.).max(0.) * font_size;
        }
        if self.texts.is_empty() {
            let text = match state.lyrics_status.as_str() {
                "loading" => "Loading lyrics...",
                "error" => "Lyrics unavailable",
                _ => &state.fallback_text,
            };
            let (layout, w, h) =
                self.layout(text, 18. * scale, available, true, DWRITE_FONT_WEIGHT_BOLD)?;
            layout.SetTextAlignment(DWRITE_TEXT_ALIGNMENT_CENTER)?;
            self.texts.push(Text {
                layout,
                x: 0.,
                y: 0.,
                width: w,
                height: h,
                timing: None,
                gradient: None,
                base: color("#ffffff", 1.),
                played: color("#ffffff", 1.),
                shadow: s.first_line_text_shadow_strength,
                shadow_style: ShadowStyle::MAIN,
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
                opacity: alpha,
            });
        }
        let body_top = BODY_TOP;
        let body_bottom = (height - BODY_BOTTOM_MARGIN).max(body_top + 1.);
        let body_height = body_bottom - body_top;
        if attempt == 0 {
            // 只在「歌曲或影响排版的设置」变化时重新起算，其余换句重排沿用
            // 高水位：只增高不收缩，彻底避免逐句换行的窗口伸缩与背景闪烁。
            let signature = format!(
                "{:.3}|{:.3}|{}|{}|{}|{}|{}|{:.2}|{}",
                s.player_font_scale,
                s.player_line_gap,
                s.show_double_line,
                s.show_romaji,
                s.show_translation,
                s.player_alignment,
                width,
                scale,
                state.song.as_ref().map(|song| song.path.as_str()).unwrap_or(""),
            );
            let measured = y + BODY_TOP + BODY_BOTTOM_MARGIN;
            if self.height_signature != signature {
                self.height_signature = signature;
                self.desired_height = Some(measured);
            } else {
                self.desired_height = Some(self.desired_height.unwrap_or(0.).max(measured));
            }
        }
        if y > body_height && attempt < 4 {
            return self.rebuild_fitted(
                state,
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
        for row in &mut self.rows {
            let first = &self.lanes[row.lanes.start];
            let last = &self.lanes[row.lanes.end - 1];
            let texts = &self.texts[first.range.start..last.range.end];
            row.top = texts
                .iter()
                .map(|text| text.y)
                .fold(f32::INFINITY, f32::min);
            row.height = texts
                .iter()
                .map(|text| text.y + text.height)
                .fold(row.top, f32::max)
                - row.top;
            row.anchor_x = self.texts[first.range.clone()]
                .iter()
                .map(|text| text.x)
                .fold(f32::INFINITY, f32::min);
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
        &mut self,
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
        let interlude = interlude_range(state, time);
        self.showing_interlude = interlude.is_some();
        if self.showing_interlude {
            // Do not bring a finished lyric back as an outgoing row after waiting.
            self.cancel_transition();
        }
        let transition_progress = self
            .transition
            .as_ref()
            .map(|transition| (transition.started.elapsed().as_secs_f32() / 0.36).min(1.));
        self.target.BeginDraw();
        // 背景盒的形状/颜色/不透明度由设置驱动，先铺背景再画歌词。
        // Alpha 1/255 keeps the unlocked transparent surface draggable without a visible box.
        self.target.Clear(Some(&color(
            "#101018",
            if surface {
                0.
            } else if state.settings.is_locked {
                0.
            } else {
                1. / 255.
            },
        )));
        self.target
            .SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
        // 背景盒不再描边：外圈细线在深色/浅色封面上都会显得突兀，用户要求只留底色。
        let border: Option<(D2D1_COLOR_F, bool)> = None;
        if surface {
            let (bg, _is_light) = background_palette(&state.settings);
            if bg.a > 0. {
                self.paint_background(width, height, &state.settings)?;
            }
        }
        if let Some((start, end)) = interlude {
            self.paint_interlude(state, time, start, end);
        } else {
            self.paint_lyrics(time, transition_progress);
        }
        if let Some((border_color, rounded)) = border {
            self.brush.SetColor(&border_color);
            if rounded {
                let radius = background_radius(width, height, self.scale);
                let geometry = self.background_geometry(width, height, radius)?;
                self.target.DrawGeometry(&geometry, &self.brush, 1., None);
            } else {
                self.target.DrawRectangle(
                    &rect(0.5, 0.5, width - 1., height - 1.),
                    &self.brush,
                    1.,
                    None,
                );
            }
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
        )?;
        if transition_progress.is_some_and(|progress| progress >= 1.) {
            self.cancel_transition();
        }
        Ok(())
    }

    unsafe fn paint_interlude(&self, state: &Snapshot, time: f64, start: f64, end: f64) {
        let settings = &state.settings;
        let dot_color = if settings.color_scheme == "custom" {
            settings.custom_unplayed_color.as_str()
        } else {
            "#ffffff"
        };
        let width = self.width as f32 / self.scale;
        let height = self.height as f32 / self.scale;
        let scale = settings.player_font_scale.clamp(0.5, 2.);
        let radius = (4.2 * scale).min((width - 48.).max(1.) / 8.4);
        let step = radius * 3.2;
        let used = step * 2. + radius * 2.;
        let available = (width - 48.).max(used);
        let x = match settings.player_alignment.as_str() {
            "left" | "split-corners" => 0.,
            "right" => available - used,
            _ => (available - used) / 2.,
        };
        let x = (x + width * settings.player_offset_x.clamp(-100., 100.) / 100.)
            .clamp(0., (available - used).max(0.))
            + 24.
            + radius;
        let y = ((BODY_TOP + height - BODY_BOTTOM_MARGIN) / 2.
            + height * settings.player_offset_y.clamp(-100., 100.) / 100.)
            .clamp(BODY_TOP + radius, (height - BODY_BOTTOM_MARGIN - radius).max(BODY_TOP + radius));
        let elapsed = (time - start).max(0.) as f32;
        let completion = progress(start, end, time);
        self.target
            .SetAntialiasMode(D2D1_ANTIALIAS_MODE_PER_PRIMITIVE);
        for index in 0..3 {
            // Media time drives every dot, so pause freezes the waiting indicator
            // together with word progress, and seeking restores the same phase.
            let breath =
                ((elapsed * std::f32::consts::TAU / 1.6 - index as f32 * 0.8).sin() + 1.) / 2.;
            let filled = (completion * 3. - index as f32).clamp(0., 1.);
            self.brush.SetColor(&color(
                dot_color,
                settings.text_opacity.clamp(0., 1.) * (0.42 + 0.28 * breath + 0.3 * filled),
            ));
            let size = radius * (0.86 + breath * 0.14);
            self.target.FillEllipse(
                &D2D1_ELLIPSE {
                    point: point(x + step * index as f32, y),
                    radiusX: size,
                    radiusY: size,
                },
                &self.brush,
            );
        }
    }

    unsafe fn paint_lyrics(&self, time: f64, transition_progress: Option<f32>) {
        let width = self.width as f32 / self.scale;
        let height = self.height as f32 / self.scale;
        // Keep animated sentence groups inside the lyric body; the toolbar is painted
        // separately after this fixed clip is removed.
        self.target.PushAxisAlignedClip(
            &rect(24., BODY_TOP, (width - 48.).max(1.), (height - BODY_TOP - BODY_BOTTOM_MARGIN).max(1.)),
            D2D1_ANTIALIAS_MODE_ALIASED,
        );
        if let Some((transition, progress)) = self
            .transition
            .as_ref()
            .zip(transition_progress)
            .filter(|(_, progress)| *progress < 1.)
        {
            let eased = 1. - (1. - progress).powi(3);
            let remaining = 1. - eased;
            self.paint_lanes(
                &transition.previous.texts,
                &transition.previous.lanes,
                &transition.previous.glyph_tiles,
                transition.outgoing.lanes.clone(),
                transition.frozen_time,
                Placement {
                    y: -transition.outgoing_distance * eased,
                    opacity: remaining,
                    ..Default::default()
                },
            );
            if let Some(current) = self.rows.first() {
                self.paint_lanes(
                    &self.texts,
                    &self.lanes,
                    &self.glyph_tiles,
                    current.lanes.clone(),
                    time,
                    Placement {
                        scale: 1. + (transition.promotion_scale - 1.) * remaining,
                        x: transition.promotion_x * remaining,
                        y: transition.promotion_y * remaining,
                        opacity: 0.74 + 0.26 * eased,
                    },
                );
            }
            if let Some(preview) = self.rows.get(1) {
                self.paint_lanes(
                    &self.texts,
                    &self.lanes,
                    &self.glyph_tiles,
                    preview.lanes.clone(),
                    time,
                    Placement {
                        y: transition.incoming_distance * remaining,
                        opacity: eased,
                        ..Default::default()
                    },
                );
            }
        } else {
            self.paint_lanes(
                &self.texts,
                &self.lanes,
                &self.glyph_tiles,
                0..self.lanes.len(),
                time,
                Placement::default(),
            );
        }
        self.target.PopAxisAlignedClip();
    }

    unsafe fn paint_lanes(
        &self,
        texts: &[Text],
        lanes: &[Lane],
        glyph_tiles: &[(usize, GlyphMask)],
        range: std::ops::Range<usize>,
        time: f64,
        placement: Placement,
    ) {
        use std::mem::ManuallyDrop;
        if placement.opacity <= 0. {
            return;
        }
        let available = (self.width as f32 / self.scale - 48.).max(1.);
        let identity = Matrix3x2 {
            M11: 1.,
            M22: 1.,
            ..Default::default()
        };
        for lane in &lanes[range] {
            let lane_available = available / placement.scale;
            let offset = (lane.offset(time, lane_available) * self.scale * placement.scale).round()
                / (self.scale * placement.scale);
            let viewport = rect(
                24.,
                (lane.top - shadow_padding(texts[lane.range.start].shadow)) * placement.scale
                    + placement.y,
                available,
                (lane.height + 2. * shadow_padding(texts[lane.range.start].shadow))
                    * placement.scale,
            );
            let overflow = lane.width > lane_available + 0.5;
            let opacity = placement.opacity * lane.opacity;
            let layered = overflow || opacity < 1.;
            if layered {
                let flags = usize::from(offset > 0.)
                    | (usize::from(offset + lane_available < lane.width - 0.5) << 1);
                let mut parameters = D2D1_LAYER_PARAMETERS {
                    contentBounds: viewport,
                    geometricMask: ManuallyDrop::new(None),
                    maskAntialiasMode: D2D1_ANTIALIAS_MODE_ALIASED,
                    maskTransform: identity,
                    opacity,
                    opacityBrush: ManuallyDrop::new(
                        overflow.then(|| self.fade_brushes[flags].clone()),
                    ),
                    layerOptions: D2D1_LAYER_OPTIONS_NONE,
                };
                self.target.PushLayer(&parameters, &self.fade_layer);
                ManuallyDrop::drop(&mut parameters.opacityBrush);
            } else {
                self.target
                    .PushAxisAlignedClip(&viewport, D2D1_ANTIALIAS_MODE_ALIASED);
            }
            self.target.SetTransform(&Matrix3x2 {
                M11: placement.scale,
                M22: placement.scale,
                M31: placement.x - offset * placement.scale,
                M32: placement.y,
                ..Default::default()
            });
            // Decorations move with the fills and remain underneath every word in this lane.
            for (index, mask) in glyph_tiles {
                if !lane.range.contains(index)
                    || (mask.bounds.right - offset) * placement.scale + placement.x < 24.
                    || (mask.bounds.left - offset) * placement.scale + placement.x > available + 24.
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
            for (index, mask) in glyph_tiles {
                if !lane.range.contains(index)
                    || (mask.bounds.right - offset) * placement.scale + placement.x < 24.
                    || (mask.bounds.left - offset) * placement.scale + placement.x > available + 24.
                {
                    continue;
                }
                let text = &texts[*index];
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
            if layered {
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
                        is_bg: false,
                        time: 0.,
                        end_time: 20.,
                        end_time_inferred: None,
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
                renderer.rebuild(&state, 0).unwrap();
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
                        text.y >= 39.9 && text.y + text.height <= 148.1,
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
                renderer.rebuild(&wrap_state, 0).unwrap();
                assert!(renderer.lanes.iter().all(|l| l.width <= 472.1));
                assert!(renderer.texts.iter().all(|t| t.y + t.height <= 148.1));
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
                renderer.rebuild(&plain, 0).unwrap();
                assert_eq!(
                    renderer.lanes.len(),
                    5,
                    "standalone romanization receives its own reserved row"
                );
                assert!(renderer.texts.iter().all(|t| t.y + t.height <= 148.1));
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
                renderer.rebuild(&state, 1).unwrap();
                assert_eq!(
                    renderer.lanes[0].offset(31., 472.),
                    0.,
                    "the promoted current sentence starts at its own beginning"
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
                renderer.rebuild(&state, 0).unwrap();
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
            renderer.rebuild(&state, 0).unwrap();
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
            renderer.rebuild(&state, 1).unwrap();
            renderer
                .draw(hwnd, &state, 4.5, false, false, None, true, 1.)
                .unwrap();
            let mut split = state.clone();
            split.settings.player_alignment = "split-corners".into();
            renderer.rebuild(&split, 0).unwrap();
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
                renderer.rebuild(&state, 0).unwrap();
                renderer
                    .draw(hwnd, &state, 1.5, false, false, None, true, 1.)
                    .unwrap();
                assert!(renderer.resize(1000, 300, 1.).unwrap());
                renderer.rebuild(&state, 1).unwrap();
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
