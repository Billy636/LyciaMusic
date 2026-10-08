use std::{
    cell::Cell,
    time::{Duration, Instant},
};
use windows::{core::Result as WinResult, Win32::Foundation::HWND as NativeHwnd};
use windows_sys::Win32::{
    Foundation::{HWND, RECT},
    Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
    UI::{
        Accessibility::{SetWinEventHook, UnhookWinEvent, HWINEVENTHOOK},
        WindowsAndMessaging::{
            GetWindow, GetWindowLongPtrW, GetWindowRect, IsIconic, IsWindowVisible, SetWindowPos,
            ShowWindow, EVENT_OBJECT_LOCATIONCHANGE, EVENT_OBJECT_REORDER, EVENT_OBJECT_SHOW,
            EVENT_SYSTEM_FOREGROUND, GWL_EXSTYLE, GW_HWNDPREV, HWND_NOTOPMOST, HWND_TOPMOST,
            OBJID_WINDOW, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOOWNERZORDER, SWP_NOSIZE,
            SW_SHOWNOACTIVATE, WINEVENT_OUTOFCONTEXT, WINEVENT_SKIPOWNPROCESS, WS_EX_TOPMOST,
        },
    },
};

const CHECK_INTERVAL: Duration = Duration::from_millis(100);

thread_local! {
    // OUTOFCONTEXT hooks run on the lyrics thread when it pumps messages.
    // Only coalesce a signal here: changing Z order inside the callback can reenter it.
    static Z_ORDER_DIRTY: Cell<bool> = const { Cell::new(false) };
}

unsafe extern "system" fn on_window_event(
    _hook: HWINEVENTHOOK,
    event: u32,
    _hwnd: HWND,
    object: i32,
    child: i32,
    _thread: u32,
    _time: u32,
) {
    if event == EVENT_SYSTEM_FOREGROUND || (object == OBJID_WINDOW && child == 0) {
        // REORDER may come from the desktop/parent, rather than the foreground window.
        Z_ORDER_DIRTY.with(|dirty| dirty.set(true));
    }
}

#[derive(Default)]
struct EventHooks(Vec<HWINEVENTHOOK>);
impl EventHooks {
    unsafe fn install() -> Self {
        let mut hooks = Self::default();
        for event in [
            EVENT_SYSTEM_FOREGROUND,
            EVENT_OBJECT_REORDER,
            EVENT_OBJECT_SHOW,
            EVENT_OBJECT_LOCATIONCHANGE,
        ] {
            let hook = SetWinEventHook(
                event,
                event,
                std::ptr::null_mut(),
                Some(on_window_event),
                0,
                0,
                WINEVENT_OUTOFCONTEXT | WINEVENT_SKIPOWNPROCESS,
            );
            if !hook.is_null() {
                hooks.0.push(hook);
            }
        }
        // The periodic check still works if Windows refuses any of the hooks.
        hooks
    }
}
impl Drop for EventHooks {
    fn drop(&mut self) {
        for hook in self.0.drain(..) {
            unsafe {
                UnhookWinEvent(hook);
            }
        }
    }
}

pub(super) struct TopmostGuard {
    enabled: Option<bool>,
    hooks: Option<EventHooks>,
    last_check: Instant,
}
impl TopmostGuard {
    pub(super) fn new() -> Self {
        Self {
            enabled: None,
            hooks: None,
            last_check: Instant::now() - CHECK_INTERVAL,
        }
    }

    pub(super) fn request_refresh(&self) {
        Z_ORDER_DIRTY.with(|dirty| dirty.set(true));
    }

    // Called only on the HWND's owning thread, after applying automatic visibility.
    pub(super) unsafe fn update(
        &mut self,
        hwnd: NativeHwnd,
        enabled: bool,
        visible: bool,
    ) -> WinResult<bool> {
        let hwnd = hwnd.0;
        let changed = self.enabled != Some(enabled);
        if changed {
            set_topmost(hwnd, enabled)?;
            self.enabled = Some(enabled);
        }

        if !visible {
            self.hooks = None;
            Z_ORDER_DIRTY.with(|dirty| dirty.set(false));
            return Ok(false);
        }

        // Logical visibility can stay true while Windows hides/minimizes the
        // HWND during a mode switch. Restore its actual state without focus.
        let restored_visibility = IsWindowVisible(hwnd) == 0 || IsIconic(hwnd) != 0;
        if restored_visibility {
            ShowWindow(hwnd, SW_SHOWNOACTIVATE);
        }
        if !enabled {
            self.hooks = None;
            Z_ORDER_DIRTY.with(|dirty| dirty.set(false));
            return Ok(restored_visibility);
        }

        let starting = self.hooks.is_none();
        if starting {
            self.hooks = Some(EventHooks::install());
        }
        let dirty = Z_ORDER_DIRTY.with(|dirty| dirty.replace(false));
        if starting
            || changed
            || dirty
            || restored_visibility
            || self.last_check.elapsed() >= CHECK_INTERVAL
        {
            self.last_check = Instant::now();
            // Games can promote themselves again after the foreground event, or
            // change only Z order without a location event. Inspect the actual order.
            // A mode/foreground notification also needs a real promotion when
            // the HWND list appears unchanged; it does not describe scanout.
            if starting || changed || dirty || restored_visibility || needs_restore(hwnd) {
                set_topmost(hwnd, true)?;
            }
        }
        Ok(restored_visibility)
    }
}

unsafe fn set_topmost(hwnd: HWND, enabled: bool) -> WinResult<()> {
    if SetWindowPos(
        hwnd,
        if enabled {
            HWND_TOPMOST
        } else {
            HWND_NOTOPMOST
        },
        0,
        0,
        0,
        0,
        SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_NOOWNERZORDER,
    ) == 0
    {
        return Err(windows::core::Error::from_win32());
    }
    Ok(())
}

unsafe fn needs_restore(hwnd: HWND) -> bool {
    if GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32 & WS_EX_TOPMOST == 0 {
        return true;
    }
    let mut target: RECT = std::mem::zeroed();
    if GetWindowRect(hwnd, &mut target) == 0 {
        return false;
    }
    let mut above = GetWindow(hwnd, GW_HWNDPREV);
    // Bound the walk because windows can be created/destroyed while checking.
    for _ in 0..128 {
        if above.is_null() {
            return false;
        }
        if IsWindowVisible(above) != 0 && IsIconic(above) == 0 {
            let mut rect: RECT = std::mem::zeroed();
            if GetWindowRect(above, &mut rect) != 0
                && rect.left < target.right
                && rect.right > target.left
                && rect.top < target.bottom
                && rect.bottom > target.top
            {
                let mut cloaked = 0u32;
                DwmGetWindowAttribute(
                    above,
                    DWMWA_CLOAKED as u32,
                    &mut cloaked as *mut u32 as *mut _,
                    std::mem::size_of::<u32>() as u32,
                );
                if cloaked == 0 {
                    return true;
                }
            }
        }
        above = GetWindow(above, GW_HWNDPREV);
    }
    true
}
