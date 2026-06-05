use std::sync::atomic::{AtomicIsize, Ordering};

pub static LAST_TASKBAR_HWND: AtomicIsize = AtomicIsize::new(0);
const TASKBAR_PLAYER_WINDOW_LABEL: &str = "taskbar-player";

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
        if actual_len == target_class_utf16.len() && &class_name[..actual_len] == target_class_utf16 {
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
        use windows_sys::Win32::Foundation::{GetLastError, HWND, SetLastError};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, GetWindowLongW, SetWindowLongPtrW, SetWindowLongW, GWL_EXSTYLE,
            GWLP_HWNDPARENT, WS_EX_NOACTIVATE,
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
                let hwnd_taskbar = unsafe { FindWindowW(shell_tray_class.as_ptr(), std::ptr::null()) };

                if !hwnd_taskbar.is_null() {
                    let mut bound_success = false;
                    unsafe {
                        SetLastError(0);
                        let prev = SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, hwnd_taskbar as isize);
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
        use windows_sys::Win32::Foundation::{GetLastError, HWND, RECT, SetLastError};
        use windows_sys::Win32::UI::Shell::{ABM_GETTASKBARPOS, APPBARDATA, SHAppBarMessage};
        use windows_sys::Win32::UI::WindowsAndMessaging::{
            FindWindowW, GetWindowRect, SetWindowLongPtrW, GWLP_HWNDPARENT,
        };

        let window = app
            .get_webview_window(TASKBAR_PLAYER_WINDOW_LABEL)
            .ok_or_else(|| "Taskbar player window not found".to_string())?;

        // 1. 查找当前主系统任务栏句柄
        let shell_tray_class: Vec<u16> = "Shell_TrayWnd\0".encode_utf16().collect();
        let current_hwnd_taskbar = unsafe { FindWindowW(shell_tray_class.as_ptr(), std::ptr::null()) };

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
                        let prev = SetWindowLongPtrW(hwnd, GWLP_HWNDPARENT, current_hwnd_taskbar as isize);
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
            rc: RECT { left: 0, top: 0, right: 0, bottom: 0 },
            lParam: 0,
        };
        let mut taskbar_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
        let got_taskbar = unsafe { SHAppBarMessage(ABM_GETTASKBARPOS, &mut abd) != 0 };
        if got_taskbar {
            taskbar_rect = abd.rc;
        } else {
            // SHAppBarMessage 失败时的 GetWindowRect 物理兜底
            unsafe {
                GetWindowRect(current_hwnd_taskbar, &mut taskbar_rect);
            }
        }

        // 3. 递归安全深度查找托盘通知区域，限制在 3 层内，最多遍历 64 个节点
        let tray_class_utf16: Vec<u16> = "TrayNotifyWnd".encode_utf16().collect();
        let mut node_count = 0;
        let hwnd_tray = find_window_recursive(
            current_hwnd_taskbar,
            &tray_class_utf16,
            0,
            3,
            &mut node_count,
        );

        let mut tray_rect = RECT { left: 0, top: 0, right: 0, bottom: 0 };
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

// ── Z-order 守护：防止任务栏点击遮盖播控窗口 ──────────────────────────────────
//
// 原理：注册三路 WinEventHook，监听与 TopMostGuard 完全相同的事件集。
// 当任意"前台窗口切换"或"Shell 类窗口焦点/菜单"事件发生时，立即将播控窗口
// 重新置顶（SetWindowPos HWND_TOPMOST），从而在用户感知帧内完成补救。
// 该 hook 使用 WINEVENT_OUTOFCONTEXT，由专用守护线程的消息循环驱动，
// 不注入目标进程，安全可靠。
#[cfg(target_os = "windows")]
mod zorder_guard {
    use std::sync::atomic::{AtomicIsize, AtomicU64, Ordering};
    use std::sync::{mpsc, OnceLock};
    use std::time::Duration;

    use windows_sys::Win32::Foundation::HWND;
    use windows_sys::Win32::System::Threading::GetCurrentThreadId;
    use windows_sys::Win32::UI::Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK};
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        DispatchMessageW, GetAncestor, GetClassNameW, GetMessageW, IsWindow, PeekMessageW,
        PostThreadMessageW, SetWindowPos, TranslateMessage, GA_ROOT, HWND_TOPMOST, MSG,
        PM_NOREMOVE, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
        SWP_NOSENDCHANGING, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WM_APP,
    };

    /// 播控窗口 HWND（跨线程原子存储）
    pub static PLAYER_HWND: AtomicIsize = AtomicIsize::new(0);
    static REFRESH_TOKEN: AtomicU64 = AtomicU64::new(0);

    /// 守护线程控制消息
    const WM_INSTALL: u32 = WM_APP + 0x200;
    const WM_UNINSTALL: u32 = WM_APP + 0x201;

    // ── 监听与 TopMostGuard 完全相同的三类事件 ─────────────────────────────────
    //
    // EVENT_OBJECT_LOCATIONCHANGE（0x800B）在纯 Z-order 变化（窗口只改变层级，
    // 不改变位置/大小）时【不会】触发，因此不能用于捕捉任务栏被置顶的场景。
    //
    // 正确做法：
    //   • EVENT_SYSTEM_FOREGROUND (0x0003)：任意窗口成为前台窗口时触发。
    //     点击任务栏空白区域会让 Shell_TrayWnd 成为前台，此事件必然触发。
    //   • EVENT_OBJECT_FOCUS     (0x8005)：焦点转移到 Shell 类窗口时触发。
    //     捕捉 NotifyIconOverflowWindow（显示/隐藏图标箭头弹出框）等场景。
    //   • EVENT_SYSTEM_MENUSTART (0x0004)：开始菜单或系统菜单弹出时触发。
    const EVENT_SYSTEM_FOREGROUND: u32 = 0x0003;
    const EVENT_SYSTEM_MENUSTART: u32 = 0x0004;
    const EVENT_OBJECT_FOCUS: u32 = 0x8005;

    struct GuardThread {
        thread_id: u32,
    }

    static GUARD_THREAD: OnceLock<GuardThread> = OnceLock::new();

    /// 获取窗口的根祖先（最顶层父窗口）
    fn root_window(hwnd: HWND) -> HWND {
        if hwnd.is_null() {
            return hwnd;
        }
        unsafe {
            let root = GetAncestor(hwnd, GA_ROOT);
            if root.is_null() { hwnd } else { root }
        }
    }

    /// 判断是否为 Shell 类窗口（任务栏、通知区域、溢出窗口等）
    fn is_shell_window(hwnd: HWND) -> bool {
        if hwnd.is_null() {
            return false;
        }
        unsafe {
            let mut buf = [0u16; 256];
            let len = GetClassNameW(hwnd, buf.as_mut_ptr(), buf.len() as i32);
            if len <= 0 {
                return false;
            }
            let class = String::from_utf16_lossy(&buf[..len as usize]);
            matches!(
                class.as_str(),
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
    }

    fn refresh_player_topmost(player: HWND) {
        if player.is_null() {
            return;
        }

        unsafe {
            if IsWindow(player) == 0 {
                return;
            }

            SetWindowPos(
                player,
                HWND_TOPMOST,
                0, 0, 0, 0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOSENDCHANGING | SWP_NOOWNERZORDER,
            );
        }
    }

    fn schedule_player_topmost_refresh(player: HWND) {
        let token = REFRESH_TOKEN.fetch_add(1, Ordering::Relaxed) + 1;
        refresh_player_topmost(player);

        let player_hwnd = player as isize;
        std::thread::spawn(move || {
            for delay_ms in [40_u64, 120, 300, 700] {
                std::thread::sleep(Duration::from_millis(delay_ms));
                if REFRESH_TOKEN.load(Ordering::Relaxed) != token {
                    return;
                }

                refresh_player_topmost(player_hwnd as HWND);
            }
        });
    }

    /// WinEventHook 回调（与 TopMostGuard 逻辑对称，但守护目标是播控窗口）
    ///
    /// • EVENT_SYSTEM_FOREGROUND：任意窗口变为前台时重新置顶播控窗口
    /// • EVENT_OBJECT_FOCUS / EVENT_SYSTEM_MENUSTART：仅当事件源是 Shell 类
    ///   窗口时响应（避免对普通应用的焦点切换产生不必要的 SetWindowPos 调用）
    unsafe extern "system" fn hook_proc(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        let player = PLAYER_HWND.load(Ordering::Relaxed) as HWND;
        if player.is_null() || IsWindow(player) == 0 {
            return;
        }

        // 事件源根窗口是播控窗口自身时跳过，避免自触发
        let source_root = root_window(hwnd);
        if !source_root.is_null() && source_root == player {
            return;
        }

        let should_refresh = match event {
            // 任意前台切换都需要重置，因为新前台窗口可能是 TOPMOST
            EVENT_SYSTEM_FOREGROUND => true,
            // 焦点/菜单事件仅在 Shell 类窗口上响应
            EVENT_OBJECT_FOCUS | EVENT_SYSTEM_MENUSTART => is_shell_window(source_root),
            _ => false,
        };

        if should_refresh {
            schedule_player_topmost_refresh(player);
        }
    }

    /// 惰性启动守护线程（进程生命周期内仅初始化一次）
    fn guard_thread() -> &'static GuardThread {
        GUARD_THREAD.get_or_init(|| {
            let (tx, rx) = mpsc::channel::<u32>();

            std::thread::spawn(move || unsafe {
                let tid = GetCurrentThreadId();

                // 先强制创建消息队列，再通知主线程，防止 PostThreadMessageW 发到空队列
                let mut msg: MSG = std::mem::zeroed();
                PeekMessageW(&mut msg, std::ptr::null_mut(), 0, 0, PM_NOREMOVE);
                let _ = tx.send(tid);

                // 同时维护三个 hook 句柄，对应三类事件
                let mut hook_fg: HWINEVENTHOOK = std::ptr::null_mut();   // EVENT_SYSTEM_FOREGROUND
                let mut hook_focus: HWINEVENTHOOK = std::ptr::null_mut(); // EVENT_OBJECT_FOCUS
                let mut hook_menu: HWINEVENTHOOK = std::ptr::null_mut();  // EVENT_SYSTEM_MENUSTART

                let install_hook = |event: u32| -> HWINEVENTHOOK {
                    SetWinEventHook(
                        event,
                        event,
                        std::ptr::null_mut(),
                        Some(hook_proc),
                        0, // 所有进程
                        0, // 所有线程
                        WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                    )
                };

                let unhook = |h: &mut HWINEVENTHOOK| {
                    if !h.is_null() {
                        UnhookWinEvent(*h);
                        *h = std::ptr::null_mut();
                    }
                };

                loop {
                    if GetMessageW(&mut msg, std::ptr::null_mut(), 0, 0) <= 0 {
                        break;
                    }

                    match msg.message {
                        WM_INSTALL => {
                            // 先卸载旧 hook，防止重复安装
                            unhook(&mut hook_fg);
                            unhook(&mut hook_focus);
                            unhook(&mut hook_menu);

                            hook_fg    = install_hook(EVENT_SYSTEM_FOREGROUND);
                            hook_focus = install_hook(EVENT_OBJECT_FOCUS);
                            hook_menu  = install_hook(EVENT_SYSTEM_MENUSTART);
                        }
                        WM_UNINSTALL => {
                            unhook(&mut hook_fg);
                            unhook(&mut hook_focus);
                            unhook(&mut hook_menu);
                            PLAYER_HWND.store(0, Ordering::Relaxed);
                        }
                        _ => {
                            TranslateMessage(&msg);
                            DispatchMessageW(&msg);
                        }
                    }
                }

                // 线程异常退出时确保所有 hook 被清理
                unhook(&mut hook_fg);
                unhook(&mut hook_focus);
                unhook(&mut hook_menu);
            });

            let thread_id = rx.recv().expect("taskbar zorder guard thread init failed");
            GuardThread { thread_id }
        })
    }

    /// 安装 Z-order 守护：记录播控窗口 HWND 并启动 WinEventHook
    pub fn install(player_hwnd: isize) {
        PLAYER_HWND.store(player_hwnd, Ordering::Relaxed);
        schedule_player_topmost_refresh(player_hwnd as HWND);
        let t = guard_thread();
        unsafe {
            PostThreadMessageW(t.thread_id, WM_INSTALL, 0, 0);
        }
    }

    /// 主动刷新播控窗口层级，不重复安装 hook。
    pub fn refresh(player_hwnd: isize) {
        schedule_player_topmost_refresh(player_hwnd as HWND);
    }

    /// 卸载 Z-order 守护：移除 WinEventHook 并清空 HWND
    pub fn uninstall() {
        if let Some(t) = GUARD_THREAD.get() {
            unsafe {
                PostThreadMessageW(t.thread_id, WM_UNINSTALL, 0, 0);
            }
        } else {
            // 守护线程尚未初始化时，直接清空 HWND 即可
            PLAYER_HWND.store(0, Ordering::Relaxed);
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
                    zorder_guard::install(win32.hwnd.get() as isize);
                    return true;
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
                    zorder_guard::refresh(win32.hwnd.get() as isize);
                    return true;
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
