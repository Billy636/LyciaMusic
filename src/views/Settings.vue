<script setup lang="ts">
import { onBeforeUnmount, ref, watch } from 'vue';
import { storeToRefs } from 'pinia';
import { Captions, ChevronRight, PaintRoller, PanelLeft, PanelBottom, PanelBottomDashed } from 'lucide-vue-next';
import { useRoute } from 'vue-router';
import {
  PERSONALIZATION_PAGE_LABELS,
  SETTINGS_SECTION_LABELS,
  useSettingsNavigationStore,
  type PersonalizationPage,
  type SettingsSection,
} from '../features/settings/navigation';
import SettingsAbout from "../components/settings/SettingsAbout.vue";
import SettingsDesktopLyrics from "../components/settings/SettingsDesktopLyrics.vue";
import SettingsGeneral from "../components/settings/SettingsGeneral.vue";
import SettingsLibrary from "../components/settings/SettingsLibrary.vue";
import SettingsRemoteLibrary from "../components/settings/SettingsRemoteLibrary.vue";
import SettingsShortcuts from "../components/settings/SettingsShortcuts.vue";
import SettingsSidebar from "../components/settings/SettingsSidebar.vue";
import SettingsTheme from "../components/settings/SettingsTheme.vue";
import SettingsToolbox from "../components/settings/SettingsToolbox.vue";
import SettingsAudioOutput from "../components/settings/SettingsAudioOutput.vue";
import SettingsFooter from '../components/settings/SettingsFooter.vue';
import SettingsTaskbarPlayer from '../components/settings/SettingsTaskbarPlayer.vue';

const navigation = useSettingsNavigationStore();
const { activeSection, personalizationPage } = storeToRefs(navigation);
const contentRef = ref<HTMLElement | null>(null);
const personalizationContentRef = ref<HTMLElement | null>(null);
const personalizationTransition = ref('personalization-forward');
const returnFocusPage = ref<PersonalizationPage | null>(null);
let isSidebarNavigation = false;

// Navigation belongs to this visit, not to the user's persisted preferences.
navigation.resetNavigation();
const route = useRoute();
watch(() => route.query.personalization, page => {
  if (page === 'footer') navigation.openPersonalizationPage('footer');
}, { immediate: true });
onBeforeUnmount(navigation.resetNavigation);

const tabs = [
  { id: 'general', name: SETTINGS_SECTION_LABELS.general },
  { id: 'personalization', name: SETTINGS_SECTION_LABELS.personalization },
  { id: 'audioOutput', name: SETTINGS_SECTION_LABELS.audioOutput },
  { id: 'toolbox', name: SETTINGS_SECTION_LABELS.toolbox },
  { id: 'library', name: SETTINGS_SECTION_LABELS.library },
  { id: 'remoteLibrary', name: SETTINGS_SECTION_LABELS.remoteLibrary },
  { id: 'shortcuts', name: SETTINGS_SECTION_LABELS.shortcuts },
  { id: 'about', name: SETTINGS_SECTION_LABELS.about },
] satisfies { id: SettingsSection; name: string }[];

const personalizationPages = [
  { id: 'theme', name: PERSONALIZATION_PAGE_LABELS.theme, icon: PaintRoller },
  { id: 'sidebar', name: PERSONALIZATION_PAGE_LABELS.sidebar, icon: PanelLeft },
  { id: 'footer', name: PERSONALIZATION_PAGE_LABELS.footer, icon: PanelBottom },
  { id: 'desktopLyrics', name: PERSONALIZATION_PAGE_LABELS.desktopLyrics, icon: Captions },
  { id: 'taskbarPlayer', name: PERSONALIZATION_PAGE_LABELS.taskbarPlayer, icon: PanelBottomDashed },
] satisfies { id: PersonalizationPage; name: string; icon: typeof PaintRoller }[];

const resetContentScroll = () => {
  if (contentRef.value) contentRef.value.scrollTop = 0;
};

const selectSection = (section: SettingsSection) => {
  isSidebarNavigation = true;
  returnFocusPage.value = null;
  navigation.selectSection(section);
};

const focusPersonalizationContent = (element: Element) => {
  if (activeSection.value !== 'personalization' || element !== personalizationContentRef.value) return;

  if (personalizationPage.value) {
    personalizationContentRef.value?.focus({ preventScroll: true });
  } else if (returnFocusPage.value) {
    // Wait until the new list has entered before restoring its entry's focus.
    contentRef.value
      ?.querySelector<HTMLButtonElement>(`[data-personalization-page="${returnFocusPage.value}"]`)
      ?.focus({ preventScroll: true });
    returnFocusPage.value = null;
  }
};

watch([activeSection, personalizationPage], ([section, page], [previousSection, previousPage]) => {
  personalizationTransition.value = page ? 'personalization-forward' : 'personalization-back';
  returnFocusPage.value = !isSidebarNavigation && section === 'personalization' && previousSection === 'personalization' && !page
    ? previousPage
    : null;
  isSidebarNavigation = false;

  // Both category switches and drill-downs reset when the incoming page enters.
});
</script>

<template>
  <div class="settings-page flex h-full flex-1 overflow-hidden transition-colors duration-500">
    <aside
      class="z-10 flex shrink-0 flex-col border-r border-white/20 p-4 dark:border-white/5"
      :style="{ width: 'var(--app-sidebar-width)' }"
    >
      <nav aria-label="设置分类" class="custom-scrollbar flex-1 space-y-1.5 overflow-y-auto overflow-x-hidden">
        <button
          v-for="tab in tabs"
          :key="tab.id"
          type="button"
          :data-settings-section="tab.id"
          :aria-current="activeSection === tab.id ? 'page' : undefined"
          class="settings-nav-item relative flex w-full cursor-pointer items-center rounded-md px-4 py-2.5 text-left text-sm transition-all duration-300 active:scale-[0.97]"
          :class="activeSection === tab.id ? 'translate-x-1 bg-black/10 font-semibold text-black shadow-sm dark:bg-white/10 dark:text-white' : 'font-medium text-gray-800 hover:translate-x-1 hover:bg-black/5 hover:text-black dark:text-gray-200 dark:hover:bg-white/5 dark:hover:text-white'"
          @click="selectSection(tab.id)"
        >
          <div
            v-if="activeSection === tab.id"
            class="absolute left-0 top-1/2 h-[18px] w-1 -translate-y-1/2 rounded-r-md bg-[#EC4141]"
          ></div>
          {{ tab.name }}
        </button>
      </nav>
    </aside>

    <main
      ref="contentRef"
      class="custom-scrollbar relative h-full min-w-0 flex-1 overflow-y-auto px-6 py-4"
    >
      <Transition name="settings-section" mode="out-in" @before-enter="resetContentScroll">
      <div :key="activeSection" :class="[
        activeSection === 'about' ? 'w-full min-h-full flex flex-col justify-center items-center py-4' : 'w-full pb-16',
        activeSection !== 'personalization' ? 'sm:pt-6' : '',
      ]">
        <SettingsGeneral v-if="activeSection === 'general'" />
        <section v-else-if="activeSection === 'personalization'" aria-labelledby="settings-page-heading">
          <Transition
            :name="personalizationTransition"
            mode="out-in"
            @before-enter="resetContentScroll"
            @after-enter="focusPersonalizationContent"
          >
            <div
              :key="personalizationPage ?? 'overview'"
              ref="personalizationContentRef"
              tabindex="-1"
              :aria-label="navigation.personalizationTitle"
              class="personalization-content outline-none"
            >
              <div v-if="!personalizationPage" class="personalization-list space-y-1">
                <button
                  v-for="page in personalizationPages"
                  :key="page.id"
                  type="button"
                  :data-personalization-page="page.id"
                  class="group flex min-h-16 w-full cursor-pointer items-center gap-4 rounded-md px-4 py-4 text-left text-gray-800 transition-colors hover:bg-black/[0.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#EC4141]/60 dark:text-gray-100 dark:hover:bg-white/5"
                  @click="navigation.openPersonalizationPage(page.id)"
                >
                  <component :is="page.icon" class="h-5 w-5 shrink-0" :stroke-width="1.7" aria-hidden="true" />
                  <span class="min-w-0 flex-1 text-base font-medium">{{ page.name }}</span>
                  <ChevronRight class="h-4 w-4 shrink-0 text-gray-500 transition-transform group-hover:translate-x-0.5 dark:text-gray-400" :stroke-width="1.7" aria-hidden="true" />
                </button>
              </div>
              <SettingsTheme v-else-if="personalizationPage === 'theme'" />
              <SettingsSidebar v-else-if="personalizationPage === 'sidebar'" />
              <SettingsFooter v-else-if="personalizationPage === 'footer'" />
              <SettingsDesktopLyrics v-else-if="personalizationPage === 'desktopLyrics'" />
              <SettingsTaskbarPlayer v-else-if="personalizationPage === 'taskbarPlayer'" />
            </div>
          </Transition>
        </section>
        <SettingsAudioOutput v-else-if="activeSection === 'audioOutput'" />
        <SettingsToolbox v-else-if="activeSection === 'toolbox'" />
        <SettingsLibrary v-else-if="activeSection === 'library'" />
        <SettingsRemoteLibrary v-else-if="activeSection === 'remoteLibrary'" />
        <SettingsShortcuts v-else-if="activeSection === 'shortcuts'" />
        <SettingsAbout v-else-if="activeSection === 'about'" />

        <div v-else class="flex h-[50vh] flex-col items-center justify-center space-y-4 text-gray-400">
          <div class="text-4xl opacity-50">施工中</div>
          <div>当前设置模块正在整理中。</div>
        </div>
      </div>
      </Transition>
    </main>
  </div>
</template>

<style scoped>
/* Route entry moves both panes together; category feedback resumes afterwards. */
.settings-page:is(.settings-forward-enter-active, .settings-forward-leave-active, .settings-back-enter-active, .settings-back-leave-active) .settings-nav-item {
  transition: none;
}

.settings-section-enter-active,
.personalization-forward-enter-active,
.personalization-back-enter-active {
  transition: opacity 180ms cubic-bezier(0.16, 1, 0.3, 1), transform 180ms cubic-bezier(0.16, 1, 0.3, 1);
}

.settings-section-leave-active,
.personalization-forward-leave-active,
.personalization-back-leave-active {
  pointer-events: none;
  transition: opacity 100ms ease-in, transform 100ms ease-in;
}

.settings-section-enter-from,
.personalization-forward-enter-from,
.personalization-back-leave-to {
  opacity: 0;
  transform: translateX(12px);
}

.settings-section-leave-to,
.personalization-forward-leave-to,
.personalization-back-enter-from {
  opacity: 0;
  transform: translateX(-12px);
}

@media (prefers-reduced-motion: reduce) {
  .settings-section-enter-active,
  .settings-section-leave-active,
  .personalization-forward-enter-active,
  .personalization-forward-leave-active,
  .personalization-back-enter-active,
  .personalization-back-leave-active {
    transition: none;
  }

  .settings-section-enter-from,
  .settings-section-leave-to,
  .personalization-forward-enter-from,
  .personalization-forward-leave-to,
  .personalization-back-enter-from,
  .personalization-back-leave-to {
    transform: none;
  }
}
</style>
