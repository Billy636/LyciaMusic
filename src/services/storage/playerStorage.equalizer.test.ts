/**
 * Comprehensive tests for playerStorage equalizer preset I/O.
 *
 * Covers:
 *   - readEqualizerPresets / writeEqualizerPresets round-trip
 *   - invalid data filtering
 *   - non-browser environment safety
 *   - storage key usage
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { playerStorage, playerStorageKeys } from './playerStorage';
import type { EqualizerPreset } from '../../types';

type StorageMap = Record<string, string>;

const createLocalStorageMock = () => {
  let storage: StorageMap = {};

  return {
    clear: vi.fn(() => {
      storage = {};
    }),
    getItem: vi.fn((key: string) => (key in storage ? storage[key] : null)),
    removeItem: vi.fn((key: string) => {
      delete storage[key];
    }),
    setItem: vi.fn((key: string, value: string) => {
      storage[key] = value;
    }),
    get length() {
      return Object.keys(storage).length;
    },
    key: vi.fn((index: number) => Object.keys(storage)[index] ?? null),
  };
};

const makePreset = (overrides: Partial<EqualizerPreset> = {}): EqualizerPreset => ({
  id: `user_test_${Math.random().toString(36).slice(2)}`,
  name: 'Test Preset',
  preamp: -2.0,
  gains: [1, 2, 3, 4, 5, 5, 4, 3, 2, 1],
  isBuiltin: false,
  createdAt: 1000,
  updatedAt: 2000,
  ...overrides,
});

describe('playerStorage: equalizer preset I/O', () => {
  beforeEach(() => {
    const mock = createLocalStorageMock();
    vi.stubGlobal('localStorage', mock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // -----------------------------------------------------------------------
  // Round-trip
  // -----------------------------------------------------------------------

  it('writes and reads back an empty preset array', () => {
    playerStorage.writeEqualizerPresets([]);
    expect(playerStorage.readEqualizerPresets()).toEqual([]);
  });

  it('writes and reads back a single preset', () => {
    const preset = makePreset({ name: 'Bass Boost' });
    playerStorage.writeEqualizerPresets([preset]);

    const result = playerStorage.readEqualizerPresets();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Bass Boost');
    expect(result[0].preamp).toBe(-2.0);
    expect(result[0].gains).toEqual([1, 2, 3, 4, 5, 5, 4, 3, 2, 1]);
  });

  it('writes and reads back multiple presets', () => {
    const presets = [
      makePreset({ name: 'Rock', id: 'user_rock' }),
      makePreset({ name: 'Jazz', id: 'user_jazz' }),
      makePreset({ name: 'Pop', id: 'user_pop' }),
    ];
    playerStorage.writeEqualizerPresets(presets);

    const result = playerStorage.readEqualizerPresets();
    expect(result).toHaveLength(3);
    expect(result.map(p => p.name)).toEqual(['Rock', 'Jazz', 'Pop']);
  });

  it('overwrites previous presets on write', () => {
    playerStorage.writeEqualizerPresets([makePreset({ name: 'Old' })]);
    playerStorage.writeEqualizerPresets([makePreset({ name: 'New' })]);

    const result = playerStorage.readEqualizerPresets();
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('New');
  });

  // -----------------------------------------------------------------------
  // Storage key
  // -----------------------------------------------------------------------

  it('uses the correct storage key', () => {
    expect(playerStorageKeys.equalizerPresets).toBe('player_equalizer_presets');
  });

  it('stores data under the expected localStorage key', () => {
    const preset = makePreset();
    playerStorage.writeEqualizerPresets([preset]);

    const raw = localStorage.getItem(playerStorageKeys.equalizerPresets);
    expect(raw).toBeTruthy();

    const parsed = JSON.parse(raw!);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed[0].id).toBe(preset.id);
  });

  // -----------------------------------------------------------------------
  // Invalid data filtering
  // -----------------------------------------------------------------------

  it('returns empty array when storage has no equalizer presets', () => {
    expect(playerStorage.readEqualizerPresets()).toEqual([]);
  });

  it('returns empty array when storage contains null', () => {
    localStorage.setItem(playerStorageKeys.equalizerPresets, 'null');
    expect(playerStorage.readEqualizerPresets()).toEqual([]);
  });

  it('returns empty array when storage contains invalid JSON', () => {
    localStorage.setItem(playerStorageKeys.equalizerPresets, '{broken json');
    expect(playerStorage.readEqualizerPresets()).toEqual([]);
  });

  it('returns empty array when storage contains a non-array value', () => {
    localStorage.setItem(playerStorageKeys.equalizerPresets, JSON.stringify({ name: 'not an array' }));
    expect(playerStorage.readEqualizerPresets()).toEqual([]);
  });

  it('filters out items without a string id', () => {
    const data = [
      makePreset({ id: 'valid_1', name: 'Valid' }),
      { name: 'No ID' },
      { id: 123, name: 'Numeric ID' },
      { id: null, name: 'Null ID' },
      null,
      undefined,
      'string item',
      makePreset({ id: 'valid_2', name: 'Also Valid' }),
    ];
    localStorage.setItem(playerStorageKeys.equalizerPresets, JSON.stringify(data));

    const result = playerStorage.readEqualizerPresets();
    expect(result).toHaveLength(2);
    expect(result.map(p => p.name)).toEqual(['Valid', 'Also Valid']);
  });

  it('filters out null and undefined array items', () => {
    const data = [null, undefined, makePreset({ id: 'survivor' }), 0, false, ''];
    localStorage.setItem(playerStorageKeys.equalizerPresets, JSON.stringify(data));

    const result = playerStorage.readEqualizerPresets();
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('survivor');
  });

  // -----------------------------------------------------------------------
  // Data integrity
  // -----------------------------------------------------------------------

  it('preserves all preset fields through serialization', () => {
    const preset: EqualizerPreset = {
      id: 'user_full',
      name: 'Full Preset',
      preamp: -6.5,
      gains: [-12, -6, -3, 0, 3, 6, 3, 0, -3, -6],
      isBuiltin: false,
      createdAt: 1700000000000,
      updatedAt: 1700000001000,
    };

    playerStorage.writeEqualizerPresets([preset]);
    const result = playerStorage.readEqualizerPresets();

    expect(result[0]).toEqual(preset);
  });

  it('handles presets with unicode names', () => {
    const preset = makePreset({ name: '低音增强 🎵 Ñ' });
    playerStorage.writeEqualizerPresets([preset]);

    const result = playerStorage.readEqualizerPresets();
    expect(result[0].name).toBe('低音增强 🎵 Ñ');
  });

  it('handles presets with empty string name', () => {
    const preset = makePreset({ name: '' });
    playerStorage.writeEqualizerPresets([preset]);

    const result = playerStorage.readEqualizerPresets();
    expect(result[0].name).toBe('');
  });

  it('handles extreme gain values', () => {
    const preset = makePreset({
      gains: [-12, -12, -12, -12, -12, 12, 12, 12, 12, 12],
    });
    playerStorage.writeEqualizerPresets([preset]);

    const result = playerStorage.readEqualizerPresets();
    expect(result[0].gains).toEqual([-12, -12, -12, -12, -12, 12, 12, 12, 12, 12]);
  });

  it('handles zero preamp value', () => {
    const preset = makePreset({ preamp: 0 });
    playerStorage.writeEqualizerPresets([preset]);

    const result = playerStorage.readEqualizerPresets();
    expect(result[0].preamp).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Non-browser environment
// ---------------------------------------------------------------------------

describe('playerStorage: equalizer preset I/O without localStorage', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('readEqualizerPresets returns empty array when localStorage is undefined', () => {
    // Do not stub localStorage — it should be absent
    vi.stubGlobal('localStorage', undefined);
    expect(playerStorage.readEqualizerPresets()).toEqual([]);
  });

  it('writeEqualizerPresets does not throw when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => {
      playerStorage.writeEqualizerPresets([makePreset()]);
    }).not.toThrow();
  });
});

// ---------------------------------------------------------------------------
// P2 Fix Verification: Comprehensive data validation
// ---------------------------------------------------------------------------

describe('P2 Fix: filters malformed equalizer presets', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createLocalStorageMock());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('filters presets missing required fields', () => {
    const validPreset = makePreset();
    const malformedData = [
      { id: 'bad_missing_gains', name: 'Bad' },
      { id: 'bad_missing_name', preamp: 0, gains: [0,0,0,0,0,0,0,0,0,0] },
      { name: 'Bad', gains: [0,0,0,0,0,0,0,0,0,0] }, // missing id
      validPreset,
    ];

    localStorage.setItem(playerStorageKeys.equalizerPresets, JSON.stringify(malformedData));

    const result = playerStorage.readEqualizerPresets();
    expect(result).toEqual([validPreset]);
  });

  it('filters presets with invalid gains array', () => {
    const validPreset = makePreset();
    const malformedData = [
      { id: 'bad_gains_short', name: 'Bad', preamp: 0, gains: [0,0,0], isBuiltin: false, createdAt: 1, updatedAt: 1 },
      { id: 'bad_gains_type', name: 'Bad', preamp: 0, gains: ['x','y','z','a','b','c','d','e','f','g'], isBuiltin: false, createdAt: 1, updatedAt: 1 },
      { id: 'bad_gains_nan', name: 'Bad', preamp: 0, gains: [NaN,0,0,0,0,0,0,0,0,0], isBuiltin: false, createdAt: 1, updatedAt: 1 },
      validPreset,
    ];

    localStorage.setItem(playerStorageKeys.equalizerPresets, JSON.stringify(malformedData));

    const result = playerStorage.readEqualizerPresets();
    expect(result).toEqual([validPreset]);
  });

  it('filters presets with invalid numeric fields', () => {
    const validPreset = makePreset();
    const malformedData = [
      { id: 'bad_preamp', name: 'Bad', preamp: NaN, gains: [0,0,0,0,0,0,0,0,0,0], isBuiltin: false, createdAt: 1, updatedAt: 1 },
      { id: 'bad_created', name: 'Bad', preamp: 0, gains: [0,0,0,0,0,0,0,0,0,0], isBuiltin: false, createdAt: NaN, updatedAt: 1 },
      { id: 'bad_updated', name: 'Bad', preamp: 0, gains: [0,0,0,0,0,0,0,0,0,0], isBuiltin: false, createdAt: 1, updatedAt: NaN },
      validPreset,
    ];

    localStorage.setItem(playerStorageKeys.equalizerPresets, JSON.stringify(malformedData));

    const result = playerStorage.readEqualizerPresets();
    expect(result).toEqual([validPreset]);
  });

  it('filters presets with invalid boolean field', () => {
    const validPreset = makePreset();
    const malformedData = [
      { id: 'bad_builtin', name: 'Bad', preamp: 0, gains: [0,0,0,0,0,0,0,0,0,0], isBuiltin: 'yes', createdAt: 1, updatedAt: 1 },
      validPreset,
    ];

    localStorage.setItem(playerStorageKeys.equalizerPresets, JSON.stringify(malformedData));

    const result = playerStorage.readEqualizerPresets();
    expect(result).toEqual([validPreset]);
  });

  it('filters presets with empty id', () => {
    const validPreset = makePreset();
    const malformedData = [
      { id: '', name: 'Bad', preamp: 0, gains: [0,0,0,0,0,0,0,0,0,0], isBuiltin: false, createdAt: 1, updatedAt: 1 },
      validPreset,
    ];

    localStorage.setItem(playerStorageKeys.equalizerPresets, JSON.stringify(malformedData));

    const result = playerStorage.readEqualizerPresets();
    expect(result).toEqual([validPreset]);
  });
});
