import { effectScope, ref, type Ref } from 'vue';
import { describe, expect, it } from 'vitest';

import { resolvePageTransitionName, usePageTransition, usePageTransitionLayout } from './usePageTransition';

describe('page transition selection', () => {
  it.each([
    ['/', '/settings'],
    ['/album/123', '/settings'],
    ['/settings', '/settings/theme'],
    ['/settings/theme', '/settings/sidebar'],
  ])('uses forward motion when entering settings from %s to %s', (fromPath, toPath) => {
    expect(resolvePageTransitionName(fromPath, toPath)).toBe('settings-forward');
  });

  it.each([
    ['/settings', '/'],
    ['/settings', '/playlist/123'],
    ['/settings/theme', '/album/123'],
  ])('reverses the motion when leaving settings from %s to %s', (fromPath, toPath) => {
    expect(resolvePageTransitionName(fromPath, toPath)).toBe('settings-back');
  });

  it.each([
    ['/', '/library'],
    ['/album/123', '/playlist/456'],
    ['/settings-backup', '/'],
    ['/', '/settings-backup'],
  ])('preserves the music-page transition from %s to %s', (fromPath, toPath) => {
    expect(resolvePageTransitionName(fromPath, toPath)).toBe('page-fade');
  });

  it.each([
    ['/', '/settings'],
    ['/settings', '/'],
    ['/settings', '/settings/theme'],
    ['/', '/library'],
  ])('lets startup and tray navigation skip animation from %s to %s', (fromPath, toPath) => {
    expect(resolvePageTransitionName(fromPath, toPath, true)).toBe('');
  });

  it('reactively tracks entry, exit, the next music route and the skip override', () => {
    const scope = effectScope();
    try {
      scope.run(() => {
        const path = ref('/');
        const skip = ref(false);
        const transitionName = usePageTransition(() => path.value, skip);

        expect(transitionName.value).toBe('page-fade');
        path.value = '/settings';
        expect(transitionName.value).toBe('settings-forward');
        path.value = '/settings/theme';
        expect(transitionName.value).toBe('settings-forward');
        path.value = '/library';
        expect(transitionName.value).toBe('settings-back');
        path.value = '/album/123';
        expect(transitionName.value).toBe('page-fade');

        skip.value = true;
        path.value = '/settings';
        expect(transitionName.value).toBe('');
        skip.value = false;
        expect(transitionName.value).toBe('settings-forward');
        skip.value = true;
        path.value = '/';
        expect(transitionName.value).toBe('');
        skip.value = false;
        expect(transitionName.value).toBe('settings-back');
        path.value = '/library';
        expect(transitionName.value).toBe('page-fade');
      });
    } finally {
      scope.stop();
    }
  });

  it('keeps the correct direction through rapid route changes without waiting for a tick', () => {
    const scope = effectScope();
    try {
      scope.run(() => {
        const path = ref('/');
        const transitionName = usePageTransition(() => path.value, ref(false));

        const sequence = [
          ['/settings', 'settings-forward'],
          ['/', 'settings-back'],
          ['/settings', 'settings-forward'],
          ['/settings/theme', 'settings-forward'],
          ['/albums', 'settings-back'],
          ['/favorites', 'page-fade'],
        ] as const;

        for (const [destination, expected] of sequence) {
          path.value = destination;
          expect(transitionName.value).toBe(expected);
        }
      });
    } finally {
      scope.stop();
    }
  });
});

type LayoutTestContext = ReturnType<typeof usePageTransitionLayout> & {
  path: Ref<string>;
  skip: Ref<boolean>;
  mini: Ref<boolean>;
};

function withPageLayout(initialPath: string, check: (context: LayoutTestContext) => void) {
  const scope = effectScope();
  try {
    scope.run(() => {
      const path = ref(initialPath);
      const skip = ref(false);
      const mini = ref(false);
      const layout = usePageTransitionLayout(() => path.value, skip, mini);
      check({ path, skip, mini, ...layout });
    });
  } finally {
    scope.stop();
  }
}

describe('page transition layout timing', () => {
  it.each(['/settings', '/settings/theme'])('starts with the settings layout when mounted at %s', (initialPath) => {
    withPageLayout(initialPath, ({ isSettingsLayout }) => {
      expect(isSettingsLayout.value).toBe(true);
    });
  });

  it('retains music layout while entering settings until the outgoing page has left', () => {
    withPageLayout('/', ({ path, isSettingsLayout, commitPageLayout }) => {
      path.value = '/settings';
      expect(isSettingsLayout.value).toBe(false);

      commitPageLayout();
      expect(isSettingsLayout.value).toBe(true);
    });
  });

  it('retains settings layout while returning to music until the outgoing page has left', () => {
    withPageLayout('/settings', ({ path, isSettingsLayout, commitPageLayout }) => {
      path.value = '/albums';
      expect(isSettingsLayout.value).toBe(true);

      commitPageLayout();
      expect(isSettingsLayout.value).toBe(false);
    });
  });

  it('commits the latest destination after rapid navigation instead of a stale route', () => {
    withPageLayout('/', ({ path, isSettingsLayout, commitPageLayout }) => {
      path.value = '/settings';
      path.value = '/albums';
      commitPageLayout();
      expect(isSettingsLayout.value).toBe(false);

      path.value = '/settings';
      path.value = '/favorites';
      path.value = '/settings/theme';
      expect(isSettingsLayout.value).toBe(false);
      commitPageLayout();
      expect(isSettingsLayout.value).toBe(true);

      // A second hook for the same incoming page is safe and idempotent.
      commitPageLayout();
      expect(isSettingsLayout.value).toBe(true);
    });
  });

  it.each(['skip', 'mini'] as const)('applies pending and subsequent routes immediately under %s, then resumes deferral', (flagName) => {
    withPageLayout('/', (context) => {
      const { path, isSettingsLayout, commitPageLayout } = context;
      const bypass = context[flagName];

      path.value = '/settings';
      expect(isSettingsLayout.value).toBe(false);
      bypass.value = true;
      expect(isSettingsLayout.value).toBe(true);

      path.value = '/';
      expect(isSettingsLayout.value).toBe(false);
      path.value = '/settings/sidebar';
      expect(isSettingsLayout.value).toBe(true);

      bypass.value = false;
      path.value = '/albums';
      expect(isSettingsLayout.value).toBe(true);
      commitPageLayout();
      expect(isSettingsLayout.value).toBe(false);
    });
  });

  it('does not confuse similarly named music routes with the settings layout', () => {
    withPageLayout('/settings-backup', ({ path, isSettingsLayout, commitPageLayout }) => {
      expect(isSettingsLayout.value).toBe(false);
      path.value = '/settings';
      commitPageLayout();
      expect(isSettingsLayout.value).toBe(true);
      path.value = '/settings-backup';
      commitPageLayout();
      expect(isSettingsLayout.value).toBe(false);
    });
  });
});
