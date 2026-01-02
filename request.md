📝 发给程序员的需求单
标题：UI 优化 - 替换原生弹窗为自定义组件 (Replace Native Dialogs with Custom UI)

1. 痛点描述 (The Problem) 目前的弹窗使用了系统原生的 alert() / Tauri Dialog 和浏览器的 window.prompt()。

视觉割裂： 风格与我们的 LyciaMusic UI 不统一。

体验极差： window.prompt 会显示 localhost:1420，暴露了 Webview 地址，显得不专业。

2. 需求一：实现全局“轻提示” (Toast Notification)

场景： 用于替代 中的“已添加 18 个文件夹”这种成功提示。

要求：

不要使用系统弹窗，也不要阻断用户操作。

样式： 做一个小巧的悬浮胶囊，出现在顶部中央或底部中央。

动效： 淡入淡出 (Fade In/Out)，显示 2-3 秒后自动消失。

配色： 绿色（成功）、红色（错误）、蓝色（信息），带一点透明度和背景模糊。

3. 需求二：实现自定义“模态输入框” (Custom Input Modal)

场景： 用于替代 中的“修改歌单名称”。

要求：

遮罩层 (Backdrop)： 全屏黑色半透明遮罩，带模糊效果 (Backdrop Blur)，让背景变暗，聚焦用户视线。

居中卡片： 屏幕正中间显示一个圆角卡片（风格参考软件其他部分）。

内容： * 标题：“重命名歌单”

输入框：美化的 Input，默认填入旧名字。

按钮组：右下角放置“取消”（灰色）和“确认”（主色调/红色）。

交互： 支持按 Enter 键确认，按 Esc 键取消。

4. 技术建议 (Tech Stack)

既然我们用的是 Vue + Tailwind CSS，建议封装两个通用组件：

<Toast /> (或者引入 vue-sonner 这种轻量库)。

<BaseModal /> (使用 Vue 的 <Teleport to="body"> 传送门技术，确保层级最高)。

Important notes:
it is Tauri v2.0 project,please remember it !

While making these changes, please ensure that none of the existing features stop working.

Do not make any single file excessively long. Use a refactoring-oriented approach so that the codebase remains clean, modular, and easy to manage and read.