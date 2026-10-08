use super::model::Bounds;
use windows_sys::Win32::{
    Foundation::{LPARAM, RECT},
    Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR},
};

#[derive(Clone, Copy, PartialEq, Eq, PartialOrd, Ord)]
struct MonitorArea {
    left: i32,
    top: i32,
    right: i32,
    bottom: i32,
}

impl MonitorArea {
    fn intersects(self, bounds: Bounds) -> bool {
        bounds.x < self.right
            && bounds.x.saturating_add(bounds.width) > self.left
            && bounds.y < self.bottom
            && bounds.y.saturating_add(bounds.height) > self.top
    }

    fn distance(self, bounds: Bounds) -> i128 {
        let dx = (i64::from(self.left) - i64::from(bounds.x) - i64::from(bounds.width))
            .max(i64::from(bounds.x) - i64::from(self.right))
            .max(0);
        let dy = (i64::from(self.top) - i64::from(bounds.y) - i64::from(bounds.height))
            .max(i64::from(bounds.y) - i64::from(self.bottom))
            .max(0);
        i128::from(dx).pow(2) + i128::from(dy).pow(2)
    }

    fn bring_inside(self, mut bounds: Bounds) -> Bounds {
        bounds.x = bounds.x.clamp(
            self.left,
            self.right.saturating_sub(bounds.width).max(self.left),
        );
        bounds.y = bounds.y.clamp(
            self.top,
            self.bottom.saturating_sub(bounds.height).max(self.top),
        );
        bounds
    }
}

unsafe extern "system" fn collect_monitor(
    _monitor: HMONITOR,
    _dc: HDC,
    rect: *mut RECT,
    data: LPARAM,
) -> i32 {
    let rect = &*rect;
    if rect.left < rect.right && rect.top < rect.bottom {
        let monitors = &mut *(data as *mut Vec<MonitorArea>);
        monitors.push(MonitorArea {
            left: rect.left,
            top: rect.top,
            right: rect.right,
            bottom: rect.bottom,
        });
    }
    1
}

unsafe fn monitor_layout() -> Option<Vec<MonitorArea>> {
    let mut monitors = Vec::new();
    if EnumDisplayMonitors(
        std::ptr::null_mut(),
        std::ptr::null(),
        Some(collect_monitor),
        &mut monitors as *mut Vec<MonitorArea> as LPARAM,
    ) == 0
        || monitors.is_empty()
    {
        return None;
    }
    monitors.sort_unstable();
    monitors.dedup();
    Some(monitors)
}

/// A display-mode change may strand bottom-positioned lyrics outside the desktop.
/// Keep that recovery temporary so leaving the game restores the user's position.
pub(super) struct DisplayPosition {
    layout: Vec<MonitorArea>,
    previous_bounds: Bounds,
    restore_bounds: Option<Bounds>,
    pending_bounds: Option<Bounds>,
    restoring_original: bool,
    layout_refresh_pending: bool,
}

impl DisplayPosition {
    pub(super) unsafe fn new(bounds: Bounds) -> Self {
        Self {
            layout: monitor_layout().unwrap_or_default(),
            previous_bounds: bounds,
            restore_bounds: None,
            pending_bounds: None,
            restoring_original: false,
            layout_refresh_pending: false,
        }
    }

    pub(super) fn is_temporary(&self) -> bool {
        self.restore_bounds.is_some()
    }

    pub(super) fn observe(&mut self, bounds: Bounds) {
        self.previous_bounds = bounds;
    }

    pub(super) fn request_refresh(&mut self) {
        self.layout_refresh_pending = true;
    }

    pub(super) fn needs_refresh(&self) -> bool {
        self.layout_refresh_pending || self.pending_bounds.is_some()
    }

    pub(super) fn position_applied(&mut self, bounds: Bounds) {
        self.pending_bounds = None;
        if self.restoring_original {
            self.restore_bounds = None;
            self.restoring_original = false;
        }
        self.previous_bounds = bounds;
    }

    pub(super) unsafe fn user_changed(&mut self, bounds: Bounds) {
        self.restore_bounds = None;
        self.pending_bounds = None;
        self.restoring_original = false;
        self.layout_refresh_pending = false;
        self.previous_bounds = bounds;
        // An explicit drag/center owns the new position, even if a display
        // notification was queued at the same time.
        self.layout = monitor_layout().unwrap_or_default();
    }

    // Called for display/DPI notifications, never to normalize a saved position
    // or move a freely dragged window on every frame.
    pub(super) unsafe fn pending_position(&mut self, bounds: Bounds) -> Option<Bounds> {
        if self.layout_refresh_pending {
            // Keep the request pending if enumeration fails during a mode switch.
            let next_layout = monitor_layout()?;
            self.layout_refresh_pending = false;
            if next_layout != self.layout {
                self.update_layout(next_layout, bounds);
            }
        }
        self.pending_bounds
    }

    fn update_layout(&mut self, next_layout: Vec<MonitorArea>, bounds: Bounds) {
        let previously_visible = self
            .layout
            .iter()
            .any(|monitor| monitor.intersects(self.previous_bounds));
        self.layout = next_layout;

        if let Some(original) = self.restore_bounds {
            if self
                .layout
                .iter()
                .any(|monitor| monitor.intersects(original))
            {
                self.pending_bounds = Some(original);
                self.restoring_original = true;
                return;
            }
        }

        self.restoring_original = false;
        self.pending_bounds = None;
        if self.layout.iter().any(|monitor| monitor.intersects(bounds)) {
            return;
        }
        if !self.is_temporary() {
            if !previously_visible {
                return;
            }
            self.restore_bounds = Some(self.previous_bounds);
        }

        self.pending_bounds = self
            .layout
            .iter()
            .min_by_key(|monitor| monitor.distance(bounds))
            .map(|monitor| monitor.bring_inside(bounds));
    }
}
