🎨 UI 样式调整：左上角标题改为品牌蓝 (UI Tweak: Brand Color for App Title)
目标 (Goal) 修改左上角侧边栏顶部的 "LyciaMusic" 标题颜色。 目前的红橙色 (text-red-500 等) 与品牌主色调（Logo 的蓝绿色）冲突。请将其改为与 Logo 呼应的蓝色/青色渐变。

修改文件 (Target File) src/components/layout/Sidebar.vue (或者是 Header 组件，取决于布局)。

代码修改 (Code Change) 请找到包含 LyciaMusic 文字的 <h1> 或 <span> 标签，替换其颜色类名。

推荐方案：清爽的海洋蓝渐变 (Ocean Gradient) 请使用以下 Tailwind CSS 类组合来实现“文字渐变”效果：

HTML

<h1 class="text-2xl font-bold bg-gradient-to-r from-teal-400 to-blue-500 bg-clip-text text-transparent tracking-tight">
  LyciaMusic
</h1>
备选方案 (如果是纯色): 如果渐变不好看，请使用 text-teal-500 或 text-cyan-600。

Important notes:
it is Tauri v2.0 project,please remember it !

While making these changes, please ensure that none of the existing features stop working.

Do not make any single file excessively long. Use a refactoring-oriented approach so that the codebase remains clean, modular, and easy to manage and read.