import { describe, expect, it } from 'vitest';

import sidebarSource from './Sidebar.vue?raw';
import settingsSidebarSource from '../settings/SettingsSidebar.vue?raw';

describe('sidebar playlist visibility', () => {
  it('guards the complete playlist section with the sidebar setting', () => {
    expect(sidebarSource).toContain('v-if="settings.sidebar.showPlaylists"');
  });

  it('exposes a playlist visibility toggle in sidebar settings', () => {
    expect(settingsSidebarSource).toContain('settings.sidebar.showPlaylists = !settings.sidebar.showPlaylists');
    expect(settingsSidebarSource).toContain('>我的歌单</div>');
  });
});
