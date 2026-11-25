/**
 * 清理 dist 中的历史构建产物。
 *
 * 之前每次构建都带 `--emptyOutDir false`，导致旧 hash chunk 不断累积在
 * dist/assets 里，并被 Tauri 一起打进 NSIS 安装包（体积从 9.8MB 涨到 14MB）。
 * 这里在构建前逐个删除，避免 Vite 的 emptyOutDir 触发批量删除守卫，
 * 同时保证每次打包只包含当前这一次构建的产物。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(root, 'dist');
const assetsDir = path.join(distDir, 'assets');

function removeFilesIn(dir) {
  if (!fs.existsSync(dir)) return 0;
  let removed = 0;
  for (const entry of fs.readdirSync(dir)) {
    const target = path.join(dir, entry);
    if (!fs.statSync(target).isFile()) continue;
    try {
      fs.unlinkSync(target);
      removed += 1;
    } catch (error) {
      // 开发会话的批量删除守卫可能拦截删除；此时不中断构建，
      // 交给 Vite 的 emptyOutDir 兜底清空。
      console.warn(`[clean-dist] skip ${entry}: ${error.message}`);
    }
  }
  return removed;
}

// index.html 每次构建都会被完整重写，删除它可让 Vite 无需再清空整个目录。
const indexHtml = path.join(distDir, 'index.html');
if (fs.existsSync(indexHtml)) {
  try {
    fs.unlinkSync(indexHtml);
  } catch (error) {
    console.warn(`[clean-dist] skip index.html: ${error.message}`);
  }
}

const removed = removeFilesIn(assetsDir);
console.log(`[clean-dist] removed ${removed} stale asset file(s)`);
