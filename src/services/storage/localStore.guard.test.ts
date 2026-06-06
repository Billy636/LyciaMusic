/**
 * Additional tests for localStore non-browser environment guards.
 * Specifically validates the P1 fix: localStorage access in Node environments.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';
import { localStore } from './localStore';
import localStoreSource from './localStore.ts?raw';

describe('localStore: non-browser environment safety', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('getString returns null when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(localStore.getString('key')).toBeNull();
  });

  it('setString does not throw when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => localStore.setString('key', 'value')).not.toThrow();
  });

  it('remove does not throw when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => localStore.remove('key')).not.toThrow();
  });

  it('clear does not throw when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => localStore.clear()).not.toThrow();
  });

  it('getJson returns null when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(localStore.getJson('key')).toBeNull();
  });

  it('setJson does not throw when localStorage is undefined', () => {
    vi.stubGlobal('localStorage', undefined);
    expect(() => localStore.setJson('key', { data: true })).not.toThrow();
  });

  it('typeof localStorage === "undefined" check is used (source code verification)', () => {
    // Every method that accesses localStorage should have the guard
    const guardCount = (localStoreSource.match(/typeof localStorage === 'undefined'/g) || []).length;
    // There should be at least 6 guards: getString, setString, remove, clear, getJson, setJson
    expect(guardCount).toBeGreaterThanOrEqual(6);
  });
});

describe('localStore: with localStorage available', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('round-trips complex JSON objects', () => {
    const storage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
      clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
      get length() { return Object.keys(storage).length; },
      key: (i: number) => Object.keys(storage)[i] ?? null,
    });

    const complexData = {
      presets: [
        { id: '1', gains: [1.5, 2.5], name: '测试' },
        { id: '2', gains: [-1, -2], name: 'test' },
      ],
      meta: { version: 2 },
    };

    localStore.setJson('complex', complexData);
    const result = localStore.getJson<typeof complexData>('complex');
    expect(result).toEqual(complexData);
  });

  it('handles concurrent writes and reads', () => {
    const storage: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => { storage[key] = value; },
      removeItem: (key: string) => { delete storage[key]; },
      clear: () => { Object.keys(storage).forEach(k => delete storage[k]); },
      get length() { return Object.keys(storage).length; },
      key: (i: number) => Object.keys(storage)[i] ?? null,
    });

    for (let i = 0; i < 100; i++) {
      localStore.setJson(`key_${i}`, { index: i });
    }

    for (let i = 0; i < 100; i++) {
      expect(localStore.getJson<{ index: number }>(`key_${i}`)).toEqual({ index: i });
    }
  });
});
