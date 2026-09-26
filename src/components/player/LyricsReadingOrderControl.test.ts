import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { describe, expect, it, vi } from 'vitest';

import source from './LyricsReadingOrderControl.vue?raw';

function createEscapeHarness(open: boolean) {
  const expanded = { value: open };
  const closeOptions = vi.fn(() => { expanded.value = false; });
  const focus = vi.fn();
  // Exercise the component's actual handler without mounting a browser or
  // duplicating its conditional event-consumption logic in this regression.
  const handler = source.match(/function closeFromKeyboard\(event: KeyboardEvent\) \{[\s\S]*?\n\}/)?.[0];
  if (!handler) throw new Error('Missing reading-order Escape handler');
  const closeFromKeyboard = new Function('expanded', 'closeOptions', 'triggerRef',
    `${handler.replace('event: KeyboardEvent', 'event')}; return closeFromKeyboard;`,
  )(expanded, closeOptions, { value: { focus } }) as (
    event: Pick<KeyboardEvent, 'key' | 'defaultPrevented' | 'preventDefault' | 'stopPropagation'>,
  ) => void;
  return { expanded, closeOptions, focus, closeFromKeyboard };
}

function keyboardEvent(key = 'Escape', defaultPrevented = false) {
  return { key, defaultPrevented, preventDefault: vi.fn(), stopPropagation: vi.fn() };
}

describe('LyricsReadingOrderControl drag-order popover', () => {
  it('puts the default scope first and preserves current-song inheritance and reset controls', () => {
    expect(source.indexOf('@click="setScope(\'default\')"')).toBeLessThan(
      source.indexOf('@click="setScope(\'song\')"'),
    );
    expect(source).toContain('aria-label="读取顺序作用范围"');
    expect(source).toContain(':aria-pressed="scope === \'default\'"');
    expect(source).toContain(':disabled="!hasSong"');
    expect(source).toContain('跟随默认');
    expect(source).toContain(':title="songLabel"');
    expect(source).toContain('reset(path, targetScope)');
    expect(source).not.toContain('两行时：');
  });

  it('teleports the popover beside the drawer with viewport bounds and accessible expansion', () => {
    expect(source).toContain('<Teleport to="body">');
    expect(source).toContain(':style="popupStyle"');
    expect(source).toContain("position: 'fixed'");
    expect(source).toContain("closest('.player-side-panel')");
    expect(source).toContain('const preferredLeft = panel.right;');
    expect(source).toContain('Math.min(280, window.innerWidth - 32)');
    expect(source).toContain('trigger.bottom <= topEdge || trigger.top >= bottomEdge');
    expect(source).toContain(':aria-expanded="expanded"');
    expect(source).toContain(':aria-controls="optionsId"');
    expect(source).toContain('role="region"');
    expect(source).toContain("emit('open')");
  });

  it('shows the three roles as pointer-captured sortable rows instead of six radio choices', () => {
    expect(source).toContain('<ol class="reading-order-sort-list">');
    expect(source).toContain('v-for="(role, index) in displayedRoles"');
    expect(source).toContain(':data-reading-role="role"');
    expect(source).toContain('drag.value?.roles ?? selectedOption.value.roles');
    expect(source).toContain('<GripVertical');
    expect(source).toContain('@pointerdown="startDrag($event, role)"');
    expect(source).toContain('event.button !== 0 || !event.isPrimary');
    expect(source).toContain('optionsRef.value.setPointerCapture(event.pointerId)');
    expect(source).toContain('touch-action: none');
    expect(source).not.toContain('type="radio"');
    expect(source).not.toContain('v-for="option in optionRows"');
  });

  it('persists changed roles with the captured token only after dropping inside the popup', () => {
    const move = source.match(/function moveDrag\(event: PointerEvent\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    const finish = source.match(/function finishDrag\(event: PointerEvent\) \{[\s\S]*?\n\}/)?.[0] ?? '';
    expect(move).toContain('drag.value = { ...active, roles }');
    expect(move).not.toContain('persistRoles');
    expect(finish).toContain('event.pointerId !== active.pointerId');
    expect(finish).toContain('droppedInside && active.roles.some');
    expect(finish.indexOf('cancelDrag();')).toBeLessThan(finish.indexOf('persistRoles(active.roles, active.token)'));
    expect(source).toContain('token: selectionToken.value');
    expect(source).toContain('selectOrder(option.value, token)');
    expect(source).toContain('@pointercancel="cancelDrag"');
    expect(source).toContain('@lostpointercapture="cancelDrag"');
    expect(source).toContain("watch(selectedOrder, cancelDrag, { flush: 'sync' })");
    expect(source).toContain('optionsRef.value.releasePointerCapture(active.pointerId)');
  });

  it('supports keyboard reordering and keeps focus on the moved role', () => {
    expect(source).toContain("querySelector<HTMLButtonElement>('.reading-order-drag-item')?.focus({ preventScroll: true })");
    expect(source).toContain('@keydown.down.prevent="expandOptions"');
    expect(source).toContain('aria-keyshortcuts="ArrowUp ArrowDown"');
    expect(source).toContain('@keydown.up.prevent="moveRole(role, -1)"');
    expect(source).toContain('@keydown.down.prevent="moveRole(role, 1)"');
    expect(source).toContain('persistRoles(roles, token)');
    expect(source).toContain('`[data-reading-role="${role}"] button`');
    expect(source).toContain('token === selectionToken.value');
    expect(source).toContain('aria-live="polite">{{ announcement }}');
  });

  it('handles outside mouse and keyboard clicks and cleans up all popup listeners', () => {
    expect(source).toContain('controlRef.value?.contains(target) || optionsRef.value?.contains(target)');
    expect(source).toContain("window.addEventListener('mousedown', handleOutsidePointer, true)");
    expect(source).toContain("window.addEventListener('click', handleOutsidePointer, true)");
    expect(source).toContain("window.addEventListener('scroll', updatePopupPosition, true)");
    expect(source).toContain("window.addEventListener('blur', cancelDrag)");
    expect(source).toContain("document.addEventListener('keydown', closeFromKeyboard, true)");
    expect(source).toContain('onBeforeUnmount(() => {\n  cancelDrag();\n  closeOptions();');
    expect(source).toContain("window.removeEventListener('mousedown', handleOutsidePointer, true)");
    expect(source).toContain("window.removeEventListener('click', handleOutsidePointer, true)");
    expect(source).toContain("window.removeEventListener('resize', updatePopupPosition)");
    expect(source).toContain("window.removeEventListener('scroll', updatePopupPosition, true)");
    expect(source).toContain("window.removeEventListener('blur', cancelDrag)");
    expect(source).toContain("document.removeEventListener('keydown', closeFromKeyboard, true)");
    expect(source).toContain('@keydown.esc="closeFromKeyboard"');
    expect(source).not.toContain('@keydown.esc.stop.prevent="closeFromKeyboard"');
    expect(source).toContain('data-shortcut-capture="true"');
  });

  it('does not consume Escape on the collapsed trigger so the drawer can close', () => {
    const control = createEscapeHarness(false);
    const event = keyboardEvent();
    control.closeFromKeyboard(event);
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
    expect(control.closeOptions).not.toHaveBeenCalled();
    expect(control.focus).not.toHaveBeenCalled();
  });

  it('consumes the first Escape while expanded, restores focus, then lets the next Escape bubble', () => {
    const control = createEscapeHarness(true);
    const first = keyboardEvent();
    control.closeFromKeyboard(first);
    expect(first.preventDefault).toHaveBeenCalledOnce();
    expect(first.stopPropagation).toHaveBeenCalledOnce();
    expect(control.expanded.value).toBe(false);
    expect(control.closeOptions).toHaveBeenCalledOnce();
    expect(control.focus).toHaveBeenCalledOnce();

    const second = keyboardEvent();
    control.closeFromKeyboard(second);
    expect(second.preventDefault).not.toHaveBeenCalled();
    expect(second.stopPropagation).not.toHaveBeenCalled();
    expect(control.closeOptions).toHaveBeenCalledOnce();
    expect(control.focus).toHaveBeenCalledOnce();
  });

  it.each([
    { key: 'ArrowDown', defaultPrevented: false },
    { key: 'Escape', defaultPrevented: true },
  ])('leaves $key with defaultPrevented=$defaultPrevented for its owning control', ({ key, defaultPrevented }) => {
    const control = createEscapeHarness(true);
    const event = keyboardEvent(key, defaultPrevented);
    control.closeFromKeyboard(event);
    expect(control.expanded.value).toBe(true);
    expect(control.closeOptions).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(event.stopPropagation).not.toHaveBeenCalled();
  });

  it('compiles the script and template with the shared settings contract', () => {
    const { descriptor } = parse(source);
    expect(() => compileScript(descriptor, { id: 'reading-order-control' })).not.toThrow();
    const result = compileTemplate({
      source: descriptor.template!.content,
      filename: 'LyricsReadingOrderControl.vue',
      id: 'reading-order-control',
    });
    expect(result.errors).toEqual([]);
  });
});
