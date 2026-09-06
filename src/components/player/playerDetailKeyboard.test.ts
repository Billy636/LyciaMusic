import { describe, expect, it } from 'vitest';

import { resolvePlayerDetailEscapeAction } from './playerDetailKeyboard';

describe('resolvePlayerDetailEscapeAction', () => {
  it('exits immersive mode before closing the player detail page', () => {
    expect(resolvePlayerDetailEscapeAction(true, false)).toBe('exit-immersive');
  });

  it('does not close the player detail page during a fullscreen transition', () => {
    expect(resolvePlayerDetailEscapeAction(false, true)).toBe('exit-immersive');
  });

  it('closes the player detail page after immersive mode has exited', () => {
    expect(resolvePlayerDetailEscapeAction(false, false)).toBe('close-player-detail');
  });
});
