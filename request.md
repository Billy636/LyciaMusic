需求单：优化音质标签样式与自定义悬浮提示
标题：UI 优化 - 缩小音质标签并替换原生 Tooltip

1. 问题现状 (Current Issues)

标签尺寸过大： 目前的音质标签（SQ/Hi-Res）在列表中显得有点“重”，稍微抢了歌名的视觉重心，需要改得更精致小巧一点。

悬浮提示简陋： 鼠标悬停时使用的是浏览器原生的 title 属性，样式是系统默认的白框，与我们需要的高级感/毛玻璃 UI 格格不入。

2. 优化方案 (Solution):

样式调整： 将字号调整为 9px，减小了内边距和高度，使其看起来更像一个精致的“角标”。

交互升级： 移除了原生的 title 属性，手写一个 Vue Transition 过渡的悬浮气泡 (Custom Tooltip)。

支持毛玻璃背景 (backdrop-blur)。

支持显示详细参数（如 24bit · 96kHz · FLAC）。

带淡入淡出动画。


Important notes:
it is Tauri v2.0 project,please remember it !

While making these changes, please ensure that none of the existing features stop working.

Do not make any single file excessively long. Use a refactoring-oriented approach so that the codebase remains clean, modular, and easy to manage and read.