<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useLibraryStore } from '../../features/library/store';

const libraryStore = useLibraryStore();
const { genreCatalog } = storeToRefs(libraryStore);
</script>

<template>
  <header class="h-auto px-4 pt-2 pb-2 shrink-0 select-none flex items-center gap-3 relative z-10 md:px-5">
    <h2 class="text-xl font-bold text-gray-900 dark:text-white">流派</h2>
    <span class="text-xs text-gray-500 dark:text-gray-400">
      {{ genreCatalog.length }} 个流派
    </span>
  </header>
</template>
