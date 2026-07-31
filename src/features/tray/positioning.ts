import { LogicalPosition } from '@tauri-apps/api/dpi';
import { availableMonitors } from '@tauri-apps/api/window';

import {
  TRAY_MENU_PANEL_WIDTH,
  TRAY_MENU_SUBMENU_GAP,
  TRAY_MENU_SUBMENU_WIDTH,
  TRAY_MENU_WINDOW_HEIGHT,
  TRAY_MENU_WINDOW_WIDTH,
  type TrayMenuOpenPayload,
  type TrayMenuSubmenuPlacement,
} from './actions';

export async function resolveTrayMenuPosition(payload: TrayMenuOpenPayload): Promise<{
  position: LogicalPosition;
  submenuPlacement: TrayMenuSubmenuPlacement;
}> {
  const monitors = await availableMonitors();
  const selectedMonitor = monitors.find((monitor) => {
    return payload.x >= monitor.position.x
      && payload.x <= monitor.position.x + monitor.size.width
      && payload.y >= monitor.position.y
      && payload.y <= monitor.position.y + monitor.size.height;
  }) ?? monitors[0];

  if (!selectedMonitor) {
    return {
      position: new LogicalPosition(
        payload.x - TRAY_MENU_WINDOW_WIDTH + 12,
        payload.y - TRAY_MENU_WINDOW_HEIGHT - 10,
      ),
      submenuPlacement: 'left',
    };
  }

  const scaleFactor = selectedMonitor.scaleFactor || 1;
  const workAreaPosition = selectedMonitor.workArea.position.toLogical(scaleFactor);
  const workAreaSize = selectedMonitor.workArea.size.toLogical(scaleFactor);
  const clickX = payload.x / scaleFactor;
  const clickY = payload.y / scaleFactor;

  const margin = 8;
  const maxX = workAreaPosition.x + workAreaSize.width - TRAY_MENU_WINDOW_WIDTH - margin;
  const minX = workAreaPosition.x + margin;
  const maxY = workAreaPosition.y + workAreaSize.height - TRAY_MENU_WINDOW_HEIGHT - margin;
  const minY = workAreaPosition.y + margin;
  const preferAboveY = clickY - TRAY_MENU_WINDOW_HEIGHT - margin;
  const fallbackBelowY = clickY + margin;
  const workAreaRight = workAreaPosition.x + workAreaSize.width - margin;
  const submenuSpan = TRAY_MENU_SUBMENU_WIDTH + TRAY_MENU_SUBMENU_GAP;
  const mainPanelRightX = clickX + 12;
  const leftSubmenuWindowX = mainPanelRightX - TRAY_MENU_PANEL_WIDTH - submenuSpan;
  const rightSubmenuWindowX = mainPanelRightX - TRAY_MENU_PANEL_WIDTH;
  const hasLeftSubmenuSpace = leftSubmenuWindowX >= minX;
  const hasRightSubmenuSpace = rightSubmenuWindowX + TRAY_MENU_WINDOW_WIDTH <= workAreaRight;
  const submenuPlacement: TrayMenuSubmenuPlacement = hasRightSubmenuSpace || !hasLeftSubmenuSpace ? 'right' : 'left';
  const preferredX = submenuPlacement === 'left' ? leftSubmenuWindowX : rightSubmenuWindowX;

  return {
    position: new LogicalPosition(
      Math.round(Math.max(minX, Math.min(maxX, preferredX))),
      Math.round(Math.max(minY, Math.min(maxY, preferAboveY >= minY ? preferAboveY : fallbackBelowY))),
    ),
    submenuPlacement,
  };
}
