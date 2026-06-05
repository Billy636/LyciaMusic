const SETTINGS_KEY = 'player_settings';
const DARK_STARTUP_COLOR = '#121212';
const LIGHT_STARTUP_COLOR = '#fafafa';
const STARTUP_PAINT_ATTRIBUTE = 'data-lycia-startup-paint';
const MAIN_WINDOW_LABEL = 'main';

type PersistedSettings = {
  theme?: {
    mode?: unknown;
    customBackground?: {
      foregroundStyle?: unknown;
    };
  };
};

const readPersistedSettings = (): PersistedSettings | null => {
  if (typeof localStorage === 'undefined') {
    return null;
  }

  const raw = localStorage.getItem(SETTINGS_KEY);
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as PersistedSettings
      : null;
  } catch {
    return null;
  }
};

const isPersistedDarkTheme = (settings: PersistedSettings | null) => {
  const theme = settings?.theme;
  if (!theme || typeof theme !== 'object') {
    return false;
  }

  if (theme.mode === 'dark') {
    return true;
  }

  return theme.mode === 'custom' && theme.customBackground?.foregroundStyle === 'light';
};

export function shouldApplyStartupThemePaint(windowLabel: string | null | undefined) {
  return !windowLabel || windowLabel === MAIN_WINDOW_LABEL;
}

export function applyPersistedStartupTheme() {
  if (typeof document === 'undefined') {
    return;
  }

  const isDark = isPersistedDarkTheme(readPersistedSettings());
  const startupColor = isDark ? DARK_STARTUP_COLOR : LIGHT_STARTUP_COLOR;

  document.documentElement.classList.toggle('dark', isDark);
  document.documentElement.style.backgroundColor = startupColor;

  if (document.body) {
    document.body.style.backgroundColor = startupColor;
  }

  document.documentElement.setAttribute(STARTUP_PAINT_ATTRIBUTE, 'true');
}

export function clearStartupThemePaint() {
  if (typeof document === 'undefined') {
    return;
  }

  if (!document.documentElement.hasAttribute(STARTUP_PAINT_ATTRIBUTE)) {
    return;
  }

  document.documentElement.style.backgroundColor = '';
  if (document.body) {
    document.body.style.backgroundColor = '';
  }
  document.documentElement.removeAttribute(STARTUP_PAINT_ATTRIBUTE);
}
