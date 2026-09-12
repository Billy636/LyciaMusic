<script setup lang="ts">
defineProps<{
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
}>();

const emit = defineEmits<{
  (e: 'change', value: boolean): void;
}>();
</script>

<template>
  <button
    type="button"
    role="checkbox"
    :aria-checked="indeterminate ? 'mixed' : checked"
    :disabled="disabled"
    class="flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors focus:outline-none disabled:cursor-not-allowed disabled:opacity-40"
    :class="
      checked || indeterminate
        ? 'border-[#EC4141] bg-[#EC4141] text-white'
        : 'border-gray-300 bg-white/70 hover:border-[#EC4141] dark:border-white/25 dark:bg-white/5 dark:hover:border-[#EC4141]'
    "
    @click="emit('change', !checked)"
  >
    <svg
      v-if="indeterminate"
      viewBox="0 0 12 12"
      class="h-2.5 w-2.5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
    >
      <path d="M2.5 6h7" />
    </svg>
    <svg
      v-else-if="checked"
      viewBox="0 0 12 12"
      class="h-2.5 w-2.5"
      fill="none"
      stroke="currentColor"
      stroke-width="2"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <path d="M2.5 6.5 5 9l4.5-6" />
    </svg>
  </button>
</template>
