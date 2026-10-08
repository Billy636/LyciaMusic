use super::{model::*, render::Renderer, topmost::TopmostGuard};
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
        Foundation::{
            CloseHandle, HANDLE, HWND, LPARAM, LRESULT, POINT, RECT, WAIT_FAILED, WPARAM,
        },
        Graphics::Gdi::{GetMonitorInfoW, MonitorFromRect, MONITORINFO, MONITOR_DEFAULTTONEAREST},
        System::{
            Com::{CoInitializeEx, CoUninitialize, COINIT_APARTMENTTHREADED},
            LibraryLoader::GetModuleHandleW,
            Threading::{
                CancelWaitableTimer, CreateWaitableTimerExW, GetCurrentThreadId, SetWaitableTimer,
                CREATE_WAITABLE_TIMER_HIGH_RESOLUTION, INFINITE, TIMER_ALL_ACCESS,
            },
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
const PLAYBACK_FRAME: Duration = Duration::from_nanos(1_000_000_000 / 60);
const TRANSITION_FRAME: Duration = Duration::from_nanos(1_000_000_000 / 120);
const IDLE_POLL: Duration = Duration::from_millis(100);

/// A one-shot frame deadline shares the message wait without changing the
/// system-wide timer resolution or repeatedly resetting a WM_TIMER interval.
struct FrameWake(HANDLE);
impl FrameWake {
    unsafe fn new() -> WinResult<Self> {
        CreateWaitableTimerExW(
            None,
            None,
            CREATE_WAITABLE_TIMER_HIGH_RESOLUTION,
            TIMER_ALL_ACCESS.0,
        )
        .or_else(|_| CreateWaitableTimerExW(None, None, 0, TIMER_ALL_ACCESS.0))
        .map(Self)
    }

    unsafe fn wait(&self, delay: Duration) -> WinResult<()> {
        let due = -(delay.as_nanos().div_ceil(100).max(1).min(i64::MAX as u128) as i64);
        SetWaitableTimer(self.0, &due, 0, None, None, false)?;
        if MsgWaitForMultipleObjectsEx(Some(&[self.0]), INFINITE, QS_ALLINPUT, MWMO_INPUTAVAILABLE)
            == WAIT_FAILED
        {
            return Err(windows::core::Error::from_win32());
        }
        Ok(())
    }
}
impl Drop for FrameWake {
    fn drop(&mut self) {
        unsafe {
            let _ = CancelWaitableTimer(self.0);
            let _ = CloseHandle(self.0);
        }
    }
}

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
                0,
                0,
                rect.right - rect.left,
                rect.bottom - rect.top,
                // Accept the new DPI size without letting the suggested monitor
                // rectangle move an intentionally off-screen window back inside.
                SWP_NOMOVE | SWP_NOACTIVATE | SWP_NOZORDER,
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

fn constrain_bounds_size(mut bounds: Bounds, scale: f32) -> Bounds {
    // Rendering needs bounded, non-zero dimensions, but desktop lyrics are not
    // confined to a monitor or its work area. Never normalize the user's x/y.
    bounds.width = bounds
        .width
        .clamp((520. * scale) as i32, (1440. * scale) as i32);
    bounds.height = bounds
        .height
        .clamp((160. * scale) as i32, (1000. * scale) as i32);
    bounds
}

unsafe fn center_bounds_horizontally(mut bounds: Bounds) -> Bounds {
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
    bounds.x = area.left + (area.right - area.left - bounds.width) / 2;
    bounds
}

fn horizontal_center_requested(previous: Option<(bool, bool)>, center: bool) -> bool {
    // Initial settings, topmost changes, dragging and display changes are not
    // explicit requests to discard a saved/manually chosen horizontal position.
    previous.is_some_and(|(_, was_centered)| !was_centered && center)
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

unsafe fn finish_bounds_change(hwnd: HWND, bounds: Bounds, scale: f32) -> WinResult<Bounds> {
    let fitted = constrain_bounds_size(bounds, scale);
    if fitted != bounds {
        position(hwnd, fitted)?;
    }
    Ok(fitted)
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
    let initial = constrain_bounds_size(bounds.unwrap_or(defaults), scale);
    let initial = if bounds.is_none() {
        center_bounds_horizontally(initial)
    } else {
        initial
    };
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
    let mut last_state_sequence = state.playback.sample_sequence;
    let mut layout_dirty = true;
    let mut dirty = true;
    let mut reveal_until = Instant::now() + Duration::from_millis(1200);
    let mut last_fullscreen_poll = Instant::now() - Duration::from_secs(1);
    let mut topmost_guard = TopmostGuard::new();
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
    let mut previous_active = initial_active;
    renderer.rebuild(&state, initial_active)?;
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
    let frame_wake = FrameWake::new()?;
    let mut last_poll = Instant::now() - IDLE_POLL;
    let _ = ready.send(Ok(GetCurrentThreadId()));
    let mut message = MSG::default();
    loop {
        let frame_interval = if renderer.has_transition() {
            TRANSITION_FRAME
        } else {
            PLAYBACK_FRAME
        };
        let needs_frame =
            !was_hidden && (dirty || layout_dirty || clock.playing() || renderer.has_transition());
        let wait = if needs_frame {
            frame_interval.saturating_sub(last_frame.elapsed())
        } else {
            IDLE_POLL.saturating_sub(last_poll.elapsed())
        };
        frame_wake.wait(wait)?;
        last_poll = Instant::now();
        // Bound message draining so cursor traffic cannot starve frame deadlines.
        for _ in 0..64 {
            if !PeekMessageW(&mut message, None, 0, 0, PM_REMOVE).as_bool() {
                break;
            }
            if message.message == WM_QUIT {
                return Ok(());
            }
            let _ = TranslateMessage(&message);
            DispatchMessageW(&message);
        }
        // The sender is bounded in frequency (400ms playback); coalesce state within this tick.
        for command in receiver.try_iter() {
            match command {
                Command::Close => return Ok(()),
                Command::Reveal => {
                    reveal_until = Instant::now() + Duration::from_millis(1200);
                    dirty = true;
                }
                Command::Playback(sample) => {
                    let sync = clock.sync(sample.clone());
                    if sync == ClockSync::Ignored {
                        continue;
                    }
                    state.playback = sample;
                    if sync == ClockSync::Discontinuity {
                        renderer.cancel_transition();
                        layout_dirty = true;
                    }
                    dirty = true;
                }
                Command::State(mut snapshot) => {
                    let incoming_sequence = snapshot.playback.sample_sequence;
                    if matches!((last_state_sequence, incoming_sequence), (Some(previous), Some(next)) if next <= previous)
                    {
                        continue;
                    }
                    let sync = clock.sync(snapshot.playback.clone());
                    if sync == ClockSync::Ignored {
                        // A settings snapshot may arrive behind a newer clock-only
                        // packet. Preserve its newer visual content, but never let
                        // its old clock or a previous playback session take over.
                        if snapshot.playback.song_path != state.playback.song_path
                            || snapshot.playback.playback_id != state.playback.playback_id
                        {
                            continue;
                        }
                        snapshot.playback = state.playback.clone();
                    }
                    last_state_sequence = incoming_sequence;
                    // Pause/resume also sends full snapshots. Preserve the in-flight
                    // row handoff when only the playback clock has changed.
                    let content_changed = state.song != snapshot.song
                        || state.parsed_lyrics != snapshot.parsed_lyrics
                        || state.settings != snapshot.settings
                        || state.custom_lyrics_fonts != snapshot.custom_lyrics_fonts
                        || state.theme_colors != snapshot.theme_colors
                        || state.lyrics_status != snapshot.lyrics_status
                        || (state.parsed_lyrics.is_empty()
                            && state.fallback_text != snapshot.fallback_text);
                    state = *snapshot;
                    if content_changed || sync == ClockSync::Discontinuity {
                        renderer.cancel_transition();
                        layout_dirty = true;
                    }
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
                    let fitted = finish_bounds_change(hwnd, bounds, scale)?;
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
            if horizontal_center_requested(previous_flags, state.settings.center_horizontally) {
                bounds = center_bounds_horizontally(bounds);
                position(hwnd, bounds)?;
                let _ = app.emit_to("main", "desktop-lyrics:bounds", bounds);
            }
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
            // Hidden frames cannot take part in a visible row handoff.
            renderer.cancel_transition();
            layout_dirty = true;
            let _ = ShowWindow(hwnd, if hidden { SW_HIDE } else { SW_SHOWNOACTIVATE });
            was_hidden = hidden;
            dirty = true;
        }
        topmost_guard.update(hwnd, flags.0, !hidden)?;
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
        if hidden {
            continue;
        }
        // Pause/seek/input updates use the same frame budget; dirty messages do not
        // create unbounded extra frames between timer deadlines.
        if last_frame.elapsed() < frame_interval {
            continue;
        }
        layout_dirty |= renderer.resize(bounds.width.max(1), bounds.height.max(1), scale)?;
        let time = clock.time();
        let active = active_index(&state.parsed_lyrics, time);
        let active_changed = previous_active != active;
        let draw_result = (|| -> WinResult<()> {
            if layout_dirty {
                renderer.rebuild(&state, active)?;
                layout_dirty = false;
                dirty = true;
            } else if active_changed {
                if clock.playing() {
                    renderer.transition_to(&state, active)?;
                } else {
                    renderer.rebuild(&state, active)?;
                }
                dirty = true;
            }
            previous_active = active;
            if dirty || clock.playing() || renderer.has_transition() {
                let frame_started = Instant::now();
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
                last_frame = frame_started;
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
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn free_positions_are_preserved_when_normalizing_saved_or_finished_bounds() {
        for (x, y) in [
            (400, 1000), // Overlaps the taskbar on a typical 1080p screen.
            (-240, -100),
            (5000, 3000), // Completely outside the desktop.
            (8, 8),       // Close to an edge must not snap.
            (i32::MIN, i32::MAX),
        ] {
            let bounds = Bounds {
                x,
                y,
                width: 900,
                height: 280,
            };
            assert_eq!(constrain_bounds_size(bounds, 1.), bounds);
        }
    }

    #[test]
    fn size_limits_do_not_reposition_offscreen_lyrics() {
        assert_eq!(
            constrain_bounds_size(
                Bounds {
                    x: -600,
                    y: 4000,
                    width: 1,
                    height: 10000
                },
                1.
            ),
            Bounds {
                x: -600,
                y: 4000,
                width: 520,
                height: 1000
            },
        );
        assert_eq!(
            constrain_bounds_size(
                Bounds {
                    x: 4000,
                    y: -600,
                    width: 4000,
                    height: 1
                },
                2.
            ),
            Bounds {
                x: 4000,
                y: -600,
                width: 2880,
                height: 320
            },
        );
    }

    #[test]
    fn dragging_can_cross_all_screen_edges_without_a_position_limit() {
        let drag = Drag {
            origin: POINT { x: 200, y: 200 },
            bounds: Bounds {
                x: 100,
                y: 100,
                width: 900,
                height: 280,
            },
            hit: HTCAPTION,
        };
        for cursor in [POINT { x: -1000, y: -500 }, POINT { x: 5000, y: 3000 }] {
            let bounds = drag_bounds(drag, cursor, 1.);
            assert_eq!(bounds.x, cursor.x - 100);
            assert_eq!(bounds.y, cursor.y - 100);
            assert_eq!(constrain_bounds_size(bounds, 1.), bounds);
        }
    }

    #[test]
    fn only_explicitly_enabling_horizontal_center_requests_repositioning() {
        assert!(!horizontal_center_requested(None, true));
        assert!(!horizontal_center_requested(None, false));
        assert!(!horizontal_center_requested(Some((false, true)), true));
        assert!(!horizontal_center_requested(Some((true, true)), true));
        assert!(!horizontal_center_requested(Some((true, true)), false));
        assert!(horizontal_center_requested(Some((false, false)), true));
    }

    #[test]
    fn real_hwnd_keeps_taskbar_and_offscreen_positions_after_bounds_and_dpi_events() {
        unsafe {
            let module = GetModuleHandleW(None).unwrap();
            let class = w!("LyciaNativeLyricsFreePositionTest");
            let wc = WNDCLASSW {
                lpfnWndProc: Some(wndproc),
                hInstance: module.into(),
                lpszClassName: class,
                ..Default::default()
            };
            assert_ne!(RegisterClassW(&wc), 0);
            HIT.with(|state| state.set(HitState::default()));
            let window = NativeWindow(
                CreateWindowExW(
                    WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_NOACTIVATE,
                    class,
                    w!("Hidden lyric free-position test"),
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
                .unwrap(),
            );
            let hwnd = window.0;
            let anchor = RECT {
                left: 100,
                top: 100,
                right: 1000,
                bottom: 380,
            };
            let monitor = MonitorFromRect(&anchor, MONITOR_DEFAULTTONEAREST);
            let mut info = MONITORINFO {
                cbSize: size_of::<MONITORINFO>() as u32,
                ..Default::default()
            };
            assert!(GetMonitorInfoW(monitor, &mut info).as_bool());
            for (x, y) in [
                (info.rcWork.left + 20, info.rcWork.bottom - 40),
                (info.rcMonitor.left - 400, info.rcMonitor.top - 180),
                (info.rcMonitor.right + 100, info.rcMonitor.bottom + 100),
            ] {
                let requested = Bounds {
                    x,
                    y,
                    width: 900,
                    height: 280,
                };
                position(hwnd, requested).unwrap();
                for message in [WM_EXITSIZEMOVE, WM_DISPLAYCHANGE] {
                    SendMessageW(hwnd, message, None, None);
                    finish_bounds_change(hwnd, get_bounds(hwnd).unwrap(), 1.).unwrap();
                    assert_eq!(get_bounds(hwnd).unwrap(), requested);
                }
            }
            let before_dpi = get_bounds(hwnd).unwrap();
            let suggested = RECT {
                left: info.rcWork.left,
                top: info.rcWork.top,
                right: info.rcWork.left + 1000,
                bottom: info.rcWork.top + 360,
            };
            SendMessageW(
                hwnd,
                WM_DPICHANGED,
                Some(WPARAM(144 | (144 << 16))),
                Some(LPARAM((&suggested as *const RECT) as isize)),
            );
            let after_dpi = finish_bounds_change(hwnd, get_bounds(hwnd).unwrap(), 1.).unwrap();
            assert_eq!((after_dpi.x, after_dpi.y), (before_dpi.x, before_dpi.y));
            assert_eq!((after_dpi.width, after_dpi.height), (1000, 360));
            let centered = center_bounds_horizontally(after_dpi);
            assert_eq!(centered.y, after_dpi.y);
            assert_eq!(
                (centered.width, centered.height),
                (after_dpi.width, after_dpi.height)
            );
            EVENTS.with(|events| events.borrow_mut().clear());
            drop(window);
            UnregisterClassW(class, Some(module.into())).unwrap();
        }
    }

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
