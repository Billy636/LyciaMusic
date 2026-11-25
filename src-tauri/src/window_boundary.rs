use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(target_os = "windows")]
use windows_sys::Win32::{
    Foundation::{HWND, LPARAM, LRESULT, WPARAM},
    UI::Shell::{DefSubclassProc, RemoveWindowSubclass, SetWindowSubclass},
    UI::WindowsAndMessaging::WM_NCACTIVATE,
};

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
            // 保持材质窗口的激活外观，沿用 Blur/Acrylic/Mica 的失焦处理。
            return DefSubclassProc(hwnd, msg, 1, lparam);
        }
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

/// Tauri 命令：设置在应用不在焦点时是否保留窗口材质
#[tauri::command]
pub fn set_retain_material_on_unfocus(enabled: bool) {
    RETAIN_MATERIAL_ON_UNFOCUS.store(enabled, Ordering::Relaxed);
}
