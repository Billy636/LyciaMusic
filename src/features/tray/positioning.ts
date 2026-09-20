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

/** 菜单与屏幕工作区边缘的最小间距 */
const SCREEN_GAP = 6;
/** 菜单面板右缘相对托盘光标的水平偏移 */
const CURSOR_X_OFFSET = 12;
/** 菜单与托盘光标的垂直间距（上方展开时菜单底缘高于光标的距离） */
const CURSOR_Y_GAP = 6;

export async function resolveTrayMenuPosition(payload: TrayMenuOpenPayload): Promise<{
  position: LogicalPosition;
  submenuPlacement: TrayMenuSubmenuPlacement;
}> {
  const monitors = await availableMonitors();
  // 托盘点击可能落在任务栏（工作区之外），包含性判断必须使用显示器完整边界
  const selectedMonitor = monitors.find((monitor) => {
    return payload.x >= monitor.position.x
      && payload.x <= monitor.position.x + monitor.size.width
      && payload.y >= monitor.position.y
      && payload.y <= monitor.position.y + monitor.size.height;
  }) ?? monitors[0];

  if (!selectedMonitor) {
    return {
      position: new LogicalPosition(
        payload.x - TRAY_MENU_WINDOW_WIDTH + CURSOR_X_OFFSET,
        payload.y - TRAY_MENU_WINDOW_HEIGHT - CURSOR_Y_GAP,
      ),
      submenuPlacement: 'left',
    };
  }

  const scaleFactor = selectedMonitor.scaleFactor || 1;
  // 定位约束使用工作区（排除任务栏），菜单不会遮挡任务栏，与系统原生托盘菜单一致
  const workPosX = selectedMonitor.workArea.position.x / scaleFactor;
  const workPosY = selectedMonitor.workArea.position.y / scaleFactor;
  const workWidth = selectedMonitor.workArea.size.width / scaleFactor;
  const workHeight = selectedMonitor.workArea.size.height / scaleFactor;

  const clickX = payload.x / scaleFactor;
  const clickY = payload.y / scaleFactor;

  const minX = workPosX + SCREEN_GAP;
  const maxX = workPosX + workWidth - TRAY_MENU_WINDOW_WIDTH - SCREEN_GAP;
  const minY = workPosY + SCREEN_GAP;
  const maxY = workPosY + workHeight - TRAY_MENU_WINDOW_HEIGHT - SCREEN_GAP;

  const preferAboveY = clickY - TRAY_MENU_WINDOW_HEIGHT - CURSOR_Y_GAP;
  const fallbackBelowY = clickY + SCREEN_GAP;
  const targetY = preferAboveY >= minY ? preferAboveY : fallbackBelowY;
  const clampedY = Math.max(minY, Math.min(maxY, targetY));

  const workAreaRight = workPosX + workWidth - SCREEN_GAP;
  const submenuSpan = TRAY_MENU_SUBMENU_WIDTH + TRAY_MENU_SUBMENU_GAP;
  const mainPanelRightX = clickX + CURSOR_X_OFFSET;
  const leftSubmenuWindowX = mainPanelRightX - TRAY_MENU_PANEL_WIDTH - submenuSpan;
  const rightSubmenuWindowX = mainPanelRightX - TRAY_MENU_PANEL_WIDTH;
  const hasLeftSubmenuSpace = leftSubmenuWindowX >= minX;
  const hasRightSubmenuSpace = rightSubmenuWindowX + TRAY_MENU_WINDOW_WIDTH <= workAreaRight;
  const submenuPlacement: TrayMenuSubmenuPlacement = hasRightSubmenuSpace || !hasLeftSubmenuSpace ? 'right' : 'left';
  const preferredX = submenuPlacement === 'left' ? leftSubmenuWindowX : rightSubmenuWindowX;

  return {
    position: new LogicalPosition(
      Math.round(Math.max(minX, Math.min(maxX, preferredX))),
      Math.round(clampedY),
    ),
    submenuPlacement,
  };
}
