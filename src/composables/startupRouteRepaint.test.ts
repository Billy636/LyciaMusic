import { describe, expect, it, vi } from 'vitest';
import { ref } from 'vue';

import { runStartupRouteRepaint } from './startupRouteRepaint';

const createRouter = (path = '/', fullPath = path) => {
  const currentRoute = ref({ path, fullPath });
  return {
    currentRoute,
    replace: vi.fn(async (target: string) => {
      currentRoute.value = { path: target.split('?')[0], fullPath: target };
    }),
  };
};

describe('startup route repaint', () => {
  it('temporarily opens settings and restores the original route for transparent window materials', async () => {
    const router = createRouter('/albums', '/albums?artist=a');
    const skipNextPageTransition = ref(false);

    await runStartupRouteRepaint({
      router: router as never,
      hasWindowMaterial: ref(true),
      skipNextPageTransition,
    });

    expect(router.replace).toHaveBeenNthCalledWith(1, '/settings');
    expect(router.replace).toHaveBeenNthCalledWith(2, '/albums?artist=a');
    expect(skipNextPageTransition.value).toBe(false);
  });

  it('does nothing when no transparent window material is active', async () => {
    const router = createRouter('/albums');

    await runStartupRouteRepaint({
      router: router as never,
      hasWindowMaterial: ref(false),
      skipNextPageTransition: ref(false),
    });

    expect(router.replace).not.toHaveBeenCalled();
  });

  it('does not pulse when the current route is already settings', async () => {
    const router = createRouter('/settings');

    await runStartupRouteRepaint({
      router: router as never,
      hasWindowMaterial: ref(true),
      skipNextPageTransition: ref(false),
    });

    expect(router.replace).not.toHaveBeenCalled();
  });
});
