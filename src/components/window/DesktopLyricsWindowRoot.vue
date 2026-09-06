<script setup lang="ts">
import { useImportedLyricsFonts } from '../../composables/useImportedLyricsFonts';
import DesktopLyricsWindow from '../player/DesktopLyricsWindow.vue';

useImportedLyricsFonts();
</script>

<template>
  <DesktopLyricsWindow />
</template>
