<script setup lang="ts">
import AppCheckbox from '../common/AppCheckbox.vue';
import { useToolboxStore, type ToolboxRules } from '../../features/toolbox/store';

const store = useToolboxStore();

interface RuleOption {
  key: keyof ToolboxRules;
  label: string;
  example: string;
}

const ruleOptions: RuleOption[] = [
  { key: 'remove_track_prefix', label: '去除序号前缀', example: '01. 歌名.flac → 歌名.flac' },
  { key: 'remove_source_prefix', label: '去除来源前缀', example: '[网易云] 歌名.flac → 歌名.flac' },
  { key: 'replace_underscore', label: '下划线转空格', example: '歌名_歌手.flac → 歌名 歌手.flac' },
  { key: 'collapse_spaces', label: '合并连续空格', example: '歌  名.flac → 歌 名.flac' },
];

const toggleRule = (key: keyof ToolboxRules, value: boolean) => {
  store.patchRules({ [key]: value });
};
</script>

<template>
  <section
    class="overflow-hidden rounded-xl border border-white/40 bg-white/55 backdrop-blur-md dark:border-white/10 dark:bg-white/5"
  >
    <header class="border-b border-white/30 px-4 py-3 dark:border-white/5">
      <h3 class="text-sm font-bold text-gray-800 dark:text-gray-200">清理规则</h3>
      <p class="mt-0.5 text-xs text-gray-400 dark:text-white/50">按需勾选，预览实时更新</p>
    </header>

    <div
      v-for="option in ruleOptions"
      :key="option.key"
      class="flex items-start gap-3 border-b border-white/30 px-4 py-3 transition-colors last:border-0 hover:bg-white/40 dark:border-white/5 dark:hover:bg-white/10"
    >
      <AppCheckbox
        class="mt-0.5"
        :checked="store.rules[option.key]"
        @change="(value) => toggleRule(option.key, value)"
      />
      <div class="min-w-0">
        <div class="text-sm font-medium text-gray-800 dark:text-gray-200">{{ option.label }}</div>
        <div class="mt-0.5 truncate font-mono text-xs text-gray-400 dark:text-white/50">
          {{ option.example }}
        </div>
      </div>
    </div>
  </section>
</template>
