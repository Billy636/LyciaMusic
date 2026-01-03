import { ref, watch } from 'vue';

const SETTINGS_KEY = 'app_settings';

interface AppSettings {
  minimizeToTray: boolean;
  closeToTray: boolean;
  showQualityBadges: boolean; // v1.1.1: Audio quality badges
  // Add other settings here in the future
}

const defaultSettings: AppSettings = {
  minimizeToTray: false,
  closeToTray: false,
  showQualityBadges: true,
};

const settings = ref<AppSettings>({ ...defaultSettings });

// Load from localStorage
const stored = localStorage.getItem(SETTINGS_KEY);
if (stored) {
  try {
    settings.value = { ...defaultSettings, ...JSON.parse(stored) };
  } catch (e) {
    console.error('Failed to parse settings', e);
  }
}

// Watch for changes and save
watch(
  settings,
  (newSettings) => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(newSettings));
  },
  { deep: true }
);

export function useSettings() {
  return {
    settings,
  };
}
