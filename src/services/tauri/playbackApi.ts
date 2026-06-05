import { tauriInvoke } from './invoke';
import type {
  AudioDevice,
  AudioOutputStatus,
  PlayAudioOptions,
  SeekAudioOptions,
  UpdateLoudnessSettingsOptions,
  UpdatePlaybackMetadataOptions,
  LoudnessRecord,
} from './contracts';
import { useConcurrentScheduler } from '../../composables/useConcurrentScheduler';

// 导出集中化高精度签名生成函数
export function createEqualizerSignature(enabled: boolean, preamp: number, gains: number[]): string {
  const gainsStr = gains.map(g => g.toFixed(1)).join(',');
  return `${enabled}:${preamp.toFixed(1)}:[${gainsStr}]`;
}

// 模块级单例调度器与缓存
const eqScheduler = useConcurrentScheduler();
let lastSyncedParams: string | null = null;

// 全局单例节流管理变量
let throttleTimer: any = null;
let nextRequestArgs: { enabled: boolean, preamp: number, gains: number[] } | null = null;
let lastThrottleTime = 0;

export const playbackApi = {
  setVolume: (volume: number): Promise<void> => tauriInvoke('set_volume', { volume }),
  getPlaybackProgress: (): Promise<number> => tauriInvoke('get_playback_progress'),
  getAudioVisualizerSamples: (): Promise<number[]> =>
    tauriInvoke('get_audio_visualizer_samples'),
  recordPlay: (payload: {
    songPath: string;
    listenedMs: number;
    durationMs: number;
    title: string;
    artist: string;
    album: string;
    trackNumber?: string;
  }) =>
    tauriInvoke('record_play', { payload }),
  playAudio: (options: PlayAudioOptions): Promise<void> => tauriInvoke('play_audio', options),
  updatePlaybackMetadata: (options: UpdatePlaybackMetadataOptions): Promise<void> =>
    tauriInvoke('update_playback_metadata', options),
  pauseAudio: (): Promise<void> => tauriInvoke('pause_audio'),
  stopAudio: (): Promise<void> => tauriInvoke('stop_audio'),
  resumeAudio: (): Promise<void> => tauriInvoke('resume_audio'),
  seekAudio: (options: SeekAudioOptions): Promise<void> => tauriInvoke('seek_audio', options),
  setAudioOutputMode: (outputMode: PlayAudioOptions['outputMode']): Promise<void> =>
    tauriInvoke('set_audio_output_mode', { outputMode }),
  setOutputDevice: (deviceId: string | null) =>
    tauriInvoke('set_output_device', { deviceId }),
  getOutputDevices: (): Promise<AudioDevice[]> => tauriInvoke('get_output_devices'),
  getCurrentOutputDevice: (): Promise<AudioOutputStatus> =>
    tauriInvoke('get_current_output_device'),
  getTrackLoudnessInfo: (songId: number): Promise<LoudnessRecord | null> =>
    tauriInvoke('get_track_loudness_info', { songId }),
  updateLoudnessSettings: (options: UpdateLoudnessSettingsOptions): Promise<void> =>
    tauriInvoke('update_loudness_settings', options),

  // 获取最后一次成功同步给底层的签名参数
  getLastSyncedParams: () => lastSyncedParams,

  // 原有 setEqualizerSettings 签名保持 100% 兼容。在内部使用通用并发调度器保护，且成功后更新签名。
  setEqualizerSettings: (enabled: boolean, preamp: number, gains: number[]): Promise<void> => {
    return eqScheduler.execute(() => {
      return tauriInvoke('set_equalizer_settings', { enabled, preamp, gains })
        .then(() => {
          lastSyncedParams = createEqualizerSignature(enabled, preamp, gains);
          if (import.meta.env.DEV) {
            console.log(`[PlaybackApi] set_equalizer_settings success. Updated signature: ${lastSyncedParams}`);
          }
        });
    });
  },

  // 拖拽中 50ms 全局节流请求底层同步，内部使用已受并发保护的 setEqualizerSettings
  requestEqualizerSettings: (enabled: boolean, preamp: number, gains: number[]) => {
    const now = Date.now();
    nextRequestArgs = { enabled, preamp, gains };

    const executeRequest = () => {
      if (!nextRequestArgs) return;
      const { enabled, preamp, gains } = nextRequestArgs;
      nextRequestArgs = null;
      lastThrottleTime = Date.now();
      
      if (import.meta.env.DEV) {
        console.log(`[PlaybackApi] Throttled direct EQ sync executed. Preamp: ${preamp.toFixed(1)}`);
      }
      playbackApi.setEqualizerSettings(enabled, preamp, gains);
    };

    if (now - lastThrottleTime >= 50) {
      if (throttleTimer) {
        clearTimeout(throttleTimer);
        throttleTimer = null;
      }
      executeRequest();
    } else {
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          throttleTimer = null;
          executeRequest();
        }, 50 - (now - lastThrottleTime));
      }
    }
  },

  // 松手/停止后强制最终同步，返回 Promise<void>，确保顺序并发互斥
  flushEqualizerSettings: (enabled: boolean, preamp: number, gains: number[]): Promise<void> => {
    if (throttleTimer) {
      clearTimeout(throttleTimer);
      throttleTimer = null;
    }
    nextRequestArgs = null;
    
    if (import.meta.env.DEV) {
      console.log(`[PlaybackApi] Flush final EQ sync requested. Preamp: ${preamp.toFixed(1)}`);
    }
    
    return playbackApi.setEqualizerSettings(enabled, preamp, gains);
  }
};
