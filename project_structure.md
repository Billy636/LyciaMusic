# 项目结构与功能说明文档 (Project Structure & File Descriptions)

> 生成时间: 2026-01-03
> 适用版本: LyciaMusic v1.1.0 (Tauri v2.0)

## 目录结构树 (Directory Tree)

```plaintext
LyciaMusic/
├── package.json               # 前端项目配置 (依赖管理、启动脚本)
├── src-tauri/                 # Rust 后端核心目录 (Tauri Core)
│   ├── tauri.conf.json        # Tauri 核心配置 (窗口权限、插件、版本号)
│   ├── capabilities/          # Tauri v2 权限配置文件目录
│   └── src/                   # Rust 源码目录
│       ├── main.rs            # 程序入口 (且负责主线程通过)
│       ├── lib.rs             # [核心] 插件注册、系统托盘 (Tray)、菜单初始化
│       ├── music.rs           # [系统能力] 本地文件扫描、封面提取、文件读写操作
│       ├── player.rs          # [系统能力] 音频播放引擎 (Rodio)、系统媒体指引
│       ├── database.rs        # [数据持久化] 数据库连接与配置存储
│       ├── toolbox.rs         # [新功能] 批量重命名工具逻辑、正则匹配预处理
│       └── error.rs           # 统一错误类型定义
├── src/                       # Vue 3 前端源码目录
│   ├── main.ts                # Vue 入口 (应用挂载、全局指令)
│   ├── App.vue                # 根组件 (全局主题、背景容器)
│   ├── style.css              # 全局样式 (Tailwind 引入、字体定义)
│   ├── assets/                # 静态资源 (默认封面、图标)
│   ├── router/                # 路由配置 (页面跳转规则)
│   ├── views/                 # 页面级视图
│   │   ├── Home.vue           # 首页/库视图
│   │   └── Settings.vue       # 设置页面
│   ├── composables/           # [状态管理 & 逻辑复用]
│   │   ├── player.ts          # [核心逻辑] 播放控制器 (上一首/下一首、播放模式)
│   │   ├── playerState.ts     # [数据状态] 全局响应式数据 (当前歌曲、播放队列、UI颜色)
│   │   └── toast.ts           # 全局消息通知控制器
│   └── components/            # UI 组件库
│       ├── layout/            # 布局组件
│       │   ├── Sidebar.vue            # 左侧侧边栏 (导航菜单)
│       │   ├── PlayerFooter.vue       # 底部播放条 (进度条、控制按钮)
│       │   ├── TitleBar.vue           # 自定义窗口标题栏 (最小化/关闭)
│       │   └── GlobalBackground.vue   # 全局动态背景 (流光/模糊效果)
│       ├── common/            # 通用基础组件
│       │   ├── ModernModal.vue        # [核心UI] 通用弹窗容器
│       │   ├── DragGhost.vue          # [交互优化] 拖拽排序时的跟随残影组件
│       │   └── Toast.vue              # 消息浮窗组件
│       ├── song-list/         # 歌曲列表相关
│       │   ├── SongTable.vue          # [核心功能] 歌曲表格 (负责拖拽排序、多选逻辑)
│       │   ├── SongListHeader.vue     # 列表表头 (负责排序触发)
│       │   └── SongListSidebar.vue    # 列表侧边索引 (A-Z跳转)
│       ├── overlays/          # 浮层与右键菜单
│       │   ├── ContextMenu.vue        # 右键菜单组件
│       │   └── AddToPlaylistModal.vue # 添加到歌单弹窗
│       └── settings/          # 设置页专用组件
│           └── RenamePreviewModal.vue # [新功能] 批量重命名预览弹窗
└── dist/                      # 构建产物 (忽略)
```

## 功能模块详解 (Detailed Capabilities)

### 1. 核心逻辑 (Core Logic)
*   **拖拽排序 (Drag & Sort)**:
    *   **Frontend**: `src/components/song-list/SongTable.vue` 负责监听拖拽事件，计算放置位置。
    *   **Visual**: `src/components/common/DragGhost.vue` 提供拖拽时的视觉反馈（半透明截图跟随）。
    *   **State**: 排序后的列表顺序直接更新到 `src/composables/playerState.ts` 中的 `playlist` 状态。

*   **弹窗系统 (Modal System)**:
    *   **Base**: `src/components/common/ModernModal.vue` 是所有弹窗的基类，提供遮罩动画和居中布局。
    *   **Usage**: 如 `RenamePreviewModal.vue` (重命名) 或 `AddToPlaylistModal.vue` (收藏) 都复用了此基类。

*   **数据状态管理 (State Management)**:
    *   **Store**: `src/composables/playerState.ts` 是全局单一数据源。
    *   **Reactivity**: 利用 Vue 3 `reactive` 实现。包含：
        *   `currentTrack`: 当前播放歌曲信息。
        *   `playlist`: 当前播放队列。
        *   `themeColor`: 动态提取的封面主色调。

### 2. 后端能力 (Rust Backend)
*   **文件扫描 (music.rs)**: 递归扫描用户目录，读取 ID3/Flac metadata。
*   **工具箱 (toolbox.rs)**: **v1.1.0 新增**。提供高性能的文件名预览与重命名操作，支持正则替换和 Tag 信息读取。
*   **音频引擎 (player.rs)**: 封装 Rodio 库，管理音频设备输出流，确保后台播放稳定。

---
**Note to Developers**: 修改代码时，请保持 "Frontend (UI/Interaction) -> Composables (State/Logic) -> Backend (System/IO)" 的单向数据流清晰。
