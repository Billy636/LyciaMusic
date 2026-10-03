<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { getVersion } from '@tauri-apps/api/app';
import ModernModal from '../common/ModernModal.vue';
import UpdateAvailableDialog from '../overlays/UpdateAvailableDialog.vue';
import SponsorModal from './SponsorModal.vue';
import { checkForUpdates, type UpdateCheckResult } from '../../composables/useUpdateCheck';

const REPO_OWNER = 'Billy636';
const REPO_NAME = 'LyciaMusic';
const REPO_URL = `https://github.com/${REPO_OWNER}/${REPO_NAME}`;

const appVersion = ref('');
const isCheckingUpdate = ref(false);

const dialogVisible = ref(false);
const sponsorVisible = ref(false);
const dialogTitle = ref('');
const dialogContent = ref('');
const dialogConfirmText = ref('确定');
const dialogCancelText = ref('取消');
const updateVisible = ref(false);
const availableUpdate = ref<UpdateCheckResult | null>(null);

async function loadAppVersion() {
  try {
    appVersion.value = await getVersion();
  } catch (error) {
    console.error('Failed to get version:', error);
    appVersion.value = 'Unknown';
  }
}

function showDialog(options: {
  title: string;
  content: string;
  confirmText: string;
  cancelText: string;
}) {
  dialogTitle.value = options.title;
  dialogContent.value = options.content;
  dialogConfirmText.value = options.confirmText;
  dialogCancelText.value = options.cancelText;
  dialogVisible.value = true;
}

async function handleCheckUpdate() {
  if (isCheckingUpdate.value) {
    return;
  }

  isCheckingUpdate.value = true;

  try {
    const { currentVersion, release: latestRelease, comparison } = await checkForUpdates();
    appVersion.value = currentVersion;
    const latestSourceText = latestRelease.source === 'official' ? '官网' : 'GitHub';

    if (comparison > 0) {
      availableUpdate.value = { currentVersion, release: latestRelease, comparison };
      updateVisible.value = true;
      return;
    }

    if (comparison < 0) {
      showDialog({
        title: '当前版本较新',
        content: `当前版本 v${appVersion.value} 高于${latestSourceText}最新发布版本 v${latestRelease.version}。你现在大概率运行的是测试版或未发布版本。`,
        confirmText: '知道了',
        cancelText: '关闭'
      });
      return;
    }

    showDialog({
      title: '已是最新版本',
      content: `当前版本 v${appVersion.value} 已是${latestSourceText}最新版本。`,
      confirmText: '知道了',
      cancelText: '关闭'
    });
  } catch (error) {
    console.error('Failed to check updates:', error);
    showDialog({
      title: '检查更新失败',
      content: '无法连接到 GitHub Releases 或官网更新接口。请确认网络可用，或稍后再试。',
      confirmText: '知道了',
      cancelText: '关闭'
    });
  } finally {
    isCheckingUpdate.value = false;
  }
}

onMounted(() => {
  void loadAppVersion();
});
</script>

<template>
  <div class="flex min-h-full w-full flex-col items-center justify-center space-y-6 py-4 sm:space-y-8 animate-in fade-in zoom-in-95 duration-300">
    <div class="flex flex-col items-center space-y-4 sm:space-y-6 text-center">
      <div class="flex items-center justify-center">
        <img
          src="/app.png"
          alt="Logo"
          class="h-28 w-28 sm:h-36 sm:w-36 md:h-40 md:w-40 object-contain transition-all duration-300"
        />
      </div>

      <div class="space-y-1">
        <h1 class="text-2xl sm:text-3xl font-bold tracking-tight text-gray-800 dark:text-white">Lycia Player</h1>
        <p class="text-xs sm:text-sm font-medium text-gray-600 dark:text-white/60">v{{ appVersion }}</p>
      </div>

      <p class="max-w-xs sm:max-w-sm text-xs sm:text-sm leading-relaxed text-gray-600 dark:text-gray-300">
        <span class="block">一个现代化的本地音乐播放器，</span>
        <span class="block">可以管理音乐标签、封面与<span class="whitespace-nowrap">歌词。</span></span>
      </p>
    </div>

    <div class="flex max-w-full flex-wrap items-center justify-center gap-3 sm:gap-4 px-2">
      <a
        href="https://lycia.prettyboy.fun/"
        target="_blank"
        rel="noreferrer"
        class="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-white/30 backdrop-blur-md border border-white/40 px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-medium text-gray-800 no-underline transition active:scale-95 shadow-sm hover:bg-white/40 dark:bg-black/20 dark:border-white/10 dark:text-white dark:hover:bg-white/10 whitespace-nowrap"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM4.332 8.027a6.012 6.012 0 011.912-2.706C6.512 5.73 6.974 6 7.5 6A1.5 1.5 0 019 7.5V8a2 2 0 004 0 2 2 0 011.523-1.943A5.977 5.977 0 0116 10c0 .34-.028.675-.083 1H15a2 2 0 00-2 2v2.197A5.973 5.973 0 0110 16v-2a2 2 0 00-2-2 2 2 0 01-2-2 2 2 0 00-1.668-1.973z" clip-rule="evenodd" />
        </svg>
        <span>官方网站</span>
      </a>

      <a
        :href="REPO_URL"
        target="_blank"
        rel="noreferrer"
        class="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-white/30 backdrop-blur-md border border-white/40 px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-medium text-gray-800 no-underline transition active:scale-95 shadow-sm hover:bg-white/40 dark:bg-black/20 dark:border-white/10 dark:text-white dark:hover:bg-white/10 whitespace-nowrap"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0C5.373 0 0 5.373 0 12c0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23A11.49 11.49 0 0 1 12 5.797c1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576C20.566 21.8 24 17.302 24 12c0-6.627-5.373-12-12-12Z" /></svg>
        <span>GitHub 仓库</span>
      </a>

      <button
        type="button"
        :disabled="isCheckingUpdate"
        @click="handleCheckUpdate"
        class="flex shrink-0 items-center gap-2 rounded-xl bg-[#EC4141] px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-medium text-white shadow-lg shadow-red-500/20 transition active:scale-95 hover:bg-[#d13a3a] disabled:cursor-not-allowed disabled:opacity-70 whitespace-nowrap"
      >
        <svg v-if="isCheckingUpdate" class="h-4 w-4 sm:h-5 sm:w-5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4" />
          <path class="opacity-90" fill="currentColor" d="M4 12a8 8 0 0 1 8-8v4a4 4 0 0 0-4 4H4Z" />
        </svg>
        <svg v-else xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 20 20" fill="currentColor"><path fill-rule="evenodd" d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm1-11a1 1 0 1 0-2 0v2H7a1 1 0 1 0 0 2h2v2a1 1 0 1 0 2 0v-2h2a1 1 0 1 0 0-2h-2V7Z" clip-rule="evenodd" /></svg>
        <span>{{ isCheckingUpdate ? '检查中...' : '检查更新' }}</span>
      </button>

      <button
        type="button"
        @click="sponsorVisible = true"
        class="flex shrink-0 cursor-pointer items-center gap-2 rounded-xl bg-gradient-to-r from-pink-500 to-rose-500 px-4 py-2 sm:px-5 sm:py-2.5 text-xs sm:text-sm font-medium text-white shadow-lg shadow-rose-500/20 transition active:scale-95 hover:from-pink-600 hover:to-rose-600 whitespace-nowrap"
      >
        <svg xmlns="http://www.w3.org/2000/svg" class="h-4 w-4 sm:h-5 sm:w-5" viewBox="0 0 20 20" fill="currentColor">
          <path fill-rule="evenodd" d="M3.172 5.172a4 4 0 015.656 0L10 6.343l1.172-1.171a4 4 0 115.656 5.656L10 17.657l-6.828-6.829a4 4 0 010-5.656z" clip-rule="evenodd" />
        </svg>
        <span>支持作者</span>
      </button>
    </div>

    <div class="mt-4 sm:mt-8 text-center text-xs text-gray-400 dark:text-gray-600">
      Copyright © 2026 LyciaPlayer Developer. Licensed under AGPL-3.0-only.
    </div>

    <ModernModal
      v-model:visible="dialogVisible"
      :title="dialogTitle"
      :content="dialogContent"
      :confirm-text="dialogConfirmText"
      :cancel-text="dialogCancelText"
    />

    <SponsorModal
      v-model:visible="sponsorVisible"
    />
    <UpdateAvailableDialog
      v-model:visible="updateVisible"
      :current-version="availableUpdate?.currentVersion ?? ''"
      :release="availableUpdate?.release ?? null"
    />
  </div>
</template>
