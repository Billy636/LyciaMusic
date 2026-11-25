import type { Song } from '../../types';

export type SongSwitchDirection = 'next' | 'previous';

interface UpcomingSongPeek {
  next: () => Song | null;
  previous: () => Song | null;
  nextPath: () => string | undefined;
  previousPath: () => string | undefined;
}

let provider: UpcomingSongPeek | null = null;

/**
 * 由播放队列注册真实的「上一首 / 下一首」预览函数。
 * 提示窗是独立 webview，桥接层不能再自己猜队列顺序或随机结果。
 */
export function registerUpcomingSongPeek(peek: UpcomingSongPeek) {
  provider = peek;
}

export function peekUpcomingSong(direction: SongSwitchDirection): Song | null {
  if (!provider) return null;
  return direction === 'next' ? provider.next() : provider.previous();
}

export function peekUpcomingSongPath(direction: SongSwitchDirection): string | undefined {
  if (!provider) return undefined;
  return direction === 'next' ? provider.nextPath() : provider.previousPath();
}
