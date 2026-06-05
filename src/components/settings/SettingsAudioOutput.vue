<script setup lang="ts">
import { CircleAlert } from 'lucide-vue-next';
import { useSettings } from '../../features/settings/useSettings';
import EqualizerPanel from '../player/EqualizerPanel.vue';

const { settings, patchSettings } = useSettings();

const volumeBalanceTip = '音量平衡会读取歌曲内置 ReplayGain 标签，在切歌时自动平衡音量。默认完全按标签播放，不改变歌曲内部动态。不存在标签时则无变化。';

// 规范更新：启用/禁用均衡器
const toggleEqualizer = () => {
  const currentEq = settings.value.audio.equalizer;
  patchSettings({
    audio: {
      ...settings.value.audio, // 展开以保护其他 audio 状态不受非深合并影响
      equalizer: {
        ...currentEq,
        enabled: !currentEq.enabled,
      },
    },
  });
};

// 规范更新：在播放栏显示均衡器按钮
const toggleShowEqualizerInFooter = () => {
  patchSettings({
    audio: {
      ...settings.value.audio, // 展开以保护其他 audio 状态不受非深合并影响
      showEqualizerInFooter: !settings.value.audio.showEqualizerInFooter,
    },
  });
};
</script>

<template>
  <div class="w-full space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        音频处理
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 音量平衡主开关行 -->
        <div 
          class="desktop-setting-row"
          :class="settings.audio.volumeBalance.enabled ? 'rounded-t-xl' : 'rounded-xl'"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">音量平衡</div>
          </div>
          <div class="flex items-center gap-3">
            <span
              class="audio-tip"
              :aria-label="volumeBalanceTip"
              tabindex="0"
            >
              <CircleAlert class="h-4 w-4" aria-hidden="true" />
              <span class="audio-tip-popover" role="tooltip">{{ volumeBalanceTip }}</span>
            </span>
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.volumeBalance.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="settings.audio.volumeBalance.enabled = !settings.audio.volumeBalance.enabled"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.volumeBalance.enabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <!-- 高级音量平衡配置子区域 -->
        <div
          v-if="settings.audio.volumeBalance.enabled"
          class="flex flex-col border-t border-gray-200/20 dark:border-gray-800/20 bg-gray-50/10 dark:bg-gray-900/10 transition-all duration-300 animate-in fade-in rounded-b-xl"
        >
          <!-- 整体增益偏移设置 -->
          <div class="desktop-setting-row border-b border-gray-200/20 dark:border-gray-800/20 pl-8">
            <div class="flex-1 space-y-1">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200 flex items-center gap-2">
                整体增益偏移
                <span class="text-xs font-semibold px-2 py-0.5 rounded bg-gray-200 dark:bg-gray-800 text-gray-600 dark:text-gray-400">
                  {{ settings.audio.volumeBalance.gainOffsetDb > 0 ? '+' : '' }}{{ settings.audio.volumeBalance.gainOffsetDb }} dB
                </span>
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
                默认 0 dB，表示完全按 ReplayGain 标签播放。调高会整体更响，调低会保留更多余量。
              </div>
            </div>
            <div class="flex items-center gap-3">
              <input
                type="range"
                min="-12"
                max="6"
                step="1"
                v-model.number="settings.audio.volumeBalance.gainOffsetDb"
                class="w-36 h-1 rounded-lg bg-gray-200 dark:bg-gray-700 appearance-none cursor-pointer accent-[#EC4141]"
              />
            </div>
          </div>

          <!-- 防削波保护开关 -->
          <div class="desktop-setting-row pl-8 rounded-b-xl">
            <div class="flex-1 space-y-1">
              <div class="text-sm font-medium text-gray-800 dark:text-gray-200">
                防削波破音保护
              </div>
              <div class="text-xs text-gray-500 dark:text-gray-400 max-w-xl">
                当音量增益过大可能超出 0 dB 极限时自动降低音频信号。无峰值标签曲目会降级为不应用任何正增益。
              </div>
            </div>
            <div class="flex items-center gap-3">
              <button
                type="button"
                class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
                :class="settings.audio.volumeBalance.preventClipping ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
                @click="settings.audio.volumeBalance.preventClipping = !settings.audio.volumeBalance.preventClipping"
              >
                <span
                  class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                  :class="settings.audio.volumeBalance.preventClipping ? 'translate-x-6' : 'translate-x-1'"
                />
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 均衡器配置区 -->
    <section class="space-y-3">
      <h2 class="flex items-center gap-2 text-sm font-bold text-gray-800 dark:text-gray-200">
        <span class="h-4 w-1 rounded-full bg-[#EC4141]"></span>
        均衡器 (EQ)
      </h2>
      <div class="flex flex-col rounded-xl bg-white/20 dark:bg-black/10 border border-gray-200/40 dark:border-gray-800/40">
        <!-- 固定均衡器到播放栏开关行 -->
        <div 
          class="desktop-setting-row rounded-t-xl border-b border-gray-200/20 dark:border-gray-800/20"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">在播放栏显示均衡器按钮</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              开启后，在主界面底部的播放控制栏将显示均衡器快捷按钮。
            </div>
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.showEqualizerInFooter ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="toggleShowEqualizerInFooter"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.showEqualizerInFooter ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <!-- 启用均衡器主开关行 -->
        <div 
          class="desktop-setting-row"
          :class="settings.audio.equalizer.enabled ? 'border-b border-gray-200/20 dark:border-gray-800/20' : 'rounded-b-xl'"
        >
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">启用均衡器</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              通过调整不同频段的增益，改善音乐在不同音频设备上的表现。
            </div>
          </div>
          <div class="flex items-center gap-3">
            <button
              type="button"
              class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none"
              :class="settings.audio.equalizer.enabled ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'"
              @click="toggleEqualizer"
            >
              <span
                class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm"
                :class="settings.audio.equalizer.enabled ? 'translate-x-6' : 'translate-x-1'"
              />
            </button>
          </div>
        </div>

        <!-- 均衡器调节板高级配置子区域 -->
        <div
          v-if="settings.audio.equalizer.enabled"
          class="flex flex-col border-t border-gray-200/20 dark:border-gray-800/20 bg-gray-50/10 dark:bg-gray-900/10 transition-all duration-300 animate-in fade-in rounded-b-xl p-6"
        >
          <EqualizerPanel :embedded="true" />
        </div>
      </div>
    </section>
  </div>
</template>

<style scoped>
.desktop-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  padding: 16px;
  border-bottom: 1px solid rgba(255, 255, 255, 0.16);
  text-align: left;
  transition: background-color 160ms ease;
}

.desktop-setting-row:last-child {
  border-bottom: 0;
}

.desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.4);
}

:global(.dark) .desktop-setting-row {
  border-bottom-color: rgba(255, 255, 255, 0.05);
}

:global(.dark) .desktop-setting-row:hover {
  background: rgba(255, 255, 255, 0.08);
}

.audio-tip {
  position: relative;
  display: inline-flex;
  height: 20px;
  width: 20px;
  align-items: center;
  justify-content: center;
  border-radius: 999px;
  color: #f59e0b;
  outline: none;
}

.audio-tip-popover {
  position: absolute;
  right: 0;
  top: calc(100% + 8px);
  z-index: 30;
  width: min(300px, calc(100vw - 48px));
  max-width: calc(100vw - 48px);
  pointer-events: none;
  border: 1px solid rgba(148, 163, 184, 0.22);
  border-radius: 12px;
  background: rgba(255, 255, 255, 0.96);
  box-shadow: 0 18px 42px rgba(15, 23, 42, 0.16);
  color: rgb(31 41 55);
  font-size: 12px;
  font-weight: 500;
  line-height: 1.55;
  opacity: 0;
  padding: 10px 12px;
  transform: translateY(-4px);
  transition: opacity 160ms ease, transform 160ms ease;
  white-space: normal;
}

.audio-tip:hover .audio-tip-popover,
.audio-tip:focus-visible .audio-tip-popover {
  opacity: 1;
  transform: translateY(0);
}

:global(.dark) .audio-tip {
  color: #fcd34d;
}

:global(.dark) .audio-tip-popover {
  border-color: rgba(255, 255, 255, 0.1);
  background: rgba(31, 31, 31, 0.96);
  box-shadow: 0 18px 42px rgba(0, 0, 0, 0.28);
  color: rgba(255, 255, 255, 0.92);
}
</style>
