import { compileTemplate, parse } from '@vue/compiler-sfc';
import { describe, expect, it } from 'vitest';
import * as Vue from 'vue';
import type { VNode } from 'vue';

import brandSource from './AppBrand.vue?raw';
import sidebarSource from './SidebarBrand.vue?raw';

const compile = (source: string, filename: string) => {
  const { descriptor } = parse(source);
  return compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: filename,
    compilerOptions: { mode: 'function' },
  });
};

const brand = compile(brandSource, 'AppBrand.vue');
const sidebar = compile(sidebarSource, 'SidebarBrand.vue');
const render = (compiled: ReturnType<typeof compile>) =>
  (new Function('Vue', compiled.code)({
    ...Vue,
    resolveComponent: (name: string) => name,
  }) as (context: Record<string, unknown>, cache: unknown[]) => VNode)({}, []);

describe('AppBrand', () => {
  it('compiles both the shared brand and its sidebar wrapper', () => {
    expect(brand.errors).toEqual([]);
    expect(sidebar.errors).toEqual([]);
  });

  it('uses the actual app icon beside the complete Lycia Player wordmark', () => {
    const root = render(brand);
    const [icon, name] = root.children as VNode[];

    expect(icon?.type).toBe('img');
    expect(icon?.props?.src).toBe('/app.png');
    expect(icon?.props?.alt).toBe('');
    expect(icon?.props?.draggable).toBe('false');
    expect(name?.type).toBe('span');
    expect(String(name?.children).trim()).toBe('Lycia Player');
    expect(brandSource).not.toContain('app_logo_');
  });

  it('keeps the brand compact and aligned without intercepting title bar dragging', () => {
    const root = render(brand);
    const [icon, name] = root.children as VNode[];

    expect(root.props?.class.split(' ')).toEqual(expect.arrayContaining([
      'flex', 'min-w-0', 'items-center', 'gap-2', 'select-none', 'pointer-events-none',
    ]));
    expect(icon?.props?.class.split(' ')).toEqual(expect.arrayContaining(['h-[24px]', 'w-[24px]', 'shrink-0', 'object-contain']));
    expect(name?.props?.class.split(' ')).toEqual(expect.arrayContaining([
      'brand-wordmark', 'whitespace-nowrap', 'text-[15px]', 'font-medium', 'leading-5', 'text-gray-700', 'dark:text-gray-200',
    ]));
    expect(brandSource).not.toMatch(/-translate-|-[mt]l-/);
  });

  it('reuses the shared brand while preserving the existing sidebar drag region and spacing', () => {
    const root = render(sidebar);
    const children = root.children as VNode[];

    expect(root.props).toHaveProperty('data-tauri-drag-region');
    expect(root.props?.class.split(' ')).toEqual(expect.arrayContaining(['h-16', 'px-6', 'mb-2']));
    expect(children.filter(node => node.type === 'AppBrand')).toHaveLength(1);
    expect(sidebarSource).toContain("import AppBrand from './AppBrand.vue'");
    expect(sidebarSource).not.toContain('<img');
    expect(sidebarSource).not.toContain('ycia Player');
  });
});
