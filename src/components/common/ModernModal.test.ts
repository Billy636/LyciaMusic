import { describe, expect, it } from 'vitest';
import source from './ModernModal.vue?raw';

describe('ModernModal interaction safeguards', () => {
  it('defaults focus to cancel and restores the connected trigger on dismissal', () => {
    expect(source).toContain('cancelButton.value?.focus()');
    expect(source).toContain('ref="cancelButton"');
    expect(source).toContain('returnFocus?.isConnected');
    expect(source).toContain('returnFocus.focus()');
  });

  it('provides labelled modal semantics and bounds long preset names', () => {
    expect(source).toContain('role="alertdialog"');
    expect(source).toContain('aria-modal="true"');
    expect(source).toContain(':aria-labelledby="titleId"');
    expect(source).toContain(':aria-describedby="contentId"');
    expect(source).toContain('break-words max-h-[40vh] overflow-y-auto');
  });

  it('guards repeated actions and clears delayed actions on teardown', () => {
    expect(source).toContain('if (!props.visible || isClosing.value) return');
    expect(source).toContain("const handleClose = () => finish('cancel')");
    expect(source).toContain("const handleConfirm = () => finish('confirm')");
    expect(source).not.toContain('pointer-events-none');
    const teardown = source.slice(source.indexOf('onUnmounted(() =>'));
    expect(teardown).toContain('clearTimeout(closeTimer)');
  });

  it('handles Escape and traps Tab without forwarding playback shortcuts', () => {
    expect(source).toContain("window.addEventListener('keydown', handleKeydown, true)");
    expect(source).toContain("e.key === 'Escape'");
    expect(source).toContain("e.key === 'Tab'");
    expect(source).toContain('e.shiftKey');
    expect(source).toContain('e.stopPropagation()');
    expect(source).toContain('first?.focus()');
    expect(source).toContain('last?.focus()');
  });
});
