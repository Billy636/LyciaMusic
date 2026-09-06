#[tauri::command]
pub fn refresh_current_window_topmost(window: tauri::Window, enabled: bool) {
    #[cfg(target_os = "windows")]
    {
        refresh_window_topmost(&window, enabled);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = (window, enabled);
    }
}

#[tauri::command]
pub fn start_topmost_guard(window: tauri::Window) {
    #[cfg(target_os = "windows")]
    {
        start_window_topmost_guard(&window);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
    }
}

#[tauri::command]
pub fn stop_topmost_guard(window: tauri::Window) {
    #[cfg(target_os = "windows")]
    {
        stop_window_topmost_guard(&window);
    }

    #[cfg(not(target_os = "windows"))]
    {
        let _ = window;
    }
}

#[cfg(target_os = "windows")]
mod platform {
    use std::{
        cell::RefCell,
        sync::atomic::{AtomicIsize, Ordering},
    };

    use raw_window_handle::{HasWindowHandle, RawWindowHandle};
    use tauri::Window;
    use windows_sys::Win32::{
        Foundation::HWND,
        UI::{
            Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK},
            WindowsAndMessaging::{
                GetAncestor, GetClassNameW, IsWindow, SetWindowPos, EVENT_OBJECT_FOCUS,
                EVENT_SYSTEM_FOREGROUND, EVENT_SYSTEM_MENUSTART, GA_ROOT, HWND_NOTOPMOST,
                HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSENDCHANGING,
                SWP_NOSIZE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS,
            },
        },
    };

    static TARGET_HWND: AtomicIsize = AtomicIsize::new(0);

    thread_local! {
        static ACTIVE_GUARD: RefCell<Option<TopMostGuard>> = RefCell::new(None);
    }

    pub(super) fn refresh_window_topmost(window: &Window, enabled: bool) {
        if let Some(hwnd) = window_hwnd(window) {
            let hwnd_value = hwnd as isize;
            let _ = window.run_on_main_thread(move || {
                let hwnd = hwnd_value as HWND;
                set_topmost_state(hwnd, enabled);
            });
        }
    }

    pub(super) fn start_window_topmost_guard(window: &Window) {
        let Some(hwnd) = window_hwnd(window) else {
            return;
        };

        let hwnd_value = hwnd as isize;
        TARGET_HWND.store(hwnd_value, Ordering::SeqCst);

        let _ = window.run_on_main_thread(move || {
            // 时序检查：如果在排队期间 TARGET_HWND 已经被 stop 改变，则忽略本次操作
            if TARGET_HWND.load(Ordering::SeqCst) != hwnd_value {
                return;
            }

            let hwnd = hwnd_value as HWND;
            set_topmost_state(hwnd, true);

            ACTIVE_GUARD.with(|guard| {
                let mut guard_lock = guard.borrow_mut();
                if let Some(existing_guard) = guard_lock.take() {
                    existing_guard.stop();
                }

                if let Some(new_guard) = TopMostGuard::start(hwnd) {
                    *guard_lock = Some(new_guard);
                }
            });
        });
    }

    pub(super) fn stop_window_topmost_guard(window: &Window) {
        TARGET_HWND.store(0, Ordering::SeqCst);

        let _ = window.run_on_main_thread(move || {
            // 时序检查：如果在排队期间 TARGET_HWND 已经被新的 start 改变，则忽略卸载
            if TARGET_HWND.load(Ordering::SeqCst) != 0 {
                return;
            }

            ACTIVE_GUARD.with(|guard| {
                let mut guard_lock = guard.borrow_mut();
                if let Some(existing_guard) = guard_lock.take() {
                    existing_guard.stop();
                }
            });
        });
    }

    fn window_hwnd(window: &Window) -> Option<HWND> {
        let handle = window.window_handle().ok()?;
        match handle.as_raw() {
            RawWindowHandle::Win32(win32) => Some(win32.hwnd.get() as HWND),
            _ => None,
        }
    }

    fn set_topmost_state(hwnd: HWND, enabled: bool) {
        if hwnd.is_null() {
            return;
        }

        let flags =
            SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOSENDCHANGING;

        unsafe {
            if enabled {
                let _ = SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags);
            } else {
                let _ = SetWindowPos(hwnd, HWND_NOTOPMOST, 0, 0, 0, 0, flags);
            }
        }
    }

    struct TopMostGuard {
        foreground_hook: HWINEVENTHOOK,
        focus_hook: Option<HWINEVENTHOOK>,
        menu_hook: Option<HWINEVENTHOOK>,
    }

    impl TopMostGuard {
        fn start(hwnd: HWND) -> Option<Self> {
            let foreground_hook = unsafe {
                SetWinEventHook(
                    EVENT_SYSTEM_FOREGROUND,
                    EVENT_SYSTEM_FOREGROUND,
                    std::ptr::null_mut(),
                    Some(topmost_guard_event_hook),
                    0,
                    0,
                    WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
                )
            };

            if foreground_hook.is_null() {
                None
            } else {
                let focus_hook = install_optional_hook(EVENT_OBJECT_FOCUS);
                let menu_hook = install_optional_hook(EVENT_SYSTEM_MENUSTART);
                set_topmost_state(hwnd, true);
                Some(Self {
                    foreground_hook,
                    focus_hook,
                    menu_hook,
                })
            }
        }

        fn stop(self) {
            unsafe {
                let _ = UnhookWinEvent(self.foreground_hook);
                if let Some(hook) = self.focus_hook {
                    let _ = UnhookWinEvent(hook);
                }
                if let Some(hook) = self.menu_hook {
                    let _ = UnhookWinEvent(hook);
                }
            }
        }
    }

    fn install_optional_hook(event: u32) -> Option<HWINEVENTHOOK> {
        let hook = unsafe {
            SetWinEventHook(
                event,
                event,
                std::ptr::null_mut(),
                Some(topmost_guard_event_hook),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            )
        };

        if hook.is_null() {
            None
        } else {
            Some(hook)
        }
    }

    unsafe extern "system" fn topmost_guard_event_hook(
        _hook: HWINEVENTHOOK,
        event: u32,
        hwnd: HWND,
        _id_object: i32,
        _id_child: i32,
        _event_thread: u32,
        _event_time: u32,
    ) {
        let target = TARGET_HWND.load(Ordering::SeqCst) as HWND;
        if target.is_null() {
            return;
        }

        if IsWindow(target) == 0 {
            return;
        }

        if !should_refresh_for_event(event, hwnd, target) {
            return;
        }

        set_topmost_state(target, true);
    }

    fn should_refresh_for_event(event: u32, hwnd: HWND, target: HWND) -> bool {
        let source_root = root_window(hwnd);
        if !source_root.is_null() && source_root == target {
            return false;
        }

        match event {
            EVENT_SYSTEM_FOREGROUND => true,
            EVENT_OBJECT_FOCUS | EVENT_SYSTEM_MENUSTART => is_shell_window(source_root),
            _ => false,
        }
    }

    fn root_window(hwnd: HWND) -> HWND {
        if hwnd.is_null() {
            return hwnd;
        }

        unsafe {
            let root = GetAncestor(hwnd, GA_ROOT);
            if root.is_null() {
                hwnd
            } else {
                root
            }
        }
    }

    fn is_shell_window(hwnd: HWND) -> bool {
        let Some(class_name) = window_class_name(hwnd) else {
            return false;
        };

        matches!(
            class_name.as_str(),
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

    fn window_class_name(hwnd: HWND) -> Option<String> {
        if hwnd.is_null() {
            return None;
        }

        unsafe {
            let mut buffer = [0u16; 256];
            let len = GetClassNameW(hwnd, buffer.as_mut_ptr(), buffer.len() as i32);
            if len <= 0 {
                return None;
            }

            String::from_utf16(&buffer[..len as usize]).ok()
        }
    }
}

#[cfg(target_os = "windows")]
use platform::{refresh_window_topmost, start_window_topmost_guard, stop_window_topmost_guard};
