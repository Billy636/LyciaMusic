<script setup lang="ts">
import { useId } from 'vue';

defineProps<{ albumArtist: boolean }>();
const recordMaskId = `artist-mode-record-${useId()}`;
</script>

<template>
  <svg
    aria-hidden="true"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="1.7"
    stroke-linecap="round"
    stroke-linejoin="round"
    xmlns="http://www.w3.org/2000/svg"
  >
    <template v-if="albumArtist">
      <defs>
        <mask :id="recordMaskId" maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="white" stroke="none" />
          <circle cx="12" cy="12" r="4" fill="black" stroke="none" />
          <path d="M5 24v-3a7 5 0 0 1 14 0v3Z" fill="black" stroke="none" />
        </mask>
      </defs>
      <g :mask="`url(#${recordMaskId})`">
        <circle cx="12" cy="10" r="9" />
        <circle cx="12" cy="10" r="1.3" />
      </g>
      <circle cx="12" cy="12" r="3" />
      <path d="M6 22v-1a6 4 0 0 1 12 0v1" />
    </template>
    <template v-else>
      <circle cx="12" cy="8" r="3.5" />
      <path d="M5 21v-2a7 7 0 0 1 14 0v2" />
    </template>
  </svg>
</template>
