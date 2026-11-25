#[cfg(target_os = "windows")]
use std::sync::atomic::AtomicU64;
use std::sync::atomic::{AtomicIsize, Ordering};

pub static LAST_TASKBAR_HWND: AtomicIsize = AtomicIsize::new(0);
const TASKBAR_PLAYER_WINDOW_LABEL: &str = "taskbar-player";
#[cfg(target_os = "windows")]
static TASKBAR_DRAG_ACTIVE_SESSION: AtomicU64 = AtomicU64::new(0);
#[cfg(target_os = "windows")]
static TASKBAR_DRAG_CANCELLED_SESSION: AtomicU64 = AtomicU64::new(0);

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum OwnerBindingState {
    Bound,
    Failed,
    Unsupported,
    AlreadyBound,
}

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum GeometrySource {
    Tray,
    TaskbarFallback,
}

#[derive(serde::Serialize, Clone, Copy, Debug)]
pub struct RectPhysical {
    pub left: i32,
    pub top: i32,
    pub right: i32,
    pub bottom: i32,
}

#[derive(serde::Serialize, Clone, Debug)]
pub struct TaskbarTrayGeometry {
    pub taskbar_rect_physical: RectPhysical,
    pub tray_rect_physical: Option<RectPhysical>,
    pub taskbar_hwnd_changed: bool,
    pub owner_binding: OwnerBindingState,
    pub source: GeometrySource,
    pub scale_factor: f64,
}

#[cfg(target_os = "windows")]
fn find_window_recursive(
    hwnd: windows_sys::Win32::Foundation::HWND,
    target_class_utf16: &[u16],
    current_depth: u32,
    max_depth: u32,
    node_count: &mut u32,
) -> windows_sys::Win32::Foundation::HWND {
    if hwnd.is_null() {
        return std::ptr::null_mut();
    }
    *node_count += 1;
    if *node_count > 64 {
        return std::ptr::null_mut();
    }

    // 检查当前窗口的类名是否匹配（无分配高速比对）
    let mut class_name = [0u16; 256];
    let len = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetClassNameW(
            hwnd,
            class_name.as_mut_ptr(),
            class_name.len() as i32,
        )
    };
    if len > 0 {
        let actual_len = len as usize;
        if actual_len == target_class_utf16.len() && &class_name[..actual_len] == target_class_utf16
        {
            return hwnd;
        }
    }

    if current_depth >= max_depth {
        return std::ptr::null_mut();
    }

    // 遍历子窗口
    let mut child = unsafe {
        windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
            hwnd,
            windows_sys::Win32::UI::WindowsAndMessaging::GW_CHILD,
        )
    };
    while !child.is_null() {
        let found = find_window_recursive(
            child,
            target_class_utf16,
            current_depth + 1,
            max_depth,
            node_count,
        );
        if !found.is_null() {
            return found;
        }
        child = unsafe {
            windows_sys::Win32::UI::WindowsAndMessaging::GetWindow(
                child,
                windows_sys::Win32::UI::WindowsAndMessaging::GW_HWNDNEXT,
            )
        };
    }

    std::ptr::null_mut()
}

#[tauri::command]
pub fn setup_taskbar_window(app: tauri::AppHandle) -> OwnerBindingState {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use tauri::Manager;
        use windows_sys::Win32::Foundation::{GetLastError, SetLastError, HWND};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, GetWindowLongW, SetWindowLongPtrW, SetWindowLongW, GWLP_HWNDPARENT,
            GWL_EXSTYLE, WS_EX_NOACTIVATE,
        };

        if let Some(window) = app.get_webview_window(TASKBAR_PLAYER_WINDOW_LABEL) {
            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    let hwnd = win32.hwnd.get() as HWND;

                    // 1. 设置 WS_EX_NOACTIVATE 扩展样式以尽量避免抢占焦点
                    unsafe {
                        let ex_style = GetWindowLongW(hwnd, GWL_EXSTYLE);
                        SetWindowLongW(hwnd, GWL_EXSTYLE, ex_style | WS_EX_NOACTIVATE as i32);
                    }

                    // 2. 绑定 Owner 到 Shell_TrayWnd（主任务栏）
                    let shell_tray_class: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
                    let hwnd_taskbar =
                        unsafe { FindWindowW(shell_tray_class.as_ptr(), std::ptr::null()) };

                    if !hwnd_taskbar.is_null() {
                        let mut bound_success = false;
                        unsafe {
                            SetLastError(0);
                            let prev =
                                SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, hwnd_taskbar as isize);
                            if prev == 0 {
                                let err = GetLastError();
                                if err == 0 {
                                    bound_success = true;
                                }
                            } else {
                                bound_success = true;
                            }
                        }

                        if bound_success {
                            LAST_TASKBAR_HWND.store(hwnd_taskbar as isize, Ordering::SeqCst);
                            return OwnerBindingState::Bound;
                        } else {
                            return OwnerBindingState::Failed;
                        }
                    } else {
                        return OwnerBindingState::Failed;
                    }
                }
            }
        }
        OwnerBindingState::Unsupported
    }
    #[cfg(not(target_os = "windows"))]
    {
        OwnerBindingState::Unsupported
    }
}

#[tauri::command]
pub fn get_taskbar_tray_geometry(app: tauri::AppHandle) -> Result<TaskbarTrayGeometry, String> {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use tauri::Manager;
        use windows_sys::Win32::Foundation::{GetLastError, SetLastError, HWND, RECT};
        use windows_sys::Win32::UI::Shell::{SHAppBarMessage, ABM_GETTASKBARPOS, APPBARDATA};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowExW, FindWindowW, GetWindowRect, SetWindowLongPtrW, GWLP_HWNDPARENT,
        };

        let window = app
            .get_webview_window(TASKBAR_PLAYER_WINDOW_LABEL)
            .ok_or_else(|| "Taskbar player window not found".to_string())?;

        // 1. 查找当前主系统任务栏句柄
        let shell_tray_class: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
        let current_hwnd_taskbar =
            unsafe { FindWindowW(shell_tray_class.as_ptr(), std::ptr::null()) };

        if current_hwnd_taskbar.is_null() {
            return Err("Taskbar window not found".to_string());
        }

        let last_hwnd = LAST_TASKBAR_HWND.load(Ordering::SeqCst);
        let mut hwnd_changed = false;
        let mut owner_binding = OwnerBindingState::AlreadyBound;

        // 检测到 Explorer 重建时（HWND 变化），自愈重绑
        if last_hwnd != current_hwnd_taskbar as isize {
            hwnd_changed = true;
            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    let hwnd = win32.hwnd.get() as HWND;
                    let mut bound_success = false;
                    unsafe {
                        SetLastError(0);
                        let prev =
                            SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, current_hwnd_taskbar as isize);
                        if prev == 0 {
                            let err = GetLastError();
                            if err == 0 {
                                bound_success = true;
                            }
                        } else {
                            bound_success = true;
                        }
                    }

                    if bound_success {
                        owner_binding = OwnerBindingState::Bound;
                        LAST_TASKBAR_HWND.store(current_hwnd_taskbar as isize, Ordering::SeqCst);
                    } else {
                        owner_binding = OwnerBindingState::Failed;
                    }
                } else {
                    owner_binding = OwnerBindingState::Unsupported;
                }
            } else {
                owner_binding = OwnerBindingState::Unsupported;
            }
        }

        // 2. 提取任务栏物理矩形坐标
        let mut abd = APPBARDATA {
            cbSize: std::mem::size_of::<APPBARDATA>() as u32,
            hWnd: current_hwnd_taskbar,
            uCallbackMessage: 0,
            uEdge: 0,
            rc: RECT {
                left: 0,
                top: 0,
                right: 0,
                bottom: 0,
            },
            lParam: 0,
        };
        let mut taskbar_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let got_taskbar = unsafe { SHAppBarMessage(ABM_GETTASKBARPOS, &mut abd) != 0 };
        if got_taskbar {
            taskbar_rect = abd.rc;
        } else {
            // SHAppBarMessage 失败时的 GetWindowRect 物理兜底
            unsafe {
                GetWindowRect(current_hwnd_taskbar, &mut taskbar_rect);
            }
        }

        // 3. 优先使用 FindWindowExW 直接查找 TrayNotifyWnd 直系子窗口 (Fast-Path)
        let tray_class_utf16: Vec<u16> = "TrayNotifyWnd\0".encode_utf16().collect();
        let mut hwnd_tray = unsafe {
            FindWindowExW(
                current_hwnd_taskbar,
                std::ptr::null_mut(),
                tray_class_utf16.as_ptr(),
                std::ptr::null(),
            )
        };

        // 4. 若直系查找失败，则回退到 DFS 递归查找进行安全兜底 (Slow-Path)，并将限制放宽
        if hwnd_tray.is_null() {
            let mut node_count = 0;
            // 递归比对不需要末尾的 \0
            hwnd_tray = find_window_recursive(
                current_hwnd_taskbar,
                &tray_class_utf16[..tray_class_utf16.len() - 1],
                0,
                4,
                &mut node_count,
            );
        }

        let mut tray_rect = RECT {
            left: 0,
            top: 0,
            right: 0,
            bottom: 0,
        };
        let got_tray = if !hwnd_tray.is_null() {
            unsafe { GetWindowRect(hwnd_tray, &mut tray_rect) != 0 }
        } else {
            false
        };

        let tray_rect_physical = if got_tray {
            Some(RectPhysical {
                left: tray_rect.left,
                top: tray_rect.top,
                right: tray_rect.right,
                bottom: tray_rect.bottom,
            })
        } else {
            // 静默返回 None 作为正常无托盘/重建中的兜底分支，不刷 warning 日志
            None
        };

        let scale_factor = window.as_ref().window().scale_factor().unwrap_or(1.0);

        Ok(TaskbarTrayGeometry {
            taskbar_rect_physical: RectPhysical {
                left: taskbar_rect.left,
                top: taskbar_rect.top,
                right: taskbar_rect.right,
                bottom: taskbar_rect.bottom,
            },
            tray_rect_physical,
            taskbar_hwnd_changed: hwnd_changed,
            owner_binding,
            source: if got_tray {
                GeometrySource::Tray
            } else {
                GeometrySource::TaskbarFallback
            },
            scale_factor,
        })
    }
    #[cfg(not(target_os = "windows"))]
    {
        Err("Unsupported OS".to_string())
    }
}

/// 拖动时至少保留在屏幕内的像素，其余允许藏到屏幕边缘外。
const MIN_VISIBLE: i32 = 18;

#[derive(serde::Serialize, Clone, Copy, Debug, PartialEq, Eq)]
pub struct TaskbarDragResult {
    pub x: i32,
    pub y: i32,
}

/// 拖动范围：锁定状态只在底栏内水平移动，解锁后可在整块虚拟桌面自由移动。
#[cfg(target_os = "windows")]
#[derive(Clone, Copy, Debug)]
enum DragArea {
    Dock { min_x: i32, max_x: i32, y: i32 },
    /// 虚拟桌面范围在 worker 内部按自身 DPI 上下文读取，避免混用缩放值。
    Free,
}

#[cfg(target_os = "windows")]
fn drag_worker(
    hwnd_raw: isize,
    session_id: u64,
    grab_offset_x: i32,
    grab_offset_y: i32,
    area: DragArea,
) -> Result<TaskbarDragResult, String> {
    use std::time::{Duration, Instant};
    use windows::Win32::UI::HiDpi::{
        SetThreadDpiAwarenessContext, DPI_AWARENESS_CONTEXT,
        DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE, DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2,
    };
    use windows::Win32::UI::Input::KeyboardAndMouse::{
        GetAsyncKeyState, VK_ESCAPE, VK_LBUTTON, VK_RBUTTON,
    };
    use windows_sys::Win32::Foundation::{HWND, POINT, RECT};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetCursorPos, GetSystemMetrics, GetWindowRect, IsWindow, IsWindowVisible, SetWindowPos,
        SM_CXVIRTUALSCREEN, SM_CYVIRTUALSCREEN, SM_SWAPBUTTON, SM_XVIRTUALSCREEN,
        SM_YVIRTUALSCREEN, SWP_NOACTIVATE, SWP_NOOWNERZORDER, SWP_NOSIZE, SWP_NOZORDER,
    };

    // Runtime workers do not necessarily inherit the window thread's awareness.
    // Keep the native reads and writes in physical pixels, then restore this
    // pooled thread's context on every exit path.
    struct RestoreDpiContext(DPI_AWARENESS_CONTEXT);
    impl Drop for RestoreDpiContext {
        fn drop(&mut self) {
            unsafe { SetThreadDpiAwarenessContext(self.0) };
        }
    }
    let mut previous_dpi =
        unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE_V2) };
    if previous_dpi.0.is_null() {
        previous_dpi =
            unsafe { SetThreadDpiAwarenessContext(DPI_AWARENESS_CONTEXT_PER_MONITOR_AWARE) };
    }
    if previous_dpi.0.is_null() {
        return Err("Failed to set the taskbar drag worker's DPI awareness".to_string());
    }
    let _restore_dpi = RestoreDpiContext(previous_dpi);

    let hwnd = hwnd_raw as HWND;
    let mut rect: RECT = unsafe { std::mem::zeroed() };
    if unsafe { IsWindow(hwnd) } == 0 || unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
        return Err("Taskbar player window is unavailable".to_string());
    }
    let mut confirmed_x = rect.left;
    let mut confirmed_y = rect.top;

    let (min_x, max_x, min_y, max_y) = match area {
        DragArea::Dock { min_x, max_x, y } => (min_x, max_x.max(min_x), y, y),
        DragArea::Free => {
            let window_width = rect.right - rect.left;
            let window_height = rect.bottom - rect.top;
            // 允许拖出屏幕边缘，只保证至少 MIN_VISIBLE 仍在桌面内，方便藏边。
            let margin_x = (window_width - MIN_VISIBLE).max(0);
            let margin_y = (window_height - MIN_VISIBLE).max(0);
            let virtual_x = unsafe { GetSystemMetrics(SM_XVIRTUALSCREEN) };
            let virtual_y = unsafe { GetSystemMetrics(SM_YVIRTUALSCREEN) };
            let virtual_width = unsafe { GetSystemMetrics(SM_CXVIRTUALSCREEN) };
            let virtual_height = unsafe { GetSystemMetrics(SM_CYVIRTUALSCREEN) };
            (
                virtual_x - margin_x,
                (virtual_x + virtual_width - window_width + margin_x).max(virtual_x),
                virtual_y - margin_y,
                (virtual_y + virtual_height - window_height + margin_y).max(virtual_y),
            )
        }
    };

    let started = Instant::now();
    // DOM button 0 follows the user's primary-button preference;
    // GetAsyncKeyState reports physical left/right buttons instead.
    let primary_button = if unsafe { GetSystemMetrics(SM_SWAPBUTTON) } != 0 {
        VK_RBUTTON
    } else {
        VK_LBUTTON
    };

    // Read native input instead of WebView pointer events. The no-activate
    // taskbar window can lose DOM capture while the button is still held.
    loop {
        if TASKBAR_DRAG_ACTIVE_SESSION.load(Ordering::SeqCst) != session_id
            || TASKBAR_DRAG_CANCELLED_SESSION.load(Ordering::SeqCst) >= session_id
            || started.elapsed() >= Duration::from_secs(30)
            || unsafe { IsWindow(hwnd) } == 0
            || unsafe { IsWindowVisible(hwnd) } == 0
            || unsafe { GetAsyncKeyState(primary_button.0 as i32) } >= 0
            || unsafe { GetAsyncKeyState(VK_ESCAPE.0 as i32) } < 0
        {
            break;
        }

        let mut cursor = POINT { x: 0, y: 0 };
        if unsafe { GetCursorPos(&mut cursor) } == 0 {
            return Err(format!(
                "Failed to read the cursor position: {}",
                std::io::Error::last_os_error()
            ));
        }
        let next_x = cursor.x.saturating_sub(grab_offset_x).clamp(min_x, max_x);
        let next_y = cursor.y.saturating_sub(grab_offset_y).clamp(min_y, max_y);
        if next_x != confirmed_x || next_y != confirmed_y {
            // Keep every coordinate physical and apply movement
            // synchronously so completion cannot precede a queued move.
            if unsafe {
                SetWindowPos(
                    hwnd,
                    std::ptr::null_mut(),
                    next_x,
                    next_y,
                    0,
                    0,
                    SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOZORDER | SWP_NOOWNERZORDER,
                )
            } == 0
            {
                return Err(format!(
                    "Failed to move the taskbar player: {}",
                    std::io::Error::last_os_error()
                ));
            }
            if unsafe { GetWindowRect(hwnd, &mut rect) } == 0 {
                break;
            }
            confirmed_x = rect.left;
            confirmed_y = rect.top;
        }
        std::thread::sleep(Duration::from_millis(12));
    }

    if unsafe { IsWindow(hwnd) } != 0 && unsafe { GetWindowRect(hwnd, &mut rect) } != 0 {
        confirmed_x = rect.left;
        confirmed_y = rect.top;
    }
    Ok(TaskbarDragResult { x: confirmed_x, y: confirmed_y })
}

/// 锁定状态下的拖动：只在底栏横向区间内移动，纵向保持固定。
#[tauri::command]
pub async fn drag_taskbar_player(
    window: tauri::Window,
    session_id: u64,
    min_x: i32,
    max_x: i32,
    y: i32,
    grab_offset_x: i32,
) -> Result<TaskbarDragResult, String> {
    if window.label() != TASKBAR_PLAYER_WINDOW_LABEL {
        return Err("Only the taskbar player window can start taskbar dragging".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        if min_x > max_x {
            return Err("Invalid taskbar drag bounds".to_string());
        }
        // The caller reserves the id before any IPC. Separate monotonic high
        // watermarks prevent delayed starts from reviving a cancelled session
        // or replacing a newer drag, even before this async command is polled.
        TASKBAR_DRAG_ACTIVE_SESSION.fetch_max(session_id, Ordering::SeqCst);
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;
        tauri::async_runtime::spawn_blocking(move || {
            drag_worker(hwnd, session_id, grab_offset_x, 0, DragArea::Dock { min_x, max_x, y })
        })
        .await
        .map_err(|error| format!("Taskbar drag worker failed: {error}"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, session_id, min_x, max_x, y, grab_offset_x);
        Err("Taskbar player dragging is only supported on Windows".to_string())
    }
}

/// 解锁状态下的拖动：限制在整块虚拟桌面内，可跨屏自由移动。
#[tauri::command]
pub async fn drag_taskbar_player_free(
    window: tauri::Window,
    session_id: u64,
    grab_offset_x: i32,
    grab_offset_y: i32,
) -> Result<TaskbarDragResult, String> {
    if window.label() != TASKBAR_PLAYER_WINDOW_LABEL {
        return Err("Only the taskbar player window can start free dragging".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        TASKBAR_DRAG_ACTIVE_SESSION.fetch_max(session_id, Ordering::SeqCst);
        let hwnd = window.hwnd().map_err(|error| error.to_string())?.0 as isize;

        tauri::async_runtime::spawn_blocking(move || {
            drag_worker(hwnd, session_id, grab_offset_x, grab_offset_y, DragArea::Free)
        })
        .await
        .map_err(|error| format!("Taskbar drag worker failed: {error}"))?
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, session_id, grab_offset_x, grab_offset_y);
        Err("Taskbar player dragging is only supported on Windows".to_string())
    }
}

#[tauri::command]
pub fn cancel_taskbar_player_drag(window: tauri::Window, session_id: u64) -> Result<(), String> {
    if window.label() != TASKBAR_PLAYER_WINDOW_LABEL {
        return Err("Only the taskbar player window can cancel taskbar dragging".to_string());
    }
    #[cfg(target_os = "windows")]
    {
        TASKBAR_DRAG_CANCELLED_SESSION.fetch_max(session_id, Ordering::SeqCst);
        Ok(())
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = session_id;
        Err("Taskbar player dragging is only supported on Windows".to_string())
    }
}

// Taskbar ordering is repaired on one message thread. Native events coalesce
// immediate checks; a timer covers shell promotions without accessibility events.
#[cfg(target_os = "windows")]
mod zorder_guard {
    use std::cell::Cell;
    use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
    use std::sync::{mpsc, Mutex, OnceLock};

    use windows_sys::Win32::Foundation::{HWND, RECT};
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetAncestor, GetClassNameW, GetMessageW, GetPropW, GetTopWindow,
        GetWindow, GetWindowLongPtrW, GetWindowRect, IsIconic, IsWindow, IsWindowVisible,
        KillTimer, PeekMessageW, PostThreadMessageW, RemovePropW, SetPropW, SetTimer, SetWindowPos,
        TranslateMessage, EVENT_OBJECT_FOCUS, EVENT_OBJECT_REORDER, EVENT_OBJECT_SHOW,
        EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MENUSTART, GA_ROOT, GWL_EXSTYLE, GW_HWNDNEXT,
        GW_HWNDPREV, HWND_TOPMOST, MSG, OBJID_WINDOW, PM_NOREMOVE, SWP_NOACTIVATE, SWP_NOMOVE,
        SWP_NOOWNERZORDER, SWP_NOSENDCHANGING, SWP_NOSIZE, WINEVENT_OUTOFCONTEXT,
        WINEVENT_SKIPOWNPROCESS, WM_APP, WM_TIMER, WS_EX_TOPMOST,
    };

    static PLAYER_HWND: AtomicIsize = AtomicIsize::new(0);
    static GENERATION: AtomicU64 = AtomicU64::new(0);
    // Only control updates use this lock. No SetWindowPos may run while held.
    static CONTROL: Mutex<()> = Mutex::new(());
    const WM_INSTALL: u32 = WM_APP + 0x200;
    const WM_UNINSTALL: u32 = WM_APP + 0x201;
    const WM_REFRESH: u32 = WM_APP + 0x202;
    const CHECK_INTERVAL_MS: u32 = 100;

    thread_local! {
        static REFRESH_PENDING: Cell<bool> = const { Cell::new(false) };
        static SHELL_PROMOTION_PENDING: Cell<bool> = const { Cell::new(false) };
    }

    struct GuardThread {
        thread_id: u32,
    }
    static GUARD_THREAD: OnceLock<GuardThread> = OnceLock::new();

    fn property_name() -> *const u16 {
        static NAME: OnceLock<Vec<u16>> = OnceLock::new();
        NAME.get_or_init(|| {
            "LyciaTaskbarPlayerGuardGeneration\0"
                .encode_utf16()
                .collect()
        })
        .as_ptr()
    }

    unsafe fn remove_identity(player: HWND, generation: u64) {
        if !player.is_null() && GetPropW(player, property_name()) as usize == generation as usize {
            RemovePropW(player, property_name());
        }
    }

    unsafe fn is_current(player: HWND, generation: u64) -> bool {
        GENERATION.load(Ordering::SeqCst) == generation
            && PLAYER_HWND.load(Ordering::SeqCst) == player as isize
            && IsWindow(player) != 0
            && GetPropW(player, property_name()) as usize == generation as usize
    }

    unsafe fn class_name(hwnd: HWND) -> String {
        let mut buf = [0u16; 256];
        let len = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
        if len <= 0 {
            String::new()
        } else {
            String::from_utf16_lossy(&buf[..len as usize])
        }
    }

    unsafe fn is_shell_window(hwnd: HWND) -> bool {
        matches!(
            class_name(hwnd).as_str(),
            "Shell_TrayWnd"
                | "Shell_SecondaryTrayWnd"
                | "TrayNotifyWnd"
                | "NotifyIconOverflowWindow"
                | "WorkerW"
                | "Progman"
                | "SHELLDLL_DefView"
                | "DV2ControlHost"
        )
    }

    unsafe fn intersecting_taskbar(player: HWND, target: &RECT) -> Option<HWND> {
        let mut candidate = GetTopWindow(std::ptr::null_mut());
        // Walk actual desktop order, including secondary bars and parent-sourced
        // reorder notifications. Bound the walk while windows are changing.
        for _ in 0..512 {
            if candidate.is_null() {
                break;
            }
            if candidate != player && IsWindowVisible(candidate) != 0 && IsIconic(candidate) == 0 {
                let mut rect: RECT = std::mem::zeroed();
                if GetWindowRect(candidate, &mut rect) != 0
                    && rect.left < target.right
                    && rect.right > target.left
                    && rect.top < target.bottom
                    && rect.bottom > target.top
                    && matches!(
                        class_name(candidate).as_str(),
                        "Shell_TrayWnd" | "Shell_SecondaryTrayWnd"
                    )
                {
                    return Some(candidate);
                }
            }
            let next = GetWindow(candidate, GW_HWNDNEXT);
            if next == candidate {
                break;
            }
            candidate = next;
        }
        None
    }

    unsafe fn is_above(player: HWND, taskbar: HWND) -> bool {
        let mut above = GetWindow(player, GW_HWNDPREV);
        for _ in 0..512 {
            if above.is_null() || above == player {
                return false;
            }
            if above == taskbar {
                return true;
            }
            above = GetWindow(above, GW_HWNDPREV);
        }
        false
    }

    // Returns whether the target remains valid / the requested native call succeeds.
    // Hidden windows are deliberately left alone; fullscreen visibility owns them.
    unsafe fn repair(player: HWND, generation: Option<u64>, shell_promotion: bool) -> bool {
        let valid = || match generation {
            Some(value) => is_current(player, value),
            None => !player.is_null() && IsWindow(player) != 0,
        };
        if !valid() {
            return false;
        }
        if IsWindowVisible(player) == 0 || IsIconic(player) != 0 {
            return true;
        }
        let lost_topmost = GetWindowLongPtrW(player, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST == 0;
        let mut target: RECT = std::mem::zeroed();
        if GetWindowRect(player, &mut target) == 0 {
            return false;
        }
        let taskbar = intersecting_taskbar(player, &target);
        let occluded = taskbar.is_some_and(|bar| is_above(player, bar));
        let promote = shell_promotion && taskbar.is_some();
        if !lost_topmost && !occluded && !promote {
            return true;
        }

        // Position just above the bar, preserving higher menu/notification
        // windows. A non-topmost predecessor cannot preserve the required style.
        let insert_after = taskbar.map_or(HWND_TOPMOST, |bar| {
            let mut preceding = GetWindow(bar, GW_HWNDPREV);
            if preceding == player {
                preceding = GetWindow(player, GW_HWNDPREV);
            }
            if !preceding.is_null()
                && IsWindow(preceding) != 0
                && GetWindowLongPtrW(preceding, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST != 0
            {
                preceding
            } else {
                HWND_TOPMOST
            }
        });
        let flags =
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING;
        if !valid() || IsWindowVisible(player) == 0 {
            return false;
        }
        // A shell activation can change compositor order without changing the
        // HWND list. Promote once for that signal; timer checks stay conditional.
        if promote && SetWindowPos(player, HWND_TOPMOST, 0, 0, 0, 0, flags) == 0 {
            return false;
        }
        if !valid() || IsWindowVisible(player) == 0 {
            return false;
        }
        SetWindowPos(player, insert_after, 0, 0, 0, 0, flags) != 0
    }

    unsafe extern "system" fn hook_proc(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        id_object: i32,
        id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        let generation = GENERATION.load(Ordering::SeqCst);
        let player = PLAYER_HWND.load(Ordering::SeqCst) as HWND;
        if !is_current(player, generation) || IsWindowVisible(player) == 0 {
            return;
        }
        let source = if hwnd.is_null() {
            hwnd
        } else {
            GetAncestor(hwnd, GA_ROOT)
        };
        if source == player {
            return;
        }
        let shell = !source.is_null() && is_shell_window(source);
        let check = match event {
            EVENT_SYSTEM_FOREGROUND | EVENT_OBJECT_REORDER => true,
            EVENT_OBJECT_SHOW => id_object == OBJID_WINDOW && id_child == 0,
            EVENT_OBJECT_FOCUS | EVENT_SYSTEM_MENUSTART => shell,
            _ => false,
        };
        if !check {
            return;
        }
        if shell
            && matches!(
                event,
                EVENT_SYSTEM_FOREGROUND | EVENT_OBJECT_FOCUS | EVENT_SYSTEM_MENUSTART
            )
        {
            SHELL_PROMOTION_PENDING.with(|pending| pending.set(true));
        }
        if REFRESH_PENDING.with(|pending| pending.replace(true)) {
            return;
        }
        if PostThreadMessageW(
            GetCurrentThreadId(),
            WM_REFRESH,
            generation as usize,
            player as isize,
        ) == 0
        {
            REFRESH_PENDING.with(|pending| pending.set(false));
        }
    }

    unsafe fn stop_resources(hooks: &mut Vec<HWINEVENTHOOK>, timer: &mut usize) {
        if *timer != 0 {
            KillTimer(std::ptr::null_mut(), *timer);
            *timer = 0;
        }
        for hook in hooks.drain(..) {
            UnhookWinEvent(hook);
        }
        REFRESH_PENDING.with(|pending| pending.set(false));
        SHELL_PROMOTION_PENDING.with(|pending| pending.set(false));
    }

    fn guard_thread() -> &'static GuardThread {
        GUARD_THREAD.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<u32>();
            std::thread::spawn(move || unsafe {
                let tid = GetCurrentThreadId();
                let mut msg: MSG = std::mem::zeroed();
                PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
                let _ = tx.send(tid);
                let mut hooks = Vec::<HWINEVENTHOOK>::new();
                let mut timer = 0usize;
                let mut active_generation = 0u64;
                let mut active_player = 0isize;
                while GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) > 0 {
                    let message_generation = msg.wParam as u64;
                    match msg.message {
                        WM_INSTALL => {
                            let player = msg.lParam as HWND;
                            if !is_current(player, message_generation) {
                                continue;
                            }
                            stop_resources(&mut hooks, &mut timer);
                            active_generation = message_generation;
                            active_player = player as isize;
                            for event in [
                                EVENT_SYSTEM_FOREGROUND,
                                EVENT_OBJECT_FOCUS,
                                EVENT_SYSTEM_MENUSTART,
                                EVENT_OBJECT_REORDER,
                                EVENT_OBJECT_SHOW,
                            ] {
                                let hook = SetWinEventHook(
                                    event,
                                    event,
                                    std::ptr::null_mut(),
                                    Some(hook_proc),
                                    0,
                                    0,
                                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                                );
                                if !hook.is_null() {
                                    hooks.push(hook);
                                }
                            }
                            // With NULL HWND, Windows chooses the actual timer id.
                            timer = SetTimer(std::ptr::null_mut(), 0, CHECK_INTERVAL_MS, None);
                            repair(player, Some(active_generation), true);
                        }
                        WM_UNINSTALL => {
                            if GENERATION.load(Ordering::SeqCst) == message_generation
                                && PLAYER_HWND.load(Ordering::SeqCst) == 0
                            {
                                stop_resources(&mut hooks, &mut timer);
                                active_generation = 0;
                                active_player = 0;
                            }
                        }
                        WM_REFRESH => {
                            if active_generation != message_generation
                                || active_player != msg.lParam
                                || !is_current(active_player as HWND, active_generation)
                            {
                                continue;
                            }
                            REFRESH_PENDING.with(|pending| pending.set(false));
                            let promote =
                                SHELL_PROMOTION_PENDING.with(|pending| pending.replace(false));
                            repair(active_player as HWND, Some(active_generation), promote);
                        }
                        WM_TIMER if timer != 0 && msg.wParam == timer => {
                            repair(active_player as HWND, Some(active_generation), false);
                        }
                        _ => {
                            TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        }
                    }
                }
                stop_resources(&mut hooks, &mut timer);
                let _control = CONTROL.lock().unwrap_or_else(|error| error.into_inner());
                if GENERATION.load(Ordering::SeqCst) == active_generation
                    && PLAYER_HWND.load(Ordering::SeqCst) == active_player
                {
                    GENERATION.fetch_add(1, Ordering::SeqCst);
                    PLAYER_HWND.store(0, Ordering::SeqCst);
                    remove_identity(active_player as HWND, active_generation);
                }
            });
            GuardThread {
                thread_id: rx.recv().expect("taskbar zorder guard thread init failed"),
            }
        })
    }

    pub fn install(player_hwnd: isize) -> bool {
        let _control = CONTROL.lock().unwrap_or_else(|error| error.into_inner());
        let player = player_hwnd as HWND;
        if player.is_null() || unsafe { IsWindow(player) } == 0 {
            return false;
        }
        let previous = PLAYER_HWND.load(Ordering::SeqCst);
        let previous_generation = GENERATION.fetch_add(1, Ordering::SeqCst);
        let generation = previous_generation.wrapping_add(1);
        PLAYER_HWND.store(0, Ordering::SeqCst);
        unsafe { remove_identity(previous as HWND, previous_generation) };
        if unsafe { SetPropW(player, property_name(), generation as usize as _) } == 0 {
            if let Some(thread) = GUARD_THREAD.get() {
                unsafe {
                    PostThreadMessageW(thread.thread_id, WM_UNINSTALL, generation as usize, 0)
                };
            }
            return false;
        }
        PLAYER_HWND.store(player_hwnd, Ordering::SeqCst);
        let thread = guard_thread();
        let posted = unsafe {
            PostThreadMessageW(
                thread.thread_id,
                WM_INSTALL,
                generation as usize,
                player_hwnd,
            )
        } != 0;
        if !posted {
            PLAYER_HWND.store(0, Ordering::SeqCst);
            unsafe { remove_identity(player, generation) };
        }
        posted
    }

    pub fn refresh(player_hwnd: isize) -> bool {
        {
            let _control = CONTROL.lock().unwrap_or_else(|error| error.into_inner());
            let generation = GENERATION.load(Ordering::SeqCst);
            if PLAYER_HWND.load(Ordering::SeqCst) == player_hwnd
                && unsafe { is_current(player_hwnd as HWND, generation) }
            {
                if let Some(thread) = GUARD_THREAD.get() {
                    return unsafe {
                        PostThreadMessageW(
                            thread.thread_id,
                            WM_REFRESH,
                            generation as usize,
                            player_hwnd,
                        )
                    } != 0;
                }
            }
        }
        // Before installation / after uninstall, perform a single conditional
        // repair with no hooks or timer. Never hold CONTROL over SetWindowPos.
        unsafe { repair(player_hwnd as HWND, None, false) }
    }

    pub fn uninstall() {
        let _control = CONTROL.lock().unwrap_or_else(|error| error.into_inner());
        let previous = PLAYER_HWND.load(Ordering::SeqCst);
        let previous_generation = GENERATION.fetch_add(1, Ordering::SeqCst);
        let generation = previous_generation.wrapping_add(1);
        PLAYER_HWND.store(0, Ordering::SeqCst);
        unsafe { remove_identity(previous as HWND, previous_generation) };
        if let Some(thread) = GUARD_THREAD.get() {
            unsafe { PostThreadMessageW(thread.thread_id, WM_UNINSTALL, generation as usize, 0) };
        }
    }
}

/// 安装任务栏 Z-order 守护。
/// 播控窗口显示后调用，传入播控窗口句柄以监听其是否被任务栏遮盖。
#[tauri::command]
pub fn install_taskbar_zorder_guard(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use tauri::Manager;

        if let Some(window) = app.get_webview_window(TASKBAR_PLAYER_WINDOW_LABEL) {
            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    return zorder_guard::install(win32.hwnd.get() as isize);
                }
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        false
    }
}

/// 主动刷新任务栏播控窗口 Z-order。
#[tauri::command]
pub fn refresh_taskbar_window_topmost(app: tauri::AppHandle) -> bool {
    #[cfg(target_os = "windows")]
    {
        use raw_window_handle::{HasWindowHandle, RawWindowHandle};
        use tauri::Manager;

        if let Some(window) = app.get_webview_window(TASKBAR_PLAYER_WINDOW_LABEL) {
            if let Ok(handle) = window.as_ref().window().window_handle() {
                if let RawWindowHandle::Win32(win32) = handle.as_raw() {
                    return zorder_guard::refresh(win32.hwnd.get() as isize);
                }
            }
        }
        false
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = app;
        false
    }
}

/// 卸载任务栏 Z-order 守护。
/// 播控窗口隐藏或销毁前调用，防止回调访问已失效的 HWND。
#[tauri::command]
pub fn uninstall_taskbar_zorder_guard() {
    #[cfg(target_os = "windows")]
    {
        zorder_guard::uninstall();
    }
}
