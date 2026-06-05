import type {
  ShortcutActionId,
  ShortcutBinding,
  ShortcutBindingMap,
  ShortcutSettings,
} from '../../types';

export const shortcutActionOrder: ShortcutActionId[] = [
  'togglePlay',
  'prevSong',
  'nextSong',
  'volumeUp',
  'volumeDown',
  'toggleMiniMode',
  'toggleFavorite',
  'toggleDesktopLyrics',
  'toggleDesktopLyricsLock',
];

export const shortcutActionLabels: Record<ShortcutActionId, string> = {
  togglePlay: '播放/暂停',
  prevSong: '上一首',
  nextSong: '下一首',
  volumeUp: '音量加',
  volumeDown: '音量减',
  toggleMiniMode: 'mini/完整模式',
  toggleFavorite: '喜欢歌曲',
  toggleDesktopLyrics: '打开/关闭歌词',
  toggleDesktopLyricsLock: '锁定/解锁桌面歌词',
};

const createShortcutBinding = (
  code: string,
  modifiers: Partial<Omit<ShortcutBinding, 'code'>> = {},
): ShortcutBinding => ({
  code,
  ctrl: !!modifiers.ctrl,
  alt: !!modifiers.alt,
  shift: !!modifiers.shift,
  meta: !!modifiers.meta,
});

const cloneShortcutBinding = (binding: ShortcutBinding | null): ShortcutBinding | null => (
  binding ? { ...binding } : null
);

const createShortcutBindingMap = (bindings: ShortcutBindingMap): ShortcutBindingMap => ({
  togglePlay: cloneShortcutBinding(bindings.togglePlay),
  prevSong: cloneShortcutBinding(bindings.prevSong),
  nextSong: cloneShortcutBinding(bindings.nextSong),
  volumeUp: cloneShortcutBinding(bindings.volumeUp),
  volumeDown: cloneShortcutBinding(bindings.volumeDown),
  toggleMiniMode: cloneShortcutBinding(bindings.toggleMiniMode),
  toggleFavorite: cloneShortcutBinding(bindings.toggleFavorite),
  toggleDesktopLyrics: cloneShortcutBinding(bindings.toggleDesktopLyrics),
  toggleDesktopLyricsLock: cloneShortcutBinding(bindings.toggleDesktopLyricsLock),
});

export const defaultLocalShortcutBindings: ShortcutBindingMap = {
  togglePlay: createShortcutBinding('Space'),
  prevSong: createShortcutBinding('ArrowLeft', { ctrl: true }),
  nextSong: createShortcutBinding('ArrowRight', { ctrl: true }),
  volumeUp: createShortcutBinding('ArrowUp', { ctrl: true }),
  volumeDown: createShortcutBinding('ArrowDown', { ctrl: true }),
  toggleMiniMode: createShortcutBinding('KeyM', { ctrl: true }),
  toggleFavorite: createShortcutBinding('KeyL', { ctrl: true }),
  toggleDesktopLyrics: createShortcutBinding('KeyD', { ctrl: true }),
  toggleDesktopLyricsLock: createShortcutBinding('KeyD', { ctrl: true, shift: true }),
};

export const defaultGlobalShortcutBindings: ShortcutBindingMap = {
  togglePlay: createShortcutBinding('KeyP', { ctrl: true, alt: true }),
  prevSong: createShortcutBinding('ArrowLeft', { ctrl: true, alt: true }),
  nextSong: createShortcutBinding('ArrowRight', { ctrl: true, alt: true }),
  volumeUp: createShortcutBinding('ArrowUp', { ctrl: true, alt: true }),
  volumeDown: createShortcutBinding('ArrowDown', { ctrl: true, alt: true }),
  toggleMiniMode: createShortcutBinding('KeyM', { ctrl: true, alt: true }),
  toggleFavorite: createShortcutBinding('KeyL', { ctrl: true, alt: true }),
  toggleDesktopLyrics: createShortcutBinding('KeyD', { ctrl: true, alt: true }),
  toggleDesktopLyricsLock: null,
};

export const createDefaultShortcutSettings = (): ShortcutSettings => ({
  enabled: true,
  globalEnabled: false,
  useSystemMediaKeys: true,
  local: createShortcutBindingMap(defaultLocalShortcutBindings),
  global: createShortcutBindingMap(defaultGlobalShortcutBindings),
});

const normalizeShortcutBinding = (value: unknown): ShortcutBinding | null => {
  if (value === null) {
    return null;
  }

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }

  const candidate = value as Partial<ShortcutBinding>;
  if (typeof candidate.code !== 'string' || candidate.code.trim().length === 0) {
    return null;
  }

  return createShortcutBinding(candidate.code.trim(), candidate);
};

const normalizeShortcutBindingMap = (
  value: unknown,
  fallback: ShortcutBindingMap,
): ShortcutBindingMap => {
  const next = createShortcutBindingMap(fallback);

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return next;
  }

  const candidate = value as Partial<Record<ShortcutActionId, ShortcutBinding | null>>;

  for (const actionId of shortcutActionOrder) {
    if (!(actionId in candidate)) {
      continue;
    }

    next[actionId] = normalizeShortcutBinding(candidate[actionId]);
  }

  return next;
};

export const normalizeShortcutSettings = (value: unknown): ShortcutSettings => {
  const defaults = createDefaultShortcutSettings();

  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return defaults;
  }

  const candidate = value as Partial<ShortcutSettings>;

  return {
    enabled: typeof candidate.enabled === 'boolean' ? candidate.enabled : defaults.enabled,
    globalEnabled: typeof candidate.globalEnabled === 'boolean'
      ? candidate.globalEnabled
      : defaults.globalEnabled,
    useSystemMediaKeys: typeof candidate.useSystemMediaKeys === 'boolean'
      ? candidate.useSystemMediaKeys
      : defaults.useSystemMediaKeys,
    local: normalizeShortcutBindingMap(candidate.local, defaults.local),
    global: normalizeShortcutBindingMap(candidate.global, defaults.global),
  };
};

export type ShortcutSettingsPatch = Partial<Omit<ShortcutSettings, 'local' | 'global'>> & {
  local?: Partial<ShortcutBindingMap>;
  global?: Partial<ShortcutBindingMap>;
};

export const mergeShortcutSettings = (
  base: ShortcutSettings,
  patch: ShortcutSettingsPatch = {},
): ShortcutSettings => {
  const normalizedBase = normalizeShortcutSettings(base);
  const next = createDefaultShortcutSettings();

  next.enabled = patch.enabled ?? normalizedBase.enabled;
  next.globalEnabled = patch.globalEnabled ?? normalizedBase.globalEnabled;
  next.useSystemMediaKeys = patch.useSystemMediaKeys ?? normalizedBase.useSystemMediaKeys;
  next.local = {
    ...createShortcutBindingMap(normalizedBase.local),
    ...normalizeShortcutBindingMap(patch.local, normalizedBase.local),
  };
  next.global = {
    ...createShortcutBindingMap(normalizedBase.global),
    ...normalizeShortcutBindingMap(patch.global, normalizedBase.global),
  };

  return next;
};

const shortcutCodeLabels: Record<string, string> = {
  Space: 'Space',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  Enter: 'Enter',
  Escape: 'Esc',
  Backspace: 'Backspace',
  Delete: 'Delete',
  Tab: 'Tab',
};

const modifierCodes = new Set([
  'ControlLeft',
  'ControlRight',
  'ShiftLeft',
  'ShiftRight',
  'AltLeft',
  'AltRight',
  'MetaLeft',
  'MetaRight',
]);

export const isSystemReservedShortcutEvent = (event: KeyboardEvent) => event.metaKey;

export const formatShortcutCode = (code: string) => {
  if (shortcutCodeLabels[code]) {
    return shortcutCodeLabels[code];
  }

  if (code.startsWith('Key')) {
    return code.slice(3).toUpperCase();
  }

  if (code.startsWith('Digit')) {
    return code.slice(5);
  }

  if (code.startsWith('Numpad')) {
    return `Num ${code.slice(6)}`;
  }

  return code;
};

export const formatShortcutBinding = (binding: ShortcutBinding | null, emptyLabel = '未设置') => {
  if (!binding) {
    return emptyLabel;
  }

  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  if (binding.meta) parts.push('Meta');
  parts.push(formatShortcutCode(binding.code));
  return parts.join(' + ');
};

export const toGlobalShortcutAccelerator = (binding: ShortcutBinding | null) => {
  if (!binding || binding.meta) {
    return null;
  }

  const parts: string[] = [];
  if (binding.shift) parts.push('shift');
  if (binding.ctrl) parts.push('control');
  if (binding.alt) parts.push('alt');
  parts.push(binding.code);

  return parts.join('+');
};

export const areShortcutBindingsEqual = (
  left: ShortcutBinding | null,
  right: ShortcutBinding | null,
) => {
  if (left === right) {
    return true;
  }

  if (!left || !right) {
    return false;
  }

  return left.code === right.code
    && left.ctrl === right.ctrl
    && left.alt === right.alt
    && left.shift === right.shift
    && left.meta === right.meta;
};

export const getShortcutBindingFromEvent = (event: KeyboardEvent): ShortcutBinding | null => {
  if (!event.code || isSystemReservedShortcutEvent(event) || modifierCodes.has(event.code)) {
    return null;
  }

  return createShortcutBinding(event.code, {
    ctrl: event.ctrlKey,
    alt: event.altKey,
    shift: event.shiftKey,
    meta: false,
  });
};

export const matchesShortcutEvent = (binding: ShortcutBinding | null, event: KeyboardEvent) => {
  if (!binding || binding.meta || isSystemReservedShortcutEvent(event)) {
    return false;
  }

  return binding.code === event.code
    && binding.ctrl === event.ctrlKey
    && binding.alt === event.altKey
    && binding.shift === event.shiftKey
    && binding.meta === event.metaKey;
};
