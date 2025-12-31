体验优化：禁用全局默认右键菜单 (Disable Default Context Menu)
1. 问题描述 (Issue) 如图所示，在软件的空白处点击鼠标右键，会弹出浏览器默认的菜单（返回、刷新、打印、检查等）。 这破坏了桌面应用的沉浸感，让它看起来像是一个网页。

2. 需求 (Requirement) 请禁用整个应用的默认右键点击行为。

全局禁止： 当用户在软件的任何非特定区域点击右键时，不应有任何反应。

保留特例： 如果未来有特定的列表项需要右键菜单（比如“歌曲右键”），请使用自定义菜单组件，而不是浏览器的原生菜单。

3. 代码建议 (Dev Note) 在 Vue 的根组件 (App.vue) 或入口文件 (main.ts) 中，监听并阻止 contextmenu 事件即可。

方案 A (Vue Template):

HTML

<div id="app" @contextmenu.prevent>
  </div>
方案 B (Global Listener):

JavaScript

// main.ts
document.addEventListener('contextmenu', (event) => {
  // 生产环境禁用，开发环境可选保留以方便调试
  if (import.meta.env.PROD) {
    event.preventDefault();
  }
});
(建议在 Release/生产包中彻底禁用，开发模式下如果为了调试方便可以保留，或者仅通过 F12 唤出调试台)


Important notes:
it is Tauri v2.0,please remember it !

While making these changes, please ensure that none of the existing features stop working.

Do not make any single file excessively long. Use a refactoring-oriented approach so that the codebase remains clean, modular, and easy to manage and read.