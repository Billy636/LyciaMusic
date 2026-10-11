<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import PlayerColorBackground from '../player/PlayerColorBackground.vue';

const props = withDefaults(defineProps<{
  coverSrc: string;
  paused?: boolean;
  dark?: boolean;
}>(), { paused: false, dark: false });

const pageHidden = ref(typeof document !== 'undefined' && document.hidden);
const renderingSuspended = computed(() => props.paused || pageHidden.value);
const onVisibilityChanged = () => { pageHidden.value = document.hidden; };

onMounted(() => {
  document.addEventListener('visibilitychange', onVisibilityChanged);
});

onBeforeUnmount(() => {
  document.removeEventListener('visibilitychange', onVisibilityChanged);
});
</script>

<template>
  <div class="flow-background" :class="{ 'flow-background--dark': dark }" aria-hidden="true">
    <PlayerColorBackground
      class="flow-soft-background"
      mode="soft"
      palette="cover"
      :cover-src="coverSrc"
      :suspended="renderingSuspended"
    />
  </div>
</template>

<style scoped>
.flow-background {
  position: absolute;
  inset: 0;
  overflow: hidden;
  pointer-events: none;
  background: #fafafa;
}
.flow-background--dark { background: #121212; }
/* Keep dark text readable on light themes; dark themes use the player colors directly. */
.flow-soft-background { opacity: 0.22; }
.flow-background--dark .flow-soft-background { opacity: 1; }
</style>
