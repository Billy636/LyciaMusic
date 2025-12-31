这是一个非常好的习惯！特别是在我们刚刚进行了大量功能修改（流光背景、托盘图标、UI 重构）之后，整理一份项目结构文档对于以后的维护至关重要。

你可以让程序员生成一份 Markdown 格式的树状目录，并给关键文件加上一句话注释。

请直接把下面这段指令发给他，清晰又专业：

需求：生成项目结构与功能说明文档
背景 (Context): 我们在近期完成了大量的重构和新功能开发（包括自定义背景、流光算法、托盘逻辑、UI 透明化等）。 为了方便后续维护和理解代码全貌，我需要一份最新的、详细的项目结构文档。

要求 (Requirements): 请扫描当前的项目目录，生成一份 Markdown 格式的文档，包含以下内容：

目录树 (Directory Tree): 展示项目的主要文件夹和文件结构。

功能注解 (Annotations): 在每个关键文件/文件夹旁边，用简练的语言说明它的核心职责。

请重点区分 前端 (Vue/src) 和 后端 (Rust/src-tauri) 的逻辑。

特别需要标注出最近修改的核心组件（如 GlobalBackground.vue, PlayerFooter.vue, colorExtraction.ts 等）。

核心模块说明: 单独列出核心功能模块（如“播放器核心”、“背景渲染系统”、“窗口控制”）涉及了哪些文件。

输出格式示例 (Format Example):

Plaintext

- src/
  - components/
    - GlobalBackground.vue  # [核心] 负责渲染流光/静态/自定义背景，包含颜色提取后的视觉呈现逻辑
  - composables/
    - colorExtraction.ts    # [核心] 负责从封面提取主色，并进行 HSL 清洗和参数优化
...
请基于当前最新的代码状态生成此文档。


Important notes:
it is Tauri v2.0,please remember it !

While making these changes, please ensure that none of the existing features stop working.

Do not make any single file excessively long. Use a refactoring-oriented approach so that the codebase remains clean, modular, and easy to manage and read.