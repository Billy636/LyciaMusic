use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::{Duration, Instant};

use serde::Serialize;

use windows_sys::Win32::Foundation::{HWND, RECT};
use windows_sys::Win32::Graphics::Dwm::{
    DwmSetWindowAttribute, DWMWA_TRANSITIONS_FORCEDISABLED,
};
use windows_sys::Win32::Graphics::Gdi::{
    GetMonitorInfoW, MonitorFromWindow, RedrawWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST,
    RDW_ALLCHILDREN, RDW_FRAME, RDW_INVALIDATE, RDW_UPDATENOW,
};
use windows_sys::Win32::UI::WindowsAndMessaging::{
    GetWindowLongPtrW, GetWindowRect, SetWindowLongPtrW, SetWindowPos, GWL_STYLE,
    SWP_FRAMECHANGED, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOMOVE, SWP_NOSIZE, SWP_NOZORDER,
    WS_MAXIMIZE,
};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImmersiveFullscreenState {
    pub is_fullscreen: bool,
    pub was_maximized_before_fullscreen: bool,
}

/// 进入全屏前保存的几何信息：退出时按此还原（还原最大化或原窗口矩形）。
#[derive(Clone, Copy)]
struct SavedImmersiveGeometry {
    restore_rect: RECT,
    was_maximized: bool,
}

static SAVED_GEOMETRY: Mutex<Option<SavedImmersiveGeometry>> = Mutex::new(None);
/// 同一时刻只允许一个几何动画；重叠请求退化为瞬时切换。
static ANIMATION_ACTIVE: AtomicBool = AtomicBool::new(false);

/// 沉浸全屏扩张动画时长。覆盖前端 100ms 淡入遮罩之后播放。
const ANIMATION_DURATION: Duration = Duration::from_millis(240);
const ANIMATION_STEP: Duration = Duration::from_millis(10);

fn native_hwnd(window: &tauri::Window) -> Result<HWND, String> {
    // tauri 的 HWND 与 windows-sys 的 HWND 都是裸指针，直接转即可。
    let handle = window.hwnd().map_err(|error| error.to_string())?;
    Ok(handle.0)
}

fn window_rect(hwnd: HWND) -> Option<RECT> {
    unsafe {
        let mut rect: RECT = std::mem::zeroed();
        if GetWindowRect(hwnd, &mut rect) == 0 {
            return None;
        }
        Some(rect)
    }
}

/// 返回窗口所在显示器的（全屏矩形, 工作区矩形）。
fn monitor_rects(hwnd: HWND) -> Option<(RECT, RECT)> {
    unsafe {
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        if monitor.is_null() {
            return None;
        }
        let mut info: MONITORINFO = std::mem::zeroed();
        info.cbSize = std::mem::size_of::<MONITORINFO>() as u32;
        if GetMonitorInfoW(monitor, &mut info) == 0 {
            return None;
        }
        Some((info.rcMonitor, info.rcWork))
    }
}

/// 关闭/恢复 DWM 过渡动画（最大化/还原的滑入滑出），让 ShowWindow 变成瞬时切换。
fn set_dwm_transitions_disabled(hwnd: HWND, disabled: bool) {
    unsafe {
        let value: i32 = if disabled { 1 } else { 0 };
        DwmSetWindowAttribute(
            hwnd,
            DWMWA_TRANSITIONS_FORCEDISABLED as u32,
            &value as *const i32 as *const core::ffi::c_void,
            std::mem::size_of::<i32>() as u32,
        );
    }
}

/// 静默移除 WS_MAXIMIZE 样式：窗口矩形不变、不触发 ShowWindow，
/// 因此既没有视觉变化，也不会触发 DWM 还原动画。
/// 后续动画的第一步 WM_SIZE 会让 tao 把内部 MAXIMIZED 标志同步为 false。
fn clear_maximized_style(hwnd: HWND) {
    unsafe {
        let style = GetWindowLongPtrW(hwnd, GWL_STYLE);
        if style & (WS_MAXIMIZE as isize) == 0 {
            return;
        }
        SetWindowLongPtrW(hwnd, GWL_STYLE, style & !(WS_MAXIMIZE as isize));
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            0,
            0,
            0,
            0,
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED,
        );
    }
}

fn force_repaint(hwnd: HWND) {
    unsafe {
        RedrawWindow(
            hwnd,
            std::ptr::null(),
            std::ptr::null_mut(),
            RDW_INVALIDATE | RDW_ALLCHILDREN | RDW_FRAME | RDW_UPDATENOW,
        );
    }
}

fn ease_out_cubic(t: f64) -> f64 {
    1. - (1. - t).powi(3)
}

/// 逐帧把窗口从 from 平滑插值到 to（ease-out），实现「原位向四周扩张/收缩」。
/// 每步 SetWindowPos 会同步到窗口线程，动画跑在独立线程，不阻塞命令返回。
fn animate_window_rect(hwnd: HWND, from: RECT, to: RECT) {
    let start = Instant::now();
    loop {
        let t = (start.elapsed().as_secs_f64() / ANIMATION_DURATION.as_secs_f64()).min(1.);
        let e = ease_out_cubic(t) as f32;
        let lerp = |a: i32, b: i32| (a as f32 + (b - a) as f32 * e).round() as i32;
        let (left, top, right, bottom) = (
            lerp(from.left, to.left),
            lerp(from.top, to.top),
            lerp(from.right, to.right),
            lerp(from.bottom, to.bottom),
        );
        unsafe {
            SetWindowPos(
                hwnd,
                std::ptr::null_mut(),
                left,
                top,
                right - left,
                bottom - top,
                SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE,
            );
        }
        if t >= 1. {
            break;
        }
        thread::sleep(ANIMATION_STEP);
    }
    // 收尾一帧精确对齐目标矩形。
    unsafe {
        SetWindowPos(
            hwnd,
            std::ptr::null_mut(),
            to.left,
            to.top,
            to.right - to.left,
            to.bottom - to.top,
            SWP_NOZORDER | SWP_NOOWNERZORDER | SWP_NOACTIVATE,
        );
    }
}

/// Applies the maximize/fullscreen transition as one smooth visual operation.
///
/// 之前的实现是「还原最大化（ShowWindow(SW_RESTORE)，DWM 播放还原动画）→
/// set_fullscreen」，中间帧把「先缩回原位、再铺满全屏」暴露给了用户；
/// WM_SETREDRAW 只能冻结内容，挡不住窗口外壳的 DWM 动画。
/// 现改为：静默摘掉 WS_MAXIMIZE 样式后，用 SetWindowPos 逐帧把窗口从
/// 当前矩形平滑扩张到显示器矩形（ease-out），结束再同步 tao 全屏状态；
/// 退出时反向收缩回原矩形 / 工作区。全程没有还原动画和中间态。
#[tauri::command]
pub fn set_immersive_fullscreen(
    window: tauri::Window,
    fullscreen: bool,
    restore_maximized: bool,
) -> Result<ImmersiveFullscreenState, String> {
    let hwnd = native_hwnd(&window)?;

    if fullscreen {
        let was_maximized = window.is_maximized().map_err(|error| error.to_string())?;
        let current = window_rect(hwnd).ok_or_else(|| "GetWindowRect failed".to_string())?;
        let Some((monitor_rect, _)) = monitor_rects(hwnd) else {
            // 拿不到显示器信息时退回瞬时全屏，保证功能可用。
            window.set_fullscreen(true).map_err(|error| error.to_string())?;
            return Ok(ImmersiveFullscreenState {
                is_fullscreen: true,
                was_maximized_before_fullscreen: was_maximized,
            });
        };

        let _ = SAVED_GEOMETRY.lock().map_err(|error| error.to_string())?.insert(SavedImmersiveGeometry {
            restore_rect: current,
            was_maximized,
        });

        let can_animate = ANIMATION_ACTIVE
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok();

        if !can_animate {
            window.set_fullscreen(true).map_err(|error| error.to_string())?;
            return Ok(ImmersiveFullscreenState {
                is_fullscreen: true,
                was_maximized_before_fullscreen: was_maximized,
            });
        }

        set_dwm_transitions_disabled(hwnd, true);
        if was_maximized {
            clear_maximized_style(hwnd);
        }

        // windows_sys 的 HWND 是裸指针，不实现 Send；以地址传递，线程内还原。
        let hwnd_addr = hwnd as usize;
        let win = window.clone();
        thread::spawn(move || {
            let hwnd: HWND = hwnd_addr as HWND;
            animate_window_rect(hwnd, current, monitor_rect);
            // 此时窗口已在全屏矩形上，tao 的 SetWindowPos 是视觉无操作，
            // 但会保存正确的全屏状态供 isFullscreen() 查询。
            let _ = win.set_fullscreen(true);
            set_dwm_transitions_disabled(hwnd, false);
            force_repaint(hwnd);
            ANIMATION_ACTIVE.store(false, Ordering::SeqCst);
        });

        return Ok(ImmersiveFullscreenState {
            is_fullscreen: true,
            was_maximized_before_fullscreen: was_maximized,
        });
    }

    let saved = SAVED_GEOMETRY
        .lock()
        .map_err(|error| error.to_string())?
        .take();
    let was_maximized = saved.map(|s| s.was_maximized).unwrap_or(false);
    let should_restore_maximized = restore_maximized || was_maximized;

    let Some((_, work_rect)) = monitor_rects(hwnd) else {
        window.set_fullscreen(false).map_err(|error| error.to_string())?;
        return Ok(ImmersiveFullscreenState {
            is_fullscreen: false,
            was_maximized_before_fullscreen: false,
        });
    };
    let target = if should_restore_maximized {
        work_rect
    } else {
        saved.map(|s| s.restore_rect).unwrap_or(work_rect)
    };

    let can_animate = ANIMATION_ACTIVE
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_ok();

    if !can_animate {
        window.set_fullscreen(false).map_err(|error| error.to_string())?;
        return Ok(ImmersiveFullscreenState {
            is_fullscreen: false,
            was_maximized_before_fullscreen: false,
        });
    }

    // 先同步 tao 的全屏标志：此时保存的 placement 即全屏矩形，与当前几何一致，
    // SetWindowPlacement 是视觉无操作，随后再播放收缩动画。
    set_dwm_transitions_disabled(hwnd, true);
    window.set_fullscreen(false).map_err(|error| error.to_string())?;

    let Some(current) = window_rect(hwnd) else {
        set_dwm_transitions_disabled(hwnd, false);
        ANIMATION_ACTIVE.store(false, Ordering::SeqCst);
        return Ok(ImmersiveFullscreenState {
            is_fullscreen: false,
            was_maximized_before_fullscreen: false,
        });
    };

    let hwnd_addr = hwnd as usize;
    let win = window.clone();
    thread::spawn(move || {
        let hwnd: HWND = hwnd_addr as HWND;
        animate_window_rect(hwnd, current, target);
        if should_restore_maximized {
            // 窗口已收缩到工作区矩形，重新置最大化标志补上边框悬出部分，
            // DWM 过渡已禁用，只是几像素的瞬时修正，且被前端遮罩盖住。
            let _ = win.maximize();
        }
        set_dwm_transitions_disabled(hwnd, false);
        force_repaint(hwnd);
        ANIMATION_ACTIVE.store(false, Ordering::SeqCst);
    });

    Ok(ImmersiveFullscreenState {
        is_fullscreen: false,
        was_maximized_before_fullscreen: false,
    })
}
