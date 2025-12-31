1. 问题描述 (Issue Description) 在最近对底部播放栏 (PlayerFooter) 进行 UI 重构（透明化/去背景）后，发现**“播放列表 (Play Queue)”**功能失效了。

现象: 点击底部栏最右侧的“列表图标”按钮，界面没有任何反应。

预期: 点击该按钮应从右侧滑出“当前播放列表”的侧边栏。

2. 关键线索 (Key Context) 该功能之前的组件名称应该包含 playQueue。 怀疑是在重写 PlayerFooter.vue 的样式结构时：

按钮的 @click 绑定事件被意外移除了。

或者控制侧边栏显示的变量（例如 showPlayQueue / isQueueVisible）没有正确连接。

或者 PlayQueue.vue 组件本身被从父组件中注释掉了。

3. 修复要求 (Request) 请检查代码历史，找回 playQueue 的相关逻辑，并重新绑定到右下角的列表按钮上，确保点击能正常唤出播放列表。


Important notes:
While making these changes, please ensure that none of the existing features stop working.

Do not make any single file excessively long. Use a refactoring-oriented approach so that the codebase remains clean, modular, and easy to manage and read.