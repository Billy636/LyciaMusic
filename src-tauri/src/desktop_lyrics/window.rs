use super::{model::*, render::Renderer};
use std::{
    cell::{Cell, RefCell},
    mem::size_of,
    sync::{mpsc, LazyLock, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};
use windows::{
    core::{w, Result as WinResult},
    Win32::{
        Foundation::{HWND, LPARAM, LRESULT, POINT, RECT, WPARAM},
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        System::{
            Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
            LibraryLoader::GetModuleHandleW,
            Threading::GetCurrentThreadId,
        },
        UI::{
            HiDpi::{GetDpiForSystem, GetDpiForWindow},
            Input::KeyboardAndMouse::{ReleaseCapture, SetCapture},
            WindowsAndMessaging::*,
        },
    },
};

pub enum Command {
    State(Box<Snapshot>),
    Playback(Playback),
    Reveal,
    Close,
}
struct Worker {
    sender: mpsc::Sender<Command>,
    thread_id: u32,
    join: thread::JoinHandle<()>,
}
static WORKER: LazyLock<Mutex<Option<Worker>>> = LazyLock::new(|| Mutex::new(None));
const WAKE: u32 = WM_APP + 71;
const TIMER: usize = 1;

pub fn open(
    app: tauri::AppHandle,
    snapshot: Snapshot,
    bounds: Option<Bounds>,
) -> Result<(), String> {
    let mut slot = WORKER.lock().map_err(|e| e.to_string())?;
    if slot
        .as_ref()
        .is_some_and(|worker| worker.join.is_finished())
    {
        if let Some(worker) = slot.take() {
            let _ = worker.join.join();
        }
    }
    if let Some(worker) = slot.as_ref() {
        worker
            .sender
            .send(Command::State(Box::new(snapshot)))
            .map_err(|e| e.to_string())?;
        worker
            .sender
            .send(Command::Reveal)
            .map_err(|e| e.to_string())?;
        unsafe {
            PostThreadMessageW(worker.thread_id, WAKE, WPARAM(0), LPARAM(0))
                .map_err(|e| e.to_string())?;
        }
        return Ok(());
    }
    let (sender, receiver) = mpsc::channel();
    let (ready_tx, ready_rx) = mpsc::sync_channel(1);
    let join = thread::Builder::new()
        .name("native-desktop-lyrics".into())
        .spawn(move || {
            let outcome = unsafe { run(app.clone(), snapshot, bounds, receiver, &ready_tx) };
            if let Err(error) = outcome {
                let message = format!("Native desktop lyrics: {error}");
                let _ = ready_tx.send(Err(message.clone()));
                eprintln!("{message}");
                let _ = app.emit_to("main", "desktop-lyrics:error", &message);
                let _ = app.emit_to(
                    "main",
                    "desktop-lyrics:visibility",
                    serde_json::json!({"visible":false}),
                );
            }
        })
        .map_err(|e| e.to_string())?;
    match ready_rx.recv().map_err(|e| e.to_string())? {
        Ok(thread_id) => {
            *slot = Some(Worker {
                sender,
                thread_id,
                join,
            });
            Ok(())
        }
        Err(error) => {
            let _ = join.join();
            Err(error)
        }
    }
}

pub fn send(command: Command) -> Result<(), String> {
    let slot = WORKER.lock().map_err(|e| e.to_string())?;
    if let Some(worker) = slot.as_ref() {
        worker.sender.send(command).map_err(|e| e.to_string())?;
        unsafe {
            PostThreadMessageW(worker.thread_id, WAKE, WPARAM(0), LPARAM(0))
                .map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

pub fn close() -> Result<(), String> {
    let mut slot = WORKER.lock().map_err(|e| e.to_string())?;
    if let Some(worker) = slot.take() {
        let _ = worker.sender.send(Command::Close);
        unsafe {
            let _ = PostThreadMessageW(worker.thread_id, WAKE, WPARAM(0), LPARAM(0));
        }
        worker
            .join
            .join()
            .map_err(|_| "Native lyrics thread panicked".to_string())?;
    }
    Ok(())
}

#[derive(Clone, Copy)]
struct HitState {
    locked: bool,
    scale: f32,
    toolbar: bool,
}
impl Default for HitState {
    fn default() -> Self {
        Self {
            locked: false,
            scale: 1.,
            toolbar: false,
        }
    }
}
enum WindowEvent {
    Click,
    Close,
    Bounds,
    DisplayChanged,
}
#[derive(Clone, Copy)]
struct Drag {
    origin: POINT,
    bounds: Bounds,
    hit: u32,
}
thread_local! {
    // WndProc never borrows renderer/state: Win32 calls can synchronously re-enter it.
    static HIT: Cell<HitState> = Cell::new(HitState::default());
    static EVENTS: RefCell<Vec<WindowEvent>> = const { RefCell::new(Vec::new()) };
    static DRAG: Cell<Option<Drag>> = const { Cell::new(None) };
}
fn event(value: WindowEvent) {
    EVENTS.with(|events| events.borrow_mut().push(value));
}

fn toolbar_hit(x: f32, y: f32, width: f32, locked: bool) -> Option<usize> {
    if !(4. ..=42.).contains(&y) {
        return None;
    }
    let count = if locked { 1 } else { 5 };
    let left = width / 2. - count as f32 * 38. / 2.;
    let index = ((x - left) / 38.).floor() as i32;
    (x >= left && index >= 0 && index < count).then_some(index as usize)
}

#[derive(Debug, PartialEq)]
struct ToolbarInteraction {
    visible: bool,
    click_through: bool,
}

fn toolbar_interaction(
    locked: bool,
    over_window: bool,
    button_hit: Option<usize>,
    revealed: bool,
) -> ToolbarInteraction {
    ToolbarInteraction {
        // Discover the unlock button from anywhere over the lyrics, including while
        // WS_EX_TRANSPARENT is active. Global cursor polling does not need WM_MOUSEMOVE.
        visible: over_window || (!locked && revealed),
        // Showing the button must not make the whole lyrics surface intercept clicks.
        click_through: locked && button_hit.is_none(),
    }
}

unsafe extern "system" fn wndproc(hwnd: HWND, message: u32, wp: WPARAM, lp: LPARAM) -> LRESULT {
    match message {
        WM_NCHITTEST => {
            let state = HIT.with(Cell::get);
            let mut rect = RECT::default();
            let _ = GetWindowRect(hwnd, &mut rect);
            let x = (lp.0 as i16 as i32 - rect.left) as f32 / state.scale;
            let y = ((lp.0 >> 16) as i16 as i32 - rect.top) as f32 / state.scale;
            let width = (rect.right - rect.left) as f32 / state.scale;
            let height = (rect.bottom - rect.top) as f32 / state.scale;
            if state.toolbar && toolbar_hit(x, y, width, state.locked).is_some() {
                return LRESULT(HTCLIENT as isize);
            }
            if state.locked {
                return LRESULT(HTTRANSPARENT as isize);
            }
            let left = x < 8.;
            let right = x > width - 8.;
            let top = y < 6.;
            let bottom = y > height - 8.;
            let hit = match (left, right, top, bottom) {
                (true, _, true, _) => HTTOPLEFT,
                (_, true, true, _) => HTTOPRIGHT,
                (true, _, _, true) => HTBOTTOMLEFT,
                (_, true, _, true) => HTBOTTOMRIGHT,
                (true, _, _, _) => HTLEFT,
                (_, true, _, _) => HTRIGHT,
                (_, _, true, _) => HTTOP,
                (_, _, _, true) => HTBOTTOM,
                _ => HTCAPTION,
            };
            LRESULT(hit as isize)
        }
        WM_MOUSEACTIVATE => LRESULT(MA_NOACTIVATE as isize),
        WM_NCCALCSIZE => LRESULT(0), // Keep the resizable frame entirely transparent/client-drawn.
        WM_NCLBUTTONDOWN if !HIT.with(Cell::get).locked => {
            // Modeless capture keeps playback, resize painting and close commands responsive.
            let mut origin = POINT::default();
            if GetCursorPos(&mut origin).is_ok() {
                if let Ok(bounds) = get_bounds(hwnd) {
                    DRAG.with(|drag| {
                        drag.set(Some(Drag {
                            origin,
                            bounds,
                            hit: wp.0 as u32,
                        }))
                    });
                    SetCapture(hwnd);
                }
            }
            LRESULT(0)
        }
        WM_MOUSEMOVE if DRAG.with(Cell::get).is_some() => {
            if let Some(drag) = DRAG.with(Cell::get) {
                let mut cursor = POINT::default();
                if GetCursorPos(&mut cursor).is_ok() {
                    let next = drag_bounds(drag, cursor, HIT.with(Cell::get).scale);
                    let _ = position(hwnd, next);
                }
            }
            LRESULT(0)
        }
        WM_LBUTTONUP => {
            if DRAG.with(|drag| drag.take()).is_some() {
                let _ = ReleaseCapture();
                event(WindowEvent::Bounds);
            } else {
                event(WindowEvent::Click);
            }
            LRESULT(0)
        }
        WM_CAPTURECHANGED => {
            if DRAG.with(|drag| drag.take()).is_some() {
                event(WindowEvent::Bounds);
            }
            LRESULT(0)
        }
        WM_CLOSE => {
            event(WindowEvent::Close);
            LRESULT(0)
        }
        WM_EXITSIZEMOVE => {
            event(WindowEvent::Bounds);
            LRESULT(0)
        }
        WM_DISPLAYCHANGE => {
            event(WindowEvent::DisplayChanged);
            LRESULT(0)
        }
        WM_DPICHANGED => {
            let rect = &*(lp.0 as *const RECT);
            let _ = SetWindowPos(
                hwnd,
                None,
                rect.left,
                rect.top,
                rect.right - rect.left,
                rect.bottom - rect.top,
                SWP_NOACTIVATE | SWP_NOZORDER,
            );
            event(WindowEvent::Bounds);
            LRESULT(0)
        }
        WM_GETMINMAXINFO => {
            let info = &mut *(lp.0 as *mut MINMAXINFO);
            let scale = HIT.with(Cell::get).scale;
            info.ptMinTrackSize = POINT {
                x: (520. * scale) as i32,
                y: (160. * scale) as i32,
            };
            info.ptMaxTrackSize = POINT {
                x: (1440. * scale) as i32,
                y: (1000. * scale) as i32,
            };
            LRESULT(0)
        }
        WM_ERASEBKGND => LRESULT(1),
        WM_DESTROY => {
            PostQuitMessage(0);
            LRESULT(0)
        }
        _ => DefWindowProcW(hwnd, message, wp, lp),
    }
}

fn drag_bounds(drag: Drag, cursor: POINT, scale: f32) -> Bounds {
    let dx = cursor.x - drag.origin.x;
    let dy = cursor.y - drag.origin.y;
    let mut b = drag.bounds;
    if drag.hit == HTCAPTION {
        b.x += dx;
        b.y += dy;
        return b;
    }
    let left = matches!(drag.hit, HTLEFT | HTTOPLEFT | HTBOTTOMLEFT);
    let right = matches!(drag.hit, HTRIGHT | HTTOPRIGHT | HTBOTTOMRIGHT);
    let top = matches!(drag.hit, HTTOP | HTTOPLEFT | HTTOPRIGHT);
    let bottom = matches!(drag.hit, HTBOTTOM | HTBOTTOMLEFT | HTBOTTOMRIGHT);
    if left || right {
        b.width = (b.width + if left { -dx } else { dx })
            .clamp((520. * scale) as i32, (1440. * scale) as i32);
        if left {
            b.x += drag.bounds.width - b.width;
        }
    }
    if top || bottom {
        b.height = (b.height + if top { -dy } else { dy })
            .clamp((160. * scale) as i32, (1000. * scale) as i32);
        if top {
            b.y += drag.bounds.height - b.height;
        }
    }
    b
}

struct Apartment;
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}
struct NativeWindow(HWND);
impl Drop for NativeWindow {
    fn drop(&mut self) {
        unsafe {
            let _ = KillTimer(Some(self.0), TIMER);
            let _ = DestroyWindow(self.0);
        }
    }
}

unsafe fn get_bounds(hwnd: HWND) -> WinResult<Bounds> {
    let mut rect = RECT::default();
    GetWindowRect(hwnd, &mut rect)?;
    Ok(Bounds {
        x: rect.left,
        y: rect.top,
        width: rect.right - rect.left,
        height: rect.bottom - rect.top,
    })
}

unsafe fn clamp_bounds(mut bounds: Bounds, center: bool, snap: bool, scale: f32) -> Bounds {
    let rect = RECT {
        left: bounds.x,
        top: bounds.y,
        right: bounds.x.saturating_add(bounds.width),
        bottom: bounds.y.saturating_add(bounds.height),
    };
    let monitor = MonitorFromRect(&rect, MONITOR_DEFAULTTONEAREST);
    let mut info = MONITORINFO {
        cbSize: size_of::<MONITORINFO>() as u32,
        ..Default::default()
    };
    if !GetMonitorInfoW(monitor, &mut info).as_bool() {
        return bounds;
    }
    let area = info.rcWork;
    let margin = (12. * scale) as i32;
    let max_width = (area.right - area.left - 2 * margin).max(1);
    let max_height = (area.bottom - area.top - 2 * margin).max(1);
    bounds.width = bounds.width.clamp(
        ((520. * scale) as i32).min(max_width),
        ((1440. * scale) as i32).min(max_width),
    );
    bounds.height = bounds
        .height
        .clamp(((160. * scale) as i32).min(max_height), max_height);
    let min_x = area.left + margin;
    let max_x = area.right - margin - bounds.width;
    let min_y = area.top + margin;
    let max_y = area.bottom - margin - bounds.height;
    bounds.x = bounds.x.clamp(min_x, max_x);
    bounds.y = bounds.y.clamp(min_y, max_y);
    if snap {
        let threshold = (24. * scale) as i32;
        if (bounds.x - min_x).abs() <= threshold {
            bounds.x = min_x;
        }
        if (bounds.x - max_x).abs() <= threshold {
            bounds.x = max_x;
        }
        if (bounds.y - min_y).abs() <= threshold {
            bounds.y = min_y;
        }
        if (bounds.y - max_y).abs() <= threshold {
            bounds.y = max_y;
        }
    }
    if center {
        bounds.x = area.left + (area.right - area.left - bounds.width) / 2;
    }
    bounds
}

unsafe fn position(hwnd: HWND, bounds: Bounds) -> WinResult<()> {
    SetWindowPos(
        hwnd,
        None,
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        SWP_NOACTIVATE | SWP_NOZORDER,
    )
}

unsafe fn run(
    app: tauri::AppHandle,
    mut state: Snapshot,
    bounds: Option<Bounds>,
    receiver: mpsc::Receiver<Command>,
    ready: &mpsc::SyncSender<Result<u32, String>>,
) -> WinResult<()> {
    CoInitializeEx(None, COINIT_APARTMENTTHREADED).ok()?;
    let _apartment = Apartment;
    let module = GetModuleHandleW(None)?;
    let class = w!("LyciaNativeDesktopLyrics");
    // Register once per process; reopening reuses the same class and releases all per-window resources.
    let wc = WNDCLASSW {
        lpfnWndProc: Some(wndproc),
        hInstance: module.into(),
        lpszClassName: class,
        hCursor: LoadCursorW(None, IDC_ARROW)?,
        ..Default::default()
    };
    RegisterClassW(&wc);
    let scale = GetDpiForSystem() as f32 / 96.;
    let defaults = Bounds {
        x: 100,
        y: 100,
        width: (900. * scale) as i32,
        height: (280. * scale) as i32,
    };
    let initial = clamp_bounds(
        bounds.unwrap_or(defaults),
        bounds.is_none() || state.settings.center_horizontally,
        false,
        scale,
    );
    let hwnd = CreateWindowExW(
        WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
        class,
        w!("Lycia Desktop Lyrics (Native)"),
        WS_POPUP | WS_THICKFRAME,
        initial.x,
        initial.y,
        initial.width,
        initial.height,
        None,
        None,
        Some(module.into()),
        None,
    )?;
    let _window = NativeWindow(hwnd);
    let scale = GetDpiForWindow(hwnd).max(96) as f32 / 96.;
    let custom_dir = app
        .path()
        .app_data_dir()
        .unwrap_or_default()
        .join("custom-lyrics-fonts");
    let mut renderer = Renderer::new(initial.width, initial.height, scale, custom_dir.clone())?;
    let mut clock = Clock::new(state.playback.clone());
    let mut page = None;
    let mut previous_active = usize::MAX;
    let mut layout_dirty = true;
    let mut dirty = true;
    let mut reveal_until = Instant::now() + Duration::from_millis(1200);
    let mut last_fullscreen_poll = Instant::now() - Duration::from_secs(1);
    let mut last_topmost = Instant::now() - Duration::from_secs(2);
    let mut fullscreen = false;
    let mut was_hidden = true;
    let mut previous_interaction = (false, false, None);
    let mut previous_flags = None;
    let mut recovery_count = 0;
    let mut last_cursor = POINT::default();
    let mut cursor_moved_at = Instant::now();
    let mut previous_opacity = 1.;
    let mut last_frame = Instant::now() - Duration::from_secs(1);
    // The first frame must succeed before open() reports success.
    let initial_active = active_index(&state.parsed_lyrics, clock.time());
    renderer.rebuild(&state, initial_active, initial_active)?;
    renderer.draw(
        hwnd,
        &state,
        clock.time(),
        false,
        false,
        None,
        clock.playing(),
        1.,
    )?;
    if SetTimer(Some(hwnd), TIMER, 33, None) == 0 {
        return Err(windows::core::Error::from_win32());
    }
    let _ = ready.send(Ok(GetCurrentThreadId()));
    let mut message = MSG::default();
    loop {
        let result = GetMessageW(&mut message, None, 0, 0);
        if result.0 == -1 {
            return Err(windows::core::Error::from_win32());
        }
        if result.0 == 0 {
            break;
        }
        let _ = TranslateMessage(&message);
        DispatchMessageW(&message);
        // The sender is bounded in frequency (400ms playback); coalesce state within this tick.
        for command in receiver.try_iter() {
            match command {
                Command::Close => return Ok(()),
                Command::Reveal => {
                    reveal_until = Instant::now() + Duration::from_millis(1200);
                    dirty = true;
                }
                Command::Playback(sample) => {
                    clock.sync(sample);
                    dirty = true;
                }
                Command::State(snapshot) => {
                    let song_changed = state.song.as_ref().map(|s| &s.path)
                        != snapshot.song.as_ref().map(|s| &s.path);
                    if song_changed {
                        page = None;
                    }
                    clock.sync(snapshot.playback.clone());
                    state = *snapshot;
                    layout_dirty = true;
                    dirty = true;
                }
            }
        }
        let events = EVENTS.with(|events| std::mem::take(&mut *events.borrow_mut()));
        let scale = GetDpiForWindow(hwnd).max(96) as f32 / 96.;
        let mut bounds = get_bounds(hwnd)?;
        let mut cursor = POINT::default();
        let _ = GetCursorPos(&mut cursor);
        if cursor.x != last_cursor.x || cursor.y != last_cursor.y {
            cursor_moved_at = Instant::now();
            last_cursor = cursor;
        }
        let x = (cursor.x - bounds.x) as f32 / scale;
        let y = (cursor.y - bounds.y) as f32 / scale;
        let width = bounds.width as f32 / scale;
        let over = x >= 0. && y >= 0. && x < width && y < bounds.height as f32 / scale;
        let hover = toolbar_hit(x, y, width, state.settings.is_locked);
        for event in events {
            match event {
                WindowEvent::Click => {
                    if let Some(index) = hover {
                        let action = match index {
                            0 => {
                                state.settings.is_locked = !state.settings.is_locked;
                                serde_json::json!({"type":"update-settings","patch":{"isLocked":state.settings.is_locked}})
                            }
                            1 => serde_json::json!({"type":"prev-song"}),
                            2 => serde_json::json!({"type":"toggle-play"}),
                            3 => serde_json::json!({"type":"next-song"}),
                            _ => serde_json::json!({"type":"close"}),
                        };
                        let _ = app.emit_to("main", "desktop-lyrics:action", action);
                        dirty = true;
                    }
                }
                WindowEvent::Close => {
                    let _ = app.emit_to(
                        "main",
                        "desktop-lyrics:action",
                        serde_json::json!({"type":"close"}),
                    );
                }
                WindowEvent::Bounds | WindowEvent::DisplayChanged => {
                    let fitted =
                        clamp_bounds(bounds, state.settings.center_horizontally, true, scale);
                    position(hwnd, fitted)?;
                    bounds = fitted;
                    let _ = app.emit_to("main", "desktop-lyrics:bounds", fitted);
                    reveal_until = Instant::now() + Duration::from_millis(1200);
                    dirty = true;
                }
            }
        }
        let flags = (
            state.settings.is_always_on_top,
            state.settings.center_horizontally,
        );
        let flags_changed = previous_flags != Some(flags);
        if flags_changed {
            if state.settings.center_horizontally {
                bounds = clamp_bounds(bounds, true, false, scale);
                position(hwnd, bounds)?;
                let _ = app.emit_to("main", "desktop-lyrics:bounds", bounds);
            }
            last_topmost = Instant::now() - Duration::from_secs(2);
            previous_flags = Some(flags);
        }
        if last_fullscreen_poll.elapsed() >= Duration::from_millis(300) {
            fullscreen = state.settings.auto_hide_when_fullscreen
                && crate::foreground_window::get_foreground_fullscreen_state().is_fullscreen;
            last_fullscreen_poll = Instant::now();
        }
        let revealed = Instant::now() < reveal_until || DRAG.with(Cell::get).is_some();
        let hidden =
            !revealed && (fullscreen || (state.settings.auto_hide_when_paused && !clock.playing()));
        if hidden != was_hidden {
            let _ = ShowWindow(hwnd, if hidden { SW_HIDE } else { SW_SHOWNOACTIVATE });
            was_hidden = hidden;
            dirty = true;
        }
        if flags_changed || (flags.0 && last_topmost.elapsed() >= Duration::from_millis(1500)) {
            SetWindowPos(
                hwnd,
                Some(if flags.0 {
                    HWND_TOPMOST
                } else {
                    HWND_NOTOPMOST
                }),
                0,
                0,
                0,
                0,
                SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE,
            )?;
            last_topmost = Instant::now();
        }
        let toolbar_state = toolbar_interaction(state.settings.is_locked, over, hover, revealed);
        let toolbar = toolbar_state.visible;
        let surface = state.settings.always_show_shadow_background
            || (!state.settings.is_locked && (over || revealed));
        let interaction = (toolbar, surface, hover);
        if previous_interaction != interaction {
            dirty = true;
            previous_interaction = interaction;
        }
        HIT.with(|hit| {
            hit.set(HitState {
                locked: state.settings.is_locked,
                scale,
                toolbar,
            })
        });
        let transparent = toolbar_state.click_through;
        let style = GetWindowLongPtrW(hwnd, GWL_EXSTYLE) as u32;
        let desired = if transparent {
            style | WS_EX_TRANSPARENT.0
        } else {
            style & !WS_EX_TRANSPARENT.0
        };
        if style != desired {
            SetWindowLongPtrW(hwnd, GWL_EXSTYLE, desired as isize);
        }
        let opacity = if !state.settings.is_locked
            && over
            && !revealed
            && cursor_moved_at.elapsed() >= Duration::from_millis(850)
        {
            0.34
        } else {
            1.
        };
        if opacity != previous_opacity {
            dirty = true;
            previous_opacity = opacity;
        }
        // No repaint while hidden. Paused windows only poll for hover/fullscreen at 10 Hz.
        SetTimer(
            Some(hwnd),
            TIMER,
            if hidden || !clock.playing() { 100 } else { 33 },
            None,
        );
        if hidden {
            continue;
        }
        // Mouse messages can arrive much faster than the timer; cap presentation at 30fps.
        if !dirty && !layout_dirty && last_frame.elapsed() < Duration::from_millis(33) {
            continue;
        }
        layout_dirty |= renderer.resize(bounds.width.max(1), bounds.height.max(1), scale)?;
        let time = clock.time();
        let active = active_index(&state.parsed_lyrics, time);
        let next_page = page_start(page, active, state.settings.show_double_line);
        if page != Some(next_page) || previous_active != active {
            layout_dirty = true;
        }
        page = Some(next_page);
        previous_active = active;
        let draw_result = (|| -> WinResult<()> {
            if layout_dirty {
                renderer.rebuild(&state, next_page, active)?;
                layout_dirty = false;
                dirty = true;
            }
            if dirty || clock.playing() {
                renderer.draw(
                    hwnd,
                    &state,
                    time,
                    toolbar,
                    surface,
                    hover,
                    clock.playing(),
                    opacity,
                )?;
                dirty = false;
                last_frame = Instant::now();
            }
            Ok(())
        })();
        if let Err(error) = draw_result {
            // Device/target failures must recreate both the target and its dependent brushes/bitmaps.
            recovery_count += 1;
            if recovery_count > 2 {
                return Err(error);
            }
            renderer = Renderer::new(bounds.width, bounds.height, scale, custom_dir.clone())?;
            layout_dirty = true;
            dirty = true;
        } else {
            recovery_count = 0;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn locked_lyrics_reveal_unlock_button_without_capturing_body_clicks() {
        // Cursor is over the lyric text, well below the invisible toolbar hotspot.
        let body_hit = toolbar_hit(450., 140., 900., true);
        assert_eq!(body_hit, None);
        assert_eq!(
            toolbar_interaction(true, true, body_hit, false),
            ToolbarInteraction {
                visible: true,
                click_through: true,
            }
        );
        // Travelling up to the button keeps it visible and enables only its hit area.
        let button_hit = toolbar_hit(450., 22., 900., true);
        assert_eq!(button_hit, Some(0));
        assert_eq!(
            toolbar_interaction(true, true, button_hit, false),
            ToolbarInteraction {
                visible: true,
                click_through: false,
            }
        );
        assert_eq!(
            toolbar_interaction(true, false, None, false),
            ToolbarInteraction {
                visible: false,
                click_through: true,
            }
        );
    }

    #[test]
    fn unlocked_toolbar_keeps_existing_reveal_behavior() {
        assert_eq!(
            toolbar_interaction(false, false, None, true),
            ToolbarInteraction {
                visible: true,
                click_through: false,
            }
        );
        assert_eq!(
            toolbar_interaction(false, false, None, false),
            ToolbarInteraction {
                visible: false,
                click_through: false,
            }
        );
        assert_eq!(
            toolbar_interaction(false, true, None, false),
            ToolbarInteraction {
                visible: true,
                click_through: false,
            }
        );
    }
    #[test]
    fn real_hwnd_hit_testing_preserves_lock_and_no_activation() {
        unsafe {
            let module = GetModuleHandleW(None).unwrap();
            let class = w!("LyciaNativeLyricsHitTest");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: module.into(),
                lpszClassName: class,
                ..Default::default()
            };
            assert_ne!(RegisterClassW(&wc), 0);
            let hwnd = CreateWindowExW(
                WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                class,
                w!("Hidden lyric hit-test"),
                WS_POPUP | WS_THICKFRAME,
                100,
                100,
                900,
                280,
                None,
                None,
                Some(module.into()),
                None,
            )
            .unwrap();
            let bounds = get_bounds(hwnd).unwrap();
            let hit = |x: i32, y: i32| {
                let packed =
                    ((bounds.x + x) as u16 as u32) | (((bounds.y + y) as u16 as u32) << 16);
                SendMessageW(hwnd, WM_NCHITTEST, None, Some(LPARAM(packed as isize))).0
            };
            HIT.with(|state| {
                state.set(HitState {
                    locked: false,
                    scale: 1.,
                    toolbar: true,
                })
            });
            assert_eq!(hit(450, 22), HTCLIENT as isize);
            assert_eq!(hit(200, 120), HTCAPTION as isize);
            assert_eq!(hit(1, 1), HTTOPLEFT as isize);
            HIT.with(|state| {
                state.set(HitState {
                    locked: true,
                    scale: 1.,
                    toolbar: toolbar_interaction(true, true, None, false).visible,
                })
            });
            assert_eq!(hit(450, 22), HTCLIENT as isize);
            assert_eq!(hit(200, 120), HTTRANSPARENT as isize);
            assert_eq!(
                SendMessageW(hwnd, WM_MOUSEACTIVATE, None, None).0,
                MA_NOACTIVATE as isize
            );
            DestroyWindow(hwnd).unwrap();
            UnregisterClassW(class, Some(module.into())).unwrap();
        }
    }
    #[test]
    fn toolbar_order_and_unlock_hit_area() {
        assert_eq!(toolbar_hit(450., 22., 900., false), Some(2));
        assert_eq!(toolbar_hit(374., 22., 900., false), Some(0));
        assert_eq!(toolbar_hit(526., 22., 900., false), Some(4));
        assert_eq!(toolbar_hit(450., 22., 900., true), Some(0));
        assert_eq!(toolbar_hit(400., 22., 900., true), None);
        assert_eq!(toolbar_hit(450., 60., 900., true), None);
    }
    #[test]
    fn resize_keeps_opposite_edge_and_enforces_minimum() {
        let drag = Drag {
            origin: POINT { x: 100, y: 100 },
            bounds: Bounds {
                x: 100,
                y: 100,
                width: 900,
                height: 280,
            },
            hit: HTTOPLEFT,
        };
        let b = drag_bounds(drag, POINT { x: 1000, y: 1000 }, 1.);
        assert_eq!(
            b,
            Bounds {
                x: 480,
                y: 220,
                width: 520,
                height: 160
            }
        );
    }
}
