import { computed, ref, watch, type ComputedRef, type Ref } from 'vue';

export type PageTransitionName = '' | 'page-fade' | 'settings-forward' | 'settings-back';

function isSettingsPath(path: string) {
  return path === '/settings' || path.startsWith('/settings/');
}

export function resolvePageTransitionName(
  fromPath: string,
  toPath: string,
  skipTransition = false,
): PageTransitionName {
  if (skipTransition) return '';
  if (isSettingsPath(toPath)) return 'settings-forward';
  if (isSettingsPath(fromPath)) return 'settings-back';
  return 'page-fade';
}

export function usePageTransition(
  getRoutePath: () => string,
  skipNextPageTransition: Ref<boolean>,
) {
  const previousPath = ref(getRoutePath());

  // Keep the departing route available until both halves of the transition finish.
  // Tracking only the destination would lose the settings animation on the way out.
  watch(getRoutePath, (_path, oldPath) => {
    previousPath.value = oldPath;
  }, { flush: 'sync' });

  return computed(() => resolvePageTransitionName(
    previousPath.value,
    getRoutePath(),
    skipNextPageTransition.value,
  ));
}

export function usePageTransitionLayout(
  getRoutePath: () => string,
  skipNextPageTransition: Ref<boolean>,
  isMiniMode: Ref<boolean>,
): {
  isSettingsLayout: ComputedRef<boolean>;
  commitPageLayout: () => void;
} {
  const displayedPath = ref(getRoutePath());
  const isSettingsLayout = computed(() => isSettingsPath(displayedPath.value));
  const commitPageLayout = () => {
    // Read at commit time so interrupted transitions adopt the latest destination.
    displayedPath.value = getRoutePath();
  };

  // The old page must keep its original width throughout its leave animation.
  // When animation is bypassed (or the main shell is absent), no hook can be
  // relied on to advance the layout, so apply the actual route immediately.
  watch([getRoutePath, skipNextPageTransition, isMiniMode], () => {
    if (skipNextPageTransition.value || isMiniMode.value) commitPageLayout();
  }, { flush: 'sync' });

  return { isSettingsLayout, commitPageLayout };
}
