import { beforeEach, describe, expect, it } from 'vitest';

import { applyPersistedStartupTheme, shouldApplyStartupThemePaint } from './startupTheme';

const SETTINGS_KEY = 'player_settings';

const createClassList = () => {
  const classes = new Set<string>();
  return {
    toggle: (name: string, enabled: boolean) => {
      if (enabled) {
        classes.add(name);
      } else {
        classes.delete(name);
      }
    },
    contains: (name: string) => classes.has(name),
  };
};

const installDomStubs = () => {
  const store = new Map<string, string>();
  const documentElement = {
    classList: createClassList(),
    style: { backgroundColor: '' },
    attributes: new Set<string>(),
    setAttribute(name: string) {
      this.attributes.add(name);
    },
    removeAttribute(name: string) {
      this.attributes.delete(name);
    },
    hasAttribute(name: string) {
      return this.attributes.has(name);
    },
  };

  Object.defineProperty(globalThis, 'document', {
    value: {
      documentElement,
      body: {
        style: { backgroundColor: '' },
      },
    },
    configurable: true,
  });

  Object.defineProperty(globalThis, 'localStorage', {
    value: {
      clear: () => store.clear(),
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => store.set(key, value),
    },
    configurable: true,
  });
};

describe('startup theme bootstrap', () => {
  beforeEach(() => {
    installDomStubs();
    localStorage.clear();
  });

  it('applies dark class and dark root paint before Vue mounts when persisted theme is dark', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      theme: {
        mode: 'dark',
        windowMaterial: 'acrylic',
      },
    }));

    applyPersistedStartupTheme();

    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.style.backgroundColor).toBe('#121212');
    expect(document.body.style.backgroundColor).toBe('#121212');
  });

  it('keeps light startup paint for persisted light theme', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      theme: {
        mode: 'light',
        windowMaterial: 'acrylic',
      },
    }));

    applyPersistedStartupTheme();

    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(document.documentElement.style.backgroundColor).toBe('#fafafa');
    expect(document.body.style.backgroundColor).toBe('#fafafa');
  });

  it('does not apply startup paint to transparent auxiliary windows', () => {
    expect(shouldApplyStartupThemePaint('main')).toBe(true);
    expect(shouldApplyStartupThemePaint('desktop-lyrics')).toBe(false);
    expect(shouldApplyStartupThemePaint('mini-player')).toBe(false);
    expect(shouldApplyStartupThemePaint('tray-menu')).toBe(false);
  });
});
