import { computed, ref, watch } from 'vue';

export function useSidebarNavigationPath(getRoutePath: () => string) {
  const navigationPath = ref('/');

  // Keep the music selection stable while its sidebar leaves for settings.
  watch(getRoutePath, (path) => {
    if (path !== '/settings' && !path.startsWith('/settings/')) {
      navigationPath.value = path;
    }
  }, { immediate: true, flush: 'sync' });

  return computed(() => navigationPath.value);
}
