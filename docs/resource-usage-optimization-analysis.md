# Lycia Player 内存与 CPU 占用优化分析报告

> 分析日期：2026-07-10
> 对应版本：`1.3.9`
> 分析范围：当前本地仓库的 Vue 3 / Tauri 2 / Rust / SQLite / Rodio 架构与现有 `dist` 产物
> 目标：在不降低音质、歌词与动画观感、列表滚动流畅度、窗口响应速度和数据正确性的前提下，降低常驻内存、空闲 CPU 和高负载场景的峰值占用。

## 1. 结论摘要

当前项目已经具备不少正确的性能基础：路由懒加载、歌曲表格虚拟化、按窗口分页加载歌曲、封面 LRU/TTL、后台封面预加载限流、主窗口隐藏时低功耗、AMLL 销毁清理、SQLite WAL，以及扫描进度节流。后续优化应保留这些机制，不建议以关闭核心视觉效果、缩小音频缓冲或降低音频处理质量作为第一手段。

综合代码路径，优先级最高的四项是：

1. **拆分主窗口与辅助窗口前端入口。** 当前所有窗口都从同一入口启动，并静态导入主壳、迷你播放器、托盘菜单、桌面歌词和任务栏播控；主入口还无条件安装路由。迷你播放器与托盘菜单又会在启动后自动预热。每个 WebView 都因此承担一部分完整应用的模块解析、Pinia 状态、监听器和样式成本。这是最可能带来大幅常驻内存下降的架构级优化。
2. **把路径缓存从“条目数限制”改成“权重/字节预算限制”。** 一个缓存条目可能包含数万条路径，但通用 `MemoryCache` 只限制条目数量。全部歌曲视图可保留 8 个大数组，文件夹、详情和收藏/最近缓存各可保留 96 项；缓存数量有界，但内存体积没有真正有界。
3. **关闭频谱不可见时的采样成本，并削减频谱渲染中的重复工作。** 播放详情可见时，前端约每秒 30 次 IPC，每次后端复制 2048 个样本并执行 FFT；Canvas 动画实际可能以屏幕刷新率重绘 112 个柱并逐柱创建渐变。更重要的是，音频链路即使频谱不可见，也会持续写可视化原子环形缓冲。
4. **消除播放时间更新触发的 O(队列长度) 热路径。** `currentTime` 约每 100ms 更新一次，远程歌曲预缓存 watcher 在播放超过 60% 后仍会反复对整个播放队列执行 `indexOf`。当队列是大型曲库时，这会形成稳定且没有用户价值的 CPU 消耗。

瞬时峰值方面，音乐库扫描是第二阶段重点：当前 Rayon 工作者默认使用“逻辑核心数减 1 或 2”，并在扫描差异阶段同时保留候选、数据库快照、完整歌曲、增量歌曲和克隆后的路径映射。它能让扫描很快，但会明显抬高扫描期间 CPU 和峰值内存。

## 2. 分析边界与可信度

本报告是**代码与架构静态分析**，并结合本地 `dist/assets` 的产物大小进行判断；本次没有把未经实测的 MB 或 CPU 百分比写成事实。

- “确定”表示代码中存在明确的常驻对象、轮询、克隆或高频计算。
- “高概率”表示根据 WebView2/Vue/JS 模块模型可合理推断，但收益大小需要发布版基准确认。
- `dist` 文件体积只用于识别加载边界，**不能直接等同于进程工作集或 JS Heap**。
- 最终是否合入任何优化，应由第 8 节的发布版 A/B 基准和体验门槛决定。

## 3. 当前架构与资源模型

### 3.1 进程与窗口

- Rust/Tauri 主进程持有 SQLite、播放器状态、系统媒体控制和音频线程。
- 每个 `WebviewWindow` 都会建立独立 WebView 页面上下文；Windows 上还会涉及 WebView2 相关进程或进程内资源。
- 当前可能存在主窗口、托盘菜单、迷你播放器、桌面歌词、任务栏播控五类页面。
- 桌面歌词关闭时会销毁窗口，这是正确的释放策略；迷你播放器通常只是隐藏；任务栏播控在设置关闭时也只是隐藏；托盘窗口预热后长期保留。

### 3.2 前端状态与媒体库

- 主媒体库以 `songPool: Map<path, LibrarySong>` 保存唯一歌曲对象，并用路径数组表达不同顺序，避免多份完整歌曲对象，这是正确方向（`src/features/library/store.ts:38-43`、`src/features/library/store.ts:131-134`）。
- 字符串和字符串数组有 intern pool，可减少艺术家、专辑等重复值（`src/features/library/store.ts:44-103`）。
- 启动优先加载路径而非一次物化完整歌曲，歌曲表格再按视口分页取数据（`src/composables/playerLibraryRuntime.ts:120-133`、`src/composables/useLibrarySongWindowCache.ts:123-165`）。
- 歌曲表格只渲染虚拟窗口，而不是建立全曲库 DOM（`src/components/song-list/SongTable.vue:329-376`、`src/components/song-list/SongTable.vue:738-841`）。

### 3.3 播放与渲染

- 音频播放由独立 Rust 线程驱动，命令通道在空闲时每 150ms 被唤醒一次（`src-tauri/src/player/runtime.rs:25`、`src-tauri/src/player/runtime.rs:700-738`）。
- 前端播放时间使用本地时钟每 100ms 更新一次，每 1 秒向 Rust 校准；低功耗时更新周期降到 1 秒（`src/composables/playerPlayback.ts:45-46`、`src/composables/playerPlayback.ts:194-232`）。
- 主窗口隐藏、最小化或进入 mini 模式时进入低功耗状态（`src/composables/renderingPower.ts:25-39`）。
- 可视化采样限定为 30 FPS，且主窗口低功耗时停止请求，这一方向正确（`src/components/player/AudioVisualizer.vue:13-18`、`src/components/player/AudioVisualizer.vue:61-67`）。

## 4. 已有优化与应保留的设计

| 已有机制 | 位置 | 评价 |
|---|---|---|
| 路由组件动态导入 | `src/router/index.ts:4-10` | 保留，避免一次加载全部页面 |
| `KeepAlive` 只保留 Home | `src/components/layout/MainShell.vue:143-155` | 保留，控制页面实例数量 |
| 歌曲对象池 + 路径列表 | `src/features/library/store.ts:38-43`、`285-385` | 保留，是大曲库内存优化核心 |
| 字符串/数组 intern | `src/features/library/store.ts:44-103` | 保留，但应测量重建成本 |
| 视口分页缓存默认 16 MiB 预算 | `src/utils/songPageCachePolicy.ts:29-57` | 保留，可接入统一内存预算 |
| 封面缩略图 64 项、全图 4 项 | `src/composables/useCoverCache.ts:8-12` | 保留，容量合理 |
| 页面隐藏时封面收缩 | `src/composables/useCoverCache.ts:244-274` | 保留，并扩展到大型路径缓存 |
| 预模糊背景最多 3 项且 revoke URL | `src/composables/preblurredBackgroundCache.ts:6-17`、`28-54` | 保留，资源释放完整 |
| 扫描进度与批次节流 | `src-tauri/src/music/scanner/progress.rs:98-135`、`144-183` | 保留，避免 IPC 风暴 |
| SQLite WAL + NORMAL | `src-tauri/src/database/schema.rs:3-9` | 保留，读写延迟与可靠性平衡合理 |
| AMLL 低功耗与 dispose | `src/components/player/AmlLyricPlayer.vue:105-170`、`232` | 保留，避免歌词实例泄漏 |

## 5. 热点分析

### 5.1 P0：所有窗口共享完整启动入口

**证据与原因**

- `src/main.ts:1-8` 同步导入 `App` 和 `router`，随后对所有窗口执行 `app.use(router)`。
- `src/App.vue:5-9` 静态导入所有窗口根组件，再根据窗口 label 选择其中一个渲染（`src/App.vue:50-55`）。静态导入的模块仍会被解析和执行，`v-if` 只控制组件是否挂载。
- 迷你播放器在主窗口挂载 3.2 秒后预热（`src/composables/useMiniPlayerWindowBridge.ts:38`、`466-470`）。
- 托盘菜单在 1.6 秒后预热（`src/composables/useTrayMenuEvents.ts:41`、`314-317`）。
- 当前本地构建中，主 `index` JavaScript 为 1,303,181 字节；另有 Pixi 336,810 字节、AMLL 245,751 字节、PlayerDetail 123,115 字节。它们不是内存值，但说明当前模块边界较重。

**影响**

- 高概率增加每个辅助 WebView 的 JS Heap、模块表、Vue 运行时对象、路由对象、事件监听和启动 CPU。
- 自动预热让用户即使从未打开 mini 模式，也会承担额外窗口的常驻资源。
- 这是“同一资源在多个 WebView 中重复”问题，单纯压缩 bundle 只能改善加载，不能从根本上去重运行时状态。

**建议方案**

1. 把 `main.ts` 改成极小的窗口 bootstrap：先读取 label，再动态导入对应入口。
2. 建立独立入口，例如：
   - `entries/main.ts`：Pinia、router、MainShell、完整设置同步。
   - `entries/tray.ts`：仅托盘菜单所需状态与事件。
   - `entries/mini.ts`：仅迷你播放器所需状态与事件。
   - `entries/desktop-lyrics.ts`：仅桌面歌词运行时。
   - `entries/taskbar.ts`：仅任务栏播控。
3. 可以使用 Vite 多页面入口，也可以保留一个 HTML、由极小 bootstrap 动态导入；关键是辅助窗口的依赖图不能静态触达 MainShell 和 router。
4. 把 `registerImportedLyricsFonts` 等全局副作用移到真正需要它的入口，避免每个窗口注册同一批字体和 watcher。
5. 在构建阶段生成 manifest 断言：tray/mini/taskbar 入口不得依赖 Home、Settings、SongTable、PlayerDetail、Pixi 或完整 AMLL chunk。

**体验保护**

- UI 与窗口协议不变，只改变加载边界。
- 保留托盘菜单的预热能力，但预热的是轻量入口。
- 迷你播放器首次打开耗时不得超过现有版本的 P95；若冷加载仍偏慢，可在主界面完成首帧后用 `requestIdleCallback` 预热轻量入口。

**预期**：常驻内存高收益、启动 CPU 中高收益；风险中等，优先实施。

### 5.2 P0：大型路径缓存只按条目数限制

**证据与原因**

- `MemoryCache` 只有 `maxEntries`，不知道值的大小（`src/utils/MemoryCache.ts:1-4`、`106-114`）。
- 全部歌曲视图缓存一个条目就可能包含数万路径，最多保留 8 项（`src/composables/useLibraryAllSongPathCache.ts:13-24`）。
- 文件夹、详情、收藏/最近等路径缓存上限分别达到 96 项（`src/composables/useLibraryFolderSongPathCache.ts:10-17`、`src/composables/useLibraryDetailSongPathCache.ts:7-14`、`src/composables/useLibraryCollectionSongPathCache.ts:13-20`）。
- `songTitleLabels` 是普通 `Map`，只在显式清空路径缓存时清空（`src/composables/useLibraryAllSongPathCache.ts:23-24`、`143-147`）。

**影响**

- 内存占用与“缓存条目数”不成比例；8 个全曲库排序/搜索结果可能远大于 96 个小歌单。
- 搜索词或排序方式频繁变化时，会保留多份大型路径数组。
- JS 引擎是否复用字符串内容不可假定，因此不能把路径数组只按 8 字节引用估算。

**建议方案**

1. 扩展 `MemoryCache`：支持 `weightOf(key, value)`、`maxWeight`、`onEvict`，同时保留 TTL 和 LRU。
2. 路径缓存权重用保守估算：数组固定开销 + 路径字符数 × 2 + 每项引用/对象开销；目标不是精确模拟 V8，而是保证单调、可控。
3. 为所有路径缓存建立共享预算，而不是每个模块各自拥有 96 项：
   - 全部歌曲视图：优先保留“当前视图”和默认标题排序，建议最多 2～3 个大结果。
   - 文件夹/艺术家/专辑/收藏/最近：共用一个加权 LRU。
   - 初始建议预算 8～16 MiB，实际值由 10k/50k/100k 曲库基准调整。
4. `songTitleLabels` 只保留当前 title 排序结果需要的 label，或直接纳入同一加权缓存；`libraryDataVersion` 变化时同步淘汰旧 label。
5. 页面隐藏、主窗口进入低功耗、扫描完成且内存高水位时，把预算收缩到正常值的 25%～50%；恢复前台后按需加载，不主动全量回填。
6. 给 `MemoryCache.stats()` 增加 `weight`、`weightEvictions`，以便基准确认命中率没有明显下降。

**体验保护**

- 当前视口、当前查询和相邻分页必须受保护，不能被淘汰。
- 只有较旧的搜索/排序结果回到数据库查询；列表正在滚动时不执行全量 prune。
- 验收同时观察缓存命中率、列表首屏时间和快速切回页面耗时，不能只看内存。

**预期**：大曲库常驻内存高收益；风险低到中等。

### 5.3 P0：频谱链路存在可避免的持续计算和分配

**证据与原因**

- 前端播放详情激活时每约 33ms 调用一次 `get_audio_visualizer_samples`（`src/components/player/AudioVisualizer.vue:13-16`、`141-163`）。
- 后端每次请求都会 `snapshot()` 新建 2048 项 `Vec<f32>`，再建立复数 buffer 执行 FFT，最后新建频段数组（`src-tauri/src/player/types.rs:48-65`、`src-tauri/src/player/spectrum.rs:25-82`、`src-tauri/src/player/commands.rs:375-380`）。
- Canvas `draw()` 可能跟随 `requestAnimationFrame` 以显示器刷新率循环，而不是 30 FPS；每帧循环 112 根柱，并为每根柱创建线性渐变（`src/components/player/AudioVisualizer.vue:69-129`、`132-139`）。
- `TimedSource` 在每个音频样本上更新进度原子计数，并在每个声道帧把样本写入可视化原子环形缓冲；可视化是否可见不会改变这条路径（`src-tauri/src/player/types.rs:94-114`）。

**建议方案**

1. 为 `SharedVisualizer` 增加 `enabled: AtomicBool`。播放详情 + 可视化真正可见 + 正在播放 + 非低功耗时启用；其他时间不执行可视化求和和环形缓冲写入。
2. 进度计数仍需保留，不能因关闭频谱而破坏播放时间；只旁路可视化采样。
3. 保持采样 30 FPS 以维持现有观感，但把 Canvas 重绘也明确限到 30 FPS。30 FPS 之间用现有平滑函数插值，不需要降低频段数或视觉尺寸。
4. 复用 FFT 输入 buffer、频段输出和前端 `Float32Array`，减少每秒大量短命数组；后端可以缓存“最近一次频段结果 + 样本 cursor”，相同 cursor 不重复 FFT。
5. 预生成柱渐变或使用一张纵向渐变填充，不要每帧创建 112 个 `CanvasGradient`。
6. 只有 ResizeObserver 报告尺寸变化时调整 canvas backing size，不在每帧执行 `getBoundingClientRect()`。
7. 若 IPC 仍是主要成本，可改为后端最多 30Hz 推送或共享最近结果；不要无上限事件推送。

**体验保护**

- 频段数、频率范围、柱数量和音频处理链不变。
- 对比录屏检查节奏跟随、衰减速度和暂停动画，帧间差异应不可感知。
- 音频线程不得增加锁；开关必须使用无阻塞原子状态。

**预期**：播放详情打开时 CPU 高收益；普通播放 CPU 中等收益；内存小到中等收益。

### 5.4 P0：远程预缓存 watcher 在大队列上重复线性查找

**证据与原因**

`currentTime` 每 100ms 更新。`playerLifecycle` 同时 watch `currentSong`、`currentTime` 和 `playQueuePaths`；播放超过 60% 后，每次更新都会执行 `queuePaths.indexOf(song.path)`，直到歌曲结束（`src/composables/playerLifecycle.ts:461-475`）。

**建议方案**

- 改成“一首歌一次”的状态机：歌曲或队列变化时预先计算当前 index；时间首次跨过 60% 时执行一次预缓存并置位。
- 更简单的实现是 watch `computed(() => currentTime / duration >= 0.6)` 的布尔跃迁，同时在歌曲变化时重置。
- 队列变更时更新 index，不在时间 tick 中扫描完整队列。

**体验保护**

- 仍在 60% 时预缓存下一首远程歌曲。
- 测试队列中重复路径、当前歌曲不在队列、切歌、seek 跨过阈值和队列重排。

**预期**：大型队列播放时 CPU 中到高收益；改动小、风险低，适合作为首个 quick win。

### 5.5 P1：扫描并行度偏向吞吐，峰值对象存在多份克隆

**证据与原因**

- 扫描解析线程数默认占用除 1～2 个逻辑核心外的全部可用核心（`src-tauri/src/music/scanner/parser.rs:55-75`）。16 核机器会使用 14 个 worker。
- 差异计算同时保留 `candidates`、`db_snapshot`、`songs_by_index`、`parse_tasks`、`to_add`、`to_update` 和 `to_delete`（`src-tauri/src/music/scanner/diff.rs:451-508`）。
- 解析结果先 clone 到 `songs_by_index`，原对象再进入新增/更新数组；富化后又 clone 全量歌曲到 `song_by_path`，随后再 clone 回增量数组（`src-tauri/src/music/scanner/diff.rs:510-556`）。
- `scan_library` 逐文件夹调用内部扫描，返回的完整 `Vec<Song>` 随即被丢弃，最后只重新查询所有路径（`src-tauri/src/music/library.rs:1332-1373`）。

**建议方案**

1. 引入扫描 QoS：
   - 前台播放或用户正在操作：`min(task_count, max(2, logical_cores / 2))`。
   - 主窗口隐藏且未播放：允许提高到当前策略。
   - 小任务不创建大线程池。
2. 用 `ChangeKind + song index/path` 表达新增/更新，不复制完整 `Song`。富化完成后，数据库写入通过索引借用 `songs` 中对象。
3. `scan_single_directory_internal` 提供两种结果模式：外部文件夹导入可返回完整歌曲；常规 `scan_library` 只返回摘要/路径，不构造最终无用的完整返回副本。
4. 批次事件尽量发送紧凑的增量字段或路径；只有前端确实需要即时显示的新增歌曲才序列化完整对象。
5. 收集候选、解析、入库进一步演进为有界 pipeline；每批 128～512 首，限制同时在内存中的 tag/图片字节。
6. 保留当前 `artist_avatar_bytes.take()` 的及时释放（`src-tauri/src/music/scanner/orchestrator.rs:65-80`）。

**体验保护**

- 用户前台操作的输入延迟和音频连续性优先于扫描总耗时。
- 主窗口隐藏且未播放时可自动提速，补偿前台降并发带来的总耗时。
- 扫描结果顺序、CUE、最小时长过滤、增量删除和进度事件语义必须不变。

**预期**：扫描 CPU 峰值和内存峰值高收益；常驻内存影响小；风险中高，需独立阶段实施。

### 5.6 P1：辅助窗口生命周期可更精细

**现状**

- 桌面歌词在关闭时直接 `destroy()`，释放策略正确（`src/composables/useDesktopLyricsWindowBridge.ts:584-605`）。
- 任务栏播控设置关闭时调用 `hide()`，只在应用退出时销毁（`src/composables/useTaskbarPlayerBridge.ts:421-460`、`570-580`）。
- mini 模式退出后调用 `hide()`，窗口继续常驻（`src/composables/useMiniPlayerWindowBridge.ts:348-368`、`479-490`）。
- 托盘菜单启动后预热并长期保留；考虑默认 `closeToTray=true`，不能简单取消以免托盘首次点击明显变慢（`src/features/settings/store.ts:120`）。

**建议方案**

- 任务栏播控：用户明确关闭设置时销毁；全屏临时遮挡仍只隐藏。
- mini：退出后保留 1～3 分钟租约，期间再次打开无冷启动；租约到期且主窗口稳定时销毁。
- 托盘：保留轻量入口预热。若用户关闭“最小化到托盘”，可延后预热或使用租约；默认行为不变。
- 所有隐藏窗口停止自身 timer、动画、ResizeObserver 和不必要的状态同步；不能只依赖 WebView 的浏览器节流。
- 建立统一 `AuxWindowManager`，记录 `created/ready/visible/lastUsed/leaseTimer`，避免各 bridge 重复实现不同策略。

**体验保护**

- 热租约内打开速度与现有版本相同。
- 只在用户明确关闭功能或长时间不用时销毁。
- 冷打开 P95 建议控制在 400ms 内，超过则延长租约而不是永久常驻。

### 5.7 P1：未打开的重量级 UI 仍过早加载或挂载

- `PlayerDetail` 虽用 `defineAsyncComponent`，但 MainShell 初始模板始终包含它，因此 footer 出现时会立即加载并挂载（`src/components/layout/MainShell.vue:16-20`、`162-170`）。
- `PlayerDetail` 静态导入 `LyricsView`，`LyricsView` 又静态导入 AMLL 与轻量歌词组件（`src/components/player/PlayerDetail.vue:12-15`、`src/components/player/LyricsView.vue:41-43`）。
- PlayQueueSidebar、AddToPlaylistModal、SongInfoModal 也在 MainShell 中始终建立组件，只靠内部 visible 状态控制（`src/components/layout/MainShell.vue:174-193`）。

**建议方案**

- PlayerDetail 在首次打开时才挂载；关闭动画完成后卸载歌词/背景等重量级子树。ES module 代码通常仍在模块缓存中，但 DOM、观察器、Canvas/AMLL 实例可被释放。
- AMLL 与 LightLyricPlayer 按 `playerRenderMode` 动态加载，避免两套实现同时进入同一初始依赖图。
- 模态框/侧栏用 `v-if` 或 transition 的 `after-leave` 销毁，打开时再加载。
- 对首次打开做空闲预取 chunk，但不提前 mount 组件。

**体验保护**

- chunk 可预取、实例不可提前常驻。
- 保留关闭动画；使用“开始关闭 → 动画完成 → unmount”的两阶段状态。
- 记录首次打开与再次打开耗时，不能出现可见空白帧。

### 5.8 P2：轮询与定时持久化可减少无效唤醒

1. **任务栏播控**每 1 秒查询前台全屏状态并校准位置（`src/composables/useTaskbarPlayerBridge.ts:464-495`）。优先改为 Win32 前台窗口、显示器/任务栏变化事件，保留 5～10 秒低频兜底；拖动期间不校准。
2. **播放器 Rust 线程**空闲时仍每 150ms `recv_timeout` 唤醒。播放中保留 150ms；停止且无待处理设备变化时可自适应到 1 秒，命令到达仍会立即唤醒。
3. **播放位置持久化**每 2 秒检查并同步写 localStorage（`src/composables/playerLifecycle.ts:503-551`）。可改成 5 秒，并在暂停、切歌、隐藏、退出时立即刷写；恢复位置误差仍控制在 5 秒内。
4. **桌面歌词**400ms 的同步是该窗口启用时的合理保底（`src/composables/useDesktopLyricsWindowBridge.ts:452-459`），不建议优先降低；其本地时钟已避免逐帧跨窗口同步。

### 5.9 P2：SQLite 临时内存与搜索查询需基准后再调整

- 当前 `temp_store=MEMORY`（`src-tauri/src/database/schema.rs:10`）可加速排序，但大型查询可能抬高进程峰值 RSS。
- 搜索使用多个 `LOWER(column) LIKE` 与相关子查询（`src-tauri/src/music/library.rs:901-911`、`1026-1036`），普通索引难以优化包含式模糊搜索。

建议：

- 先记录 50k/100k 曲库查询耗时和 SQLite high-water memory；不要直接改成磁盘临时表。
- 若峰值明显，可在发布版尝试 `temp_store=DEFAULT` 或合理 `cache_size`，以 P95 查询延迟不回退为条件。
- 大曲库模糊搜索若成为 CPU 热点，使用 FTS5 维护标题、艺术家、专辑、路径索引；短查询加 120～180ms debounce，并取消过期请求。
- 常用 title/artist/added_at/file_modified_at 排序可评估表达式索引，但只添加 `EXPLAIN QUERY PLAN` 证明被使用的索引，避免用更多页缓存换取不确定收益。

## 6. 推荐实施顺序

### 阶段 0：建立发布版基线（0.5～1 天）

复用 `docs/performance-dashboard-plan.md` 的进程组统计思路，但性能看板只在开发/诊断模式开启，避免看板本身成为生产常驻开销。

- 记录主进程及其 WebView2 子进程组的 Private Working Set、Private Bytes、CPU、线程数、句柄数。
- 记录窗口 label、WebView 数量、各缓存条目数/权重、歌曲对象池大小、可视化是否启用、扫描 worker 数。
- 前端开发模式记录 `performance.memory`（若 WebView2 暴露）与长任务；Rust 记录扫描各阶段耗时和高水位对象数。

### 阶段 1：低风险 quick wins（1～3 天）

1. 修复远程预缓存 O(N) watcher。
2. 任务栏设置关闭时销毁窗口。
3. Canvas 绘制明确限 30 FPS、复用渐变与尺寸。
4. 模态框和侧栏改为按需挂载。
5. 播放位置持久化改成低频 + 事件立即刷写。

### 阶段 2：高收益架构优化（3～7 天）

1. 拆分窗口 bootstrap/入口和依赖图。
2. 为路径缓存建立加权 LRU 与统一预算。
3. 可视化增加无锁启停、buffer 复用与结果缓存。
4. 引入统一辅助窗口租约管理。

### 阶段 3：扫描峰值优化（4～8 天）

1. 自适应扫描 QoS。
2. 用索引/所有权重构移除 `Song` 克隆。
3. 常规扫描返回摘要而不是完整歌曲。
4. 视需要升级为有界批处理 pipeline。

### 阶段 4：数据驱动的数据库与系统事件优化

只有前面基准证明仍是热点时，再做 FTS5、SQLite temp/cache 调整、任务栏 Win32 事件化和播放器线程空闲退避。

## 7. 优先级与收益矩阵

| 优先级 | 项目 | 常驻内存 | CPU | 实施风险 | 是否影响正常体验 |
|---|---|---:|---:|---:|---|
| P0 | 按窗口拆分前端入口 | 高 | 中高（启动） | 中 | 不应影响，需守住冷启动门槛 |
| P0 | 路径缓存加权预算 | 高（大曲库） | 低到中 | 低中 | 当前视图受保护时无明显影响 |
| P0 | 可视化按可见性启停与复用 | 中 | 高（播放详情） | 中 | 保持 30 FPS 和频段不变 |
| P0 | 远程预缓存阈值状态机 | 低 | 中高（大队列） | 低 | 无影响 |
| P1 | 扫描 QoS + 去克隆 | 高（扫描峰值） | 高（扫描峰值） | 中高 | 前台更流畅；后台扫描耗时需守门 |
| P1 | 辅助窗口租约/明确关闭销毁 | 高 | 中 | 中 | 热租约保护常用窗口速度 |
| P1 | 重量级 UI 按需挂载 | 中 | 中（启动） | 中 | 需消除首次打开空白帧 |
| P2 | 轮询事件化/空闲退避 | 低 | 中（空闲） | 中 | 保留低频兜底 |
| P2 | SQLite/FTS 调整 | 中（峰值） | 中高（搜索） | 中高 | 必须由大曲库基准驱动 |

## 8. 基准与验收方案

### 8.1 测试原则

- 必须用 `tauri build` 的 Release 版本；开发服务器、HMR 和 DevTools 数据不作为结论。
- 同一机器、同一曲库、同一主题、同一窗口尺寸；每个场景冷启动与暖启动各 3～5 次。
- 每次操作后等待 30～60 秒，再记录稳态中位数、P95 和峰值。
- 统计整个 Lycia 进程组，不能只看 Rust 主进程。
- 优化前后都记录 WebView 数量，否则“少开了一个窗口”会误导单进程对比。

### 8.2 场景矩阵

| 场景 | 关注指标 |
|---|---|
| 冷启动后首页静置 60 秒 | 基础 Private WS、JS Heap、空闲 CPU、WebView 数 |
| 普通播放，详情页关闭 | 音频线程 CPU、前端 10Hz 更新、频谱是否真正关闭 |
| 播放详情 + AMLL + 频谱 | CPU/GPU、长任务、掉帧、IPC 次数 |
| 暂停播放 | 动画衰减后 CPU 是否回落 |
| 隐藏到托盘 5 分钟 | CPU 唤醒、隐藏窗口内存、timer 数 |
| 打开/关闭 mini 10 次 | 增量内存、窗口是否回收、再次打开耗时 |
| 打开/关闭桌面歌词 10 次 | WebView/AMLL 是否释放、内存是否回落 |
| 任务栏播控开/关 | 轮询 CPU、关闭后窗口是否销毁 |
| 10k/50k/100k 曲库切换排序和搜索 | 路径缓存权重、命中率、查询 P95 |
| 全量与增量扫描 | 峰值内存、峰值 CPU、输入延迟、总耗时 |
| 连续切歌 100 次 | 封面/Blob/Canvas/歌词实例是否增长 |

### 8.3 建议的暂定门槛

以下是实施目标，不是当前实测值：

- 主窗口首页稳态进程组 Private WS：阶段 2 后相对基线下降至少 15%，且无场景回退超过 5%。
- 每个轻量辅助窗口的增量内存：相对当前同窗口下降至少 30%。
- 大曲库连续执行 20 个搜索/排序后，路径缓存权重不得超过配置预算的 105%。
- 普通播放且详情关闭：可视化 FFT 调用次数必须为 0。
- 播放详情可见：可视化 IPC/FFT/Canvas 绘制均不得超过配置的 30Hz。
- 前台扫描时 UI 输入延迟和音频 underrun 不得劣于基线；隐藏且未播放时扫描总耗时回退不超过 10%。
- 首次打开 mini/托盘/任务栏窗口 P95 不高于 400ms；热租约内不高于 200ms。
- 首页、播放详情、歌词滚动和歌曲列表的帧稳定性不得劣于基线；任何内存下降都不能以新增可见卡顿换取。

### 8.4 自动化回归建议

- 构建 manifest 测试：辅助入口禁止依赖主壳和重型 chunk。
- `MemoryCache` 单测：权重淘汰、TTL、当前视图保护、隐藏时收缩。
- 播放生命周期单测：60% 阈值一次性触发，队列变化后正确更新。
- 可视化单测：隐藏/低功耗/详情关闭时后端开关为 false，恢复后不丢进度。
- 扫描单测：worker 上限、自适应模式、去克隆重构前后结果完全一致。
- 窗口生命周期测试：设置关闭后 `destroy()`，全屏临时遮挡只 `hide()`，租约到期释放。
- 完整执行 `npm test`、`npm run typecheck`、`npm run build`、`npm run test:rust`。

## 9. 不建议采用的“优化”

- 不要依赖手动 `gc()`、定时刷新页面或重启 WebView 掩盖泄漏。
- 不要为了内存先缩小音频解码/输出缓冲；这会增加爆音和 underrun 风险。
- 不要降低音频采样精度、均衡器质量、WASAPI 独占路径或歌词时间精度。
- 不要把所有缓存一刀切清空；频繁重新解码封面和查询数据库会把内存问题转成 CPU/IO 卡顿。
- 不要取消全部预热；应先拆轻量入口，再采用受控租约。
- 不要把 `temp_store=MEMORY` 直接改成磁盘并宣称内存优化成功；必须同时验证搜索/排序 P95。
- 不要用开发模式任务管理器数据评价 Release 构建。

## 10. 最终建议

若只安排一个迭代，建议完成以下闭环：

1. 建立 Release 进程组基线。
2. 修复远程预缓存 watcher。
3. 拆分五类窗口入口，并保留轻量托盘预热。
4. 把路径缓存改为统一加权预算。
5. 让频谱在不可见时从音频采样到 FFT 全链路停机，并把绘制严格限制到 30Hz。
6. 重新跑全部场景矩阵；只有在内存、CPU 与体验三项同时通过门槛时合入。

这组改动优先消除重复运行时、无界体积缓存和不可见计算，基本不触碰用户直接感知的音质与视觉规格，符合“减少资源占用但不牺牲正常体验”的目标。
