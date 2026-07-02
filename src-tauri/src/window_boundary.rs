use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, RECT, WPARAM},
    Graphics::Gdi::{GetMonitorInfoW, MonitorFromWindow, MONITORINFO, MONITOR_DEFAULTTONEAREST},
    UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
    UI::WindowsAndMessaging::{WM_MOVING, WM_NCACTIVATE},
};

/// 全局标志：是否启用 mini 窗口边界约束
static BOUNDARY_ENABLED: AtomicBool = AtomicBool::new(false);

/// 全局标志：在应用不在焦点时是否保留窗口材质
static RETAIN_MATERIAL_ON_UNFOCUS: AtomicBool = AtomicBool::new(false);

/// Subclass ID（任意唯一常量）
#[cfg(target_os = "windows")]
const SUBCLASS_ID: usize = 1001;

#[cfg(target_os = "windows")]
unsafe extern "system" fn boundary_subclass_proc(
    hwnd: HWND,
    msg: u32,
    wparam: WPARAM,
    lparam: LPARAM,
    _uid_subclass: usize,
    _dw_ref_data: usize,
) -> LRESULT {
    if msg == WM_NCACTIVATE && RETAIN_MATERIAL_ON_UNFOCUS.load(Ordering::Relaxed) {
        if wparam == 0 {
            // 维持激活信号的渲染，防止 DWM 失焦时取消 Acrylic/Mica 模糊效果
            return DefSubclassProc(hwnd, msg, 1, lparam);
        }
    }

    if msg == WM_MOVING && BOUNDARY_ENABLED.load(Ordering::Relaxed) {
        // lparam 指向一个 RECT，表示窗口即将移动到的目标位置
        let rect = &mut *(lparam as *mut RECT);
        let win_width = rect.right - rect.left;
        let win_height = rect.bottom - rect.top;

        // 获取窗口所在显示器的工作区域（排除任务栏）
        let monitor = MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST);
        let mut mi: MONITORINFO = std::mem::zeroed();
        mi.cbSize = std::mem::size_of::<MONITORINFO>() as u32;

        if GetMonitorInfoW(monitor, &mut mi) != 0 {
            let work = mi.rcWork;

            // 钳制位置：不允许超出工作区域
            if rect.left < work.left {
                rect.left = work.left;
                rect.right = work.left + win_width;
            }
            if rect.top < work.top {
                rect.top = work.top;
                rect.bottom = work.top + win_height;
            }
            if rect.right > work.right {
                rect.right = work.right;
                rect.left = work.right - win_width;
            }
            if rect.bottom > work.bottom {
                rect.bottom = work.bottom;
                rect.top = work.bottom - win_height;
            }
        }

        return 0;
    }

    DefSubclassProc(hwnd, msg, wparam, lparam)
}

/// 为指定窗口安装 subclass（在 setup 阶段调用一次即可）
#[cfg(target_os = "windows")]
pub fn install_boundary_subclass(hwnd: isize) {
    unsafe {
        SetWindowSubclass(hwnd as HWND, Some(boundary_subclass_proc), SUBCLASS_ID, 0);
    }
}

/// 卸载 subclass
#[cfg(target_os = "windows")]
pub fn _remove_boundary_subclass(hwnd: isize) {
    unsafe {
        RemoveWindowSubclass(hwnd as HWND, Some(boundary_subclass_proc), SUBCLASS_ID);
    }
}

/// Tauri 命令：启用/禁用 mini 窗口边界约束
#[tauri::command]
pub fn set_mini_boundary_enabled(enabled: bool) {
    BOUNDARY_ENABLED.store(enabled, Ordering::Relaxed);
}

/// Tauri 命令：设置在应用不在焦点时是否保留窗口材质
#[tauri::command]
pub fn set_retain_material_on_unfocus(enabled: bool) {
    RETAIN_MATERIAL_ON_UNFOCUS.store(enabled, Ordering::Relaxed);
}

