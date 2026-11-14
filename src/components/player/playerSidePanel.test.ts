import postcss, { type Rule } from 'postcss';
// @ts-expect-error Vitest runs in Node, but this repo does not ship @types/node.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const styles = readFileSync(new URL('./playerSidePanel.css', import.meta.url), 'utf8');

function declarations(selector: string): Record<string, string> {
  const ast = postcss.parse(styles);
  let target: Rule | undefined;
  ast.walkRules((rule) => { if (rule.selector === selector) target = rule; });
  const values: Record<string, string> = {};
  target?.walkDecls((decl) => { values[decl.prop] = decl.value; });
  return values;
}

describe('shared player side-panel skin', () => {
  it('uses the same viewport geometry and glass surface without covering the player controls', () => {
    expect(declarations('.player-side-panel')).toMatchObject({
      position: 'fixed', top: '84px', bottom: '96px', width: '320px',
      'max-width': 'calc(100vw - 24px)', 'min-height': '0',
      'z-index': '100', overflow: 'hidden',
      background: 'rgba(0, 0, 0, 0.3)', border: '1px solid rgba(255, 255, 255, 0.1)',
      'backdrop-filter': 'blur(24px)',
    });
  });

  it('mirrors only the inner rounded edge and the entry direction', () => {
    expect(declarations('.player-side-panel--left')).toMatchObject({
      left: '0', 'border-left': '0', 'border-radius': '0 24px 24px 0',
      '--player-side-panel-enter-x': '-100%',
    });
    expect(declarations('.player-side-panel--right')).toMatchObject({
      right: '0', 'border-right': '0', 'border-radius': '24px 0 0 24px',
      '--player-side-panel-enter-x': '100%',
    });
    expect(declarations('.player-side-panel-enter-from,\n.player-side-panel-leave-to')).toMatchObject({
      transform: 'translate3d(var(--player-side-panel-enter-x), 0, 0)', opacity: '0',
    });
  });

  it('keeps the header fixed in the flex layout while the controls or queue scroll inside', () => {
    expect(declarations('.player-side-panel__header')['flex-shrink']).toBe('0');
    expect(declarations('.player-side-panel__scroll')).toMatchObject({
      'min-height': '0', flex: '1', 'overflow-y': 'auto', 'overscroll-behavior': 'contain',
    });
  });

  it('respects reduced motion and gives non-player pages a readable backdrop', () => {
    expect(styles).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*transition: none/);
    expect(declarations('.player-side-panel--solid-backdrop').background).toBe('rgba(24, 24, 27, 0.85)');
  });
});
