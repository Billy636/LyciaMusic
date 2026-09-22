//! DirectWrite shapes/fallbacks the glyph runs; Direct2D strokes their actual contours.
//! Only used when rebuilding the static decoration cache, never per animation frame.
use std::ffi::c_void;
use windows::{
    core::{implement, IUnknown, Ref, Result, BOOL},
    Win32::Graphics::{Direct2D::*, DirectWrite::*},
};
use windows_numerics::Matrix3x2;

#[implement(IDWriteTextRenderer)]
struct OutlineRenderer {
    target: ID2D1RenderTarget,
    factory: ID2D1Factory,
    brush: ID2D1SolidColorBrush,
    style: ID2D1StrokeStyle,
    width: f32,
    scale: f32,
}

pub unsafe fn renderer(
    target: &ID2D1RenderTarget,
    brush: &ID2D1SolidColorBrush,
    radius: f32,
    scale: f32,
) -> Result<IDWriteTextRenderer> {
    let factory = target.GetFactory()?;
    let style = factory.CreateStrokeStyle(
        &D2D1_STROKE_STYLE_PROPERTIES {
            startCap: D2D1_CAP_STYLE_ROUND,
            endCap: D2D1_CAP_STYLE_ROUND,
            dashCap: D2D1_CAP_STYLE_ROUND,
            lineJoin: D2D1_LINE_JOIN_ROUND,
            miterLimit: 1.,
            dashStyle: D2D1_DASH_STYLE_SOLID,
            dashOffset: 0.,
        },
        None,
    )?;
    Ok(OutlineRenderer {
        target: target.clone(),
        factory,
        brush: brush.clone(),
        style,
        width: radius * 2.,
        scale,
    }
    .into())
}

#[allow(non_snake_case)]
impl IDWritePixelSnapping_Impl for OutlineRenderer_Impl {
    fn IsPixelSnappingDisabled(&self, _: *const c_void) -> Result<BOOL> {
        Ok(false.into())
    }
    fn GetCurrentTransform(&self, _: *const c_void, transform: *mut DWRITE_MATRIX) -> Result<()> {
        unsafe {
            *transform = DWRITE_MATRIX {
                m11: 1.,
                m22: 1.,
                ..Default::default()
            };
        }
        Ok(())
    }
    fn GetPixelsPerDip(&self, _: *const c_void) -> Result<f32> {
        Ok(self.scale)
    }
}

#[allow(non_snake_case)]
impl IDWriteTextRenderer_Impl for OutlineRenderer_Impl {
    fn DrawGlyphRun(
        &self,
        _: *const c_void,
        x: f32,
        y: f32,
        _: DWRITE_MEASURING_MODE,
        run: *const DWRITE_GLYPH_RUN,
        _: *const DWRITE_GLYPH_RUN_DESCRIPTION,
        _: Ref<'_, IUnknown>,
    ) -> Result<()> {
        unsafe {
            let run = &*run;
            let Some(face) = run.fontFace.as_ref() else {
                return Ok(());
            };
            let geometry = self.factory.CreatePathGeometry()?;
            let sink = geometry.Open()?;
            face.GetGlyphRunOutline(
                run.fontEmSize,
                run.glyphIndices,
                Some(run.glyphAdvances),
                Some(run.glyphOffsets),
                run.glyphCount,
                run.isSideways.as_bool(),
                run.bidiLevel % 2 != 0,
                &sink,
            )?;
            sink.Close()?;
            let positioned = self.factory.CreateTransformedGeometry(
                &geometry,
                &Matrix3x2 {
                    M11: 1.,
                    M22: 1.,
                    M31: x,
                    M32: y,
                    ..Default::default()
                },
            )?;
            self.target
                .DrawGeometry(&positioned, &self.brush, self.width, &self.style);
        }
        Ok(())
    }
    // Lyric layouts have no underline, strikethrough or inline-object formatting.
    fn DrawUnderline(
        &self,
        _: *const c_void,
        _: f32,
        _: f32,
        _: *const DWRITE_UNDERLINE,
        _: Ref<'_, IUnknown>,
    ) -> Result<()> {
        Ok(())
    }
    fn DrawStrikethrough(
        &self,
        _: *const c_void,
        _: f32,
        _: f32,
        _: *const DWRITE_STRIKETHROUGH,
        _: Ref<'_, IUnknown>,
    ) -> Result<()> {
        Ok(())
    }
    fn DrawInlineObject(
        &self,
        _: *const c_void,
        _: f32,
        _: f32,
        _: Ref<'_, IDWriteInlineObject>,
        _: BOOL,
        _: BOOL,
        _: Ref<'_, IUnknown>,
    ) -> Result<()> {
        Ok(())
    }
}
