import { effectScope, ref } from 'vue';
import { describe, expect, it } from 'vitest';

import { useSidebarNavigationPath } from './useSidebarNavigationPath';

function createNavigation(initialPath = '/') {
  const scope = effectScope();
  const path = ref(initialPath);
  const navigationPath = scope.run(() => useSidebarNavigationPath(() => path.value))!;
  return { scope, path, navigationPath };
}

describe('music sidebar navigation path', () => {
  it.each(['/', '/albums', '/favorites'])('starts with the actual music route %s', (initialPath) => {
    const { scope, navigationPath } = createNavigation(initialPath);
    try {
      expect(navigationPath.value).toBe(initialPath);
    } finally {
      scope.stop();
    }
  });

  it.each(['/settings', '/settings/theme'])('falls back to local music when first mounted at %s', (initialPath) => {
    const { scope, navigationPath } = createNavigation(initialPath);
    try {
      expect(navigationPath.value).toBe('/');
    } finally {
      scope.stop();
    }
  });

  it('holds the last music selection through settings and its child routes', () => {
    const { scope, path, navigationPath } = createNavigation('/albums');
    try {
      for (const destination of ['/settings', '/settings/theme', '/settings/sidebar', '/settings/']) {
        path.value = destination;
        expect(navigationPath.value).toBe('/albums');
      }
      path.value = '/albums';
      expect(navigationPath.value).toBe('/albums');
      path.value = '/settings';
      path.value = '/favorites';
      expect(navigationPath.value).toBe('/favorites');
    } finally {
      scope.stop();
    }
  });

  it('treats similarly named paths as music routes rather than settings', () => {
    const { scope, path, navigationPath } = createNavigation('/settings-backup');
    try {
      expect(navigationPath.value).toBe('/settings-backup');
      path.value = '/settings';
      expect(navigationPath.value).toBe('/settings-backup');
      path.value = '/settings-archive';
      expect(navigationPath.value).toBe('/settings-archive');
    } finally {
      scope.stop();
    }
  });

  it('updates synchronously throughout rapid settings and music navigation', () => {
    const { scope, path, navigationPath } = createNavigation();
    try {
      for (const [destination, expected] of [
        ['/settings', '/'],
        ['/favorites', '/favorites'],
        ['/settings/theme', '/favorites'],
        ['/albums', '/albums'],
        ['/settings', '/albums'],
        ['/', '/'],
      ] as const) {
        path.value = destination;
        expect(navigationPath.value).toBe(expected);
      }
    } finally {
      scope.stop();
    }
  });

  it('keeps instances independent and stops tracking when their scope is disposed', () => {
    const first = createNavigation('/albums');
    const second = createNavigation('/favorites');
    try {
      first.path.value = '/settings';
      second.path.value = '/recent';
      expect(first.navigationPath.value).toBe('/albums');
      expect(second.navigationPath.value).toBe('/recent');

      first.scope.stop();
      first.path.value = '/';
      second.path.value = '/settings';
      expect(first.navigationPath.value).toBe('/albums');
      expect(second.navigationPath.value).toBe('/recent');
      second.path.value = '/';
      expect(second.navigationPath.value).toBe('/');
    } finally {
      first.scope.stop();
      second.scope.stop();
    }
  });
});
