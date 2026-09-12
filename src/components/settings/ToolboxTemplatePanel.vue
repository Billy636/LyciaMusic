<script setup lang="ts">
import { computed } from 'vue';
import { useToast } from '../../composables/toast';
import { localStore } from '../../services/storage/localStore';
import { useToolboxStore, DEFAULT_TOOLBOX_TEMPLATE } from '../../features/toolbox/store';

const store = useToolboxStore();
const toast = useToast();

const TEMPLATE_STORAGE_KEY = 'toolbox_default_template';

interface TemplatePreset {
  label: string;
  example: string;
  value: string;
}

const presets: TemplatePreset[] = [
  { label: '歌名 - 歌手', example: '七里香 - 周杰伦', value: '{title} - {artist}' },
  { label: '歌手 - 歌名', example: '周杰伦 - 七里香', value: '{artist} - {title}' },
  { label: '轨道. 歌名', example: '01. 七里香', value: '{track}. {title}' },
];

const variables = [
  { code: '{title}', name: '标题' },
  { code: '{artist}', name: '歌手' },
  { code: '{album}', name: '专辑' },
  { code: '{year}', name: '年份' },
  { code: '{track}', name: '轨道号' },
];

const template = computed({
  get: () => store.template,
  set: (value: string) => store.setTemplate(value),
});

const activePreset = computed(() => presets.find((preset) => preset.value === template.value));

const insertVariable = (code: string) => {
  store.setTemplate(template.value + code);
};

const setAsDefault = () => {
  localStore.setString(TEMPLATE_STORAGE_KEY, template.value);
  toast.showToast('已设为默认模板', 'success');
};
</script>

<template>
  <section
    class="rounded-xl border border-white/40 bg-white/55 p-4 backdrop-blur-md dark:border-white/10 dark:bg-white/5"
  >
    <header>
      <h3 class="text-sm font-bold text-gray-800 dark:text-gray-200">命名模板</h3>
      <p class="mt-0.5 text-xs text-gray-400 dark:text-white/50">
        有标签的文件按模板重命名，缺标签的文件仅套用清理规则
      </p>
    </header>

    <div class="mt-3 flex flex-wrap gap-2">
      <button
        v-for="preset in presets"
        :key="preset.value"
        type="button"
        class="rounded-lg border px-2.5 py-1.5 text-xs font-medium transition"
        :class="
          activePreset?.value === preset.value
            ? 'border-[#EC4141] bg-[#EC4141] text-white'
            : 'border-gray-200 bg-white/70 text-gray-600 hover:border-[#EC4141] hover:text-[#EC4141] dark:border-white/10 dark:bg-white/5 dark:text-gray-300'
        "
        @click="store.setTemplate(preset.value)"
      >
        {{ preset.label }}
        <span class="ml-1 opacity-60">{{ preset.example }}</span>
      </button>
    </div>

    <input
      v-model="template"
      type="text"
      placeholder="自定义模板，如 {track}. {title}"
      class="mt-3 w-full rounded-lg border border-gray-200 bg-white/70 px-3 py-2 font-mono text-sm text-gray-800 transition focus:outline-none focus:ring-2 focus:ring-[#EC4141] dark:border-white/10 dark:bg-black/20 dark:text-gray-100"
    />

    <div class="mt-3 flex flex-wrap gap-1.5">
      <button
        v-for="variable in variables"
        :key="variable.code"
        type="button"
        class="rounded-md border border-gray-200 bg-white/70 px-2 py-1 text-xs transition hover:border-[#EC4141] dark:border-white/10 dark:bg-white/5"
        :title="`插入变量 ${variable.name}`"
        @click="insertVariable(variable.code)"
      >
        <span class="font-mono font-semibold text-gray-700 dark:text-gray-300">{{ variable.code }}</span>
        <span class="ml-1 text-gray-400 dark:text-white/40">{{ variable.name }}</span>
      </button>
    </div>

    <div class="mt-3 flex items-center justify-between">
      <button
        type="button"
        class="text-xs text-gray-500 transition hover:text-[#EC4141] dark:text-white/60 dark:hover:text-[#EC4141]"
        :disabled="template === DEFAULT_TOOLBOX_TEMPLATE"
        @click="setAsDefault"
      >
        设为默认模板
      </button>
    </div>
  </section>
</template>
