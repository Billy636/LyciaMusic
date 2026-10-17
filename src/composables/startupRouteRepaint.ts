import { nextTick, type Ref } from 'vue';
import type { Router } from 'vue-router';
import { waitForWindowPaint } from './windowPaint';

export interface StartupRouteRepaintOptions {
  router: Router;
  hasWindowMaterial: Ref<boolean>;
  skipNextPageTransition: Ref<boolean>;
  repaintRoute?: string;
}

export async function runStartupRouteRepaint({
  router,
  hasWindowMaterial,
  skipNextPageTransition,
  repaintRoute = '/settings',
}: StartupRouteRepaintOptions) {
  if (!hasWindowMaterial.value || router.currentRoute.value.path === repaintRoute) {
    return;
  }

  const originalRoute = router.currentRoute.value.fullPath || '/';
  skipNextPageTransition.value = true;

  try {
    await router.replace(repaintRoute);
    await nextTick();
    await waitForWindowPaint();

    await router.replace(originalRoute);
    await nextTick();
    await waitForWindowPaint();
  } finally {
    skipNextPageTransition.value = false;
  }
}
