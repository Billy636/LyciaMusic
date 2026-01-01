<script setup lang="ts">
import { ref, onMounted } from 'vue';
import { useSettings } from '../../composables/settings';
import { invoke } from '@tauri-apps/api/core';

const { settings } = useSettings();

// Placeholder states for demonstration
const launchOnStartup = ref(false);
const gpuAcceleration = ref(true);
const autoPlay = ref(true);

interface AudioDevice {
  id: string;
  name: string;
}

const outputDevices = ref<AudioDevice[]>([]);
const currentDeviceId = ref('');
const showDeviceMenu = ref(false);
const triggerButtonRef = ref<HTMLElement | null>(null);
const dropdownStyle = ref({});

const fetchDevices = async () => {
  try {
    const devices = await invoke<AudioDevice[]>('get_output_devices');
    outputDevices.value = devices;
  } catch (e) {
    console.error("Failed to get devices:", e);
  }
};

const selectDevice = async (device: AudioDevice) => {
  try {
    await invoke('set_output_device', { deviceId: device.id });
    currentDeviceId.value = device.id;
    localStorage.setItem('player_output_device', device.id);
    showDeviceMenu.value = false;
  } catch (e) {
    console.error("Failed to set device:", e);
  }
};

const toggleDeviceMenu = () => {
  if (showDeviceMenu.value) {
    showDeviceMenu.value = false;
  } else {
    if (triggerButtonRef.value) {
      const rect = triggerButtonRef.value.getBoundingClientRect();
      // Calculate position: align right edge of dropdown with right edge of button
      // Dropdown width is w-48 (12rem = 192px)
      dropdownStyle.value = {
        top: `${rect.bottom + 8}px`,
        left: `${rect.right - 192}px`,
        position: 'fixed',
        zIndex: 9999
      };
    }
    showDeviceMenu.value = true;
  }
};

onMounted(async () => {
  await fetchDevices();
  const savedId = localStorage.getItem('player_output_device');
  if (savedId) {
    currentDeviceId.value = savedId;
  }
});
</script>

<template>
  <div class="max-w-3xl space-y-8 animate-in fade-in slide-in-from-bottom-2 duration-300">
    
    <!-- Startup & Behavior -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        常规与启动
      </h2>
      <div class="bg-white/50 dark:bg-black/40 backdrop-blur-sm rounded-xl border border-gray-100/50 dark:border-white/5 overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">开机自动运行</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">系统启动时自动打开应用</div>
          </div>
          <button @click="launchOnStartup = !launchOnStartup" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="launchOnStartup ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="launchOnStartup ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">GPU 加速</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">使用显卡硬件加速界面渲染 (需要重启)</div>
          </div>
          <button @click="gpuAcceleration = !gpuAcceleration" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="gpuAcceleration ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="gpuAcceleration ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">最小化到系统托盘</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">点击最小化按钮时隐藏到托盘</div>
          </div>
          <button @click="settings.minimizeToTray = !settings.minimizeToTray" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.minimizeToTray ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.minimizeToTray ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>

        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">关闭主面板时最小化到托盘</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">点击关闭按钮时隐藏到托盘，不退出程序</div>
          </div>
          <button @click="settings.closeToTray = !settings.closeToTray" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="settings.closeToTray ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="settings.closeToTray ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
      </div>
    </section>

    <!-- Playback -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        播放设置
      </h2>
      <div class="bg-white/50 dark:bg-black/40 backdrop-blur-sm rounded-xl border border-gray-100/50 dark:border-white/5 overflow-hidden">
        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">自动播放</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">程序启动后自动恢复上次播放</div>
          </div>
           <button @click="autoPlay = !autoPlay" class="relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none" :class="autoPlay ? 'bg-[#EC4141]' : 'bg-gray-300 dark:bg-gray-700'">
            <span class="inline-block h-4 w-4 transform rounded-full bg-white transition duration-200 ease-in-out shadow-sm" :class="autoPlay ? 'translate-x-6' : 'translate-x-1'" />
          </button>
        </div>
        
        <div class="p-4 flex items-center justify-between border-b border-gray-100/50 dark:border-white/5 last:border-0 hover:bg-white/40 dark:hover:bg-white/5 transition-colors relative">
           <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">输出设备</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
              {{ outputDevices.find(d => d.id === currentDeviceId)?.name || '默认系统设备' }}
            </div>
          </div>
          
          <div class="relative">
            <button 
              ref="triggerButtonRef"
              @click="toggleDeviceMenu"
              class="text-xs px-3 py-1.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded text-gray-600 dark:text-gray-300 hover:text-[#EC4141] hover:border-[#EC4141] transition flex items-center gap-1"
            >
              管理设备
              <svg xmlns="http://www.w3.org/2000/svg" class="h-3 w-3" viewBox="0 0 20 20" fill="currentColor">
                <path fill-rule="evenodd" d="M5.293 7.293a1 1 0 011.414 0L10 10.586l3.293-3.293a1 1 0 111.414 1.414l-4 4a1 1 0 01-1.414 0l-4-4a1 1 0 010-1.414z" clip-rule="evenodd" />
              </svg>
            </button>

            <!-- Dropdown Teleport -->
            <Teleport to="body">
              <div v-if="showDeviceMenu">
                <!-- Overlay -->
                <div class="fixed inset-0 z-[9998]" @click="showDeviceMenu = false"></div>
                
                <!-- Menu -->
                <div 
                  class="fixed w-48 bg-white dark:bg-[#2b2b2b] rounded-xl shadow-xl border border-gray-100 dark:border-white/10 py-1 z-[9999] animate-in fade-in zoom-in-95 duration-100"
                  :style="dropdownStyle"
                >
                  <div v-if="outputDevices.length === 0" class="px-4 py-2 text-xs text-gray-400">未找到设备</div>
                  <button 
                    v-for="device in outputDevices" 
                    :key="device.id"
                    @click="selectDevice(device)"
                    class="w-full text-left px-4 py-2 text-xs hover:bg-gray-50 dark:hover:bg-white/5 transition-colors flex items-center justify-between group"
                    :class="currentDeviceId === device.id ? 'text-[#EC4141] font-medium' : 'text-gray-600 dark:text-gray-300'"
                  >
                    <span class="truncate">{{ device.name }}</span>
                    <span v-if="currentDeviceId === device.id" class="text-[#EC4141]">✓</span>
                  </button>
                </div>
              </div>
            </Teleport>
          </div>
        </div>
      </div>
    </section>

    <!-- Storage -->
    <section class="space-y-3">
      <h2 class="text-sm font-bold text-gray-800 dark:text-gray-200 flex items-center gap-2">
        <span class="w-1 h-4 bg-[#EC4141] rounded-full"></span>
        存储空间
      </h2>
      <div class="bg-white/50 dark:bg-black/40 backdrop-blur-sm rounded-xl border border-gray-100/50 dark:border-white/5 overflow-hidden">
         <div class="p-4 flex items-center justify-between hover:bg-white/40 dark:hover:bg-white/5 transition-colors">
          <div>
            <div class="text-sm font-medium text-gray-800 dark:text-gray-200">清除缓存</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-0.5">释放封面与歌词缓存</div>
          </div>
          <button class="text-xs px-3 py-1.5 bg-white dark:bg-white/5 border border-gray-200 dark:border-white/10 rounded text-gray-600 dark:text-gray-300 hover:text-red-500 hover:border-red-500 transition">立即清除</button>
        </div>
      </div>
    </section>

  </div>
</template>