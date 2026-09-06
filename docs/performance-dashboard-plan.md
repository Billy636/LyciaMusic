# Lycia Player 性能看板开发方案

## 目标

开发一个独立的性能看板窗口，用于在本机测试 Lycia Player 操作时观察资源占用变化。看板需要覆盖软件自身相关进程的 CPU、GPU、内存占用，并同时展示 MB 与百分比单位。

核心诉求：

- 独立窗口：不阻挡主播放器操作，方便拖到旁边持续观察。
- 软件级占用：统计 Lycia Player 主进程以及 WebView2 / 辅助子进程的进程组占用。
- 实时刷新：默认 1 秒采样，可切换 250ms、500ms、1s、2s。
- 单位完整：CPU / GPU 显示百分比，内存显示 MB 与占系统内存百分比，GPU 显存显示 MB 与占显存百分比。
- 测试友好：支持暂停、清零峰值、复制当前快照、导出 CSV。

## 现有项目接入点

当前项目是 Tauri 2 + Vue 3：

- 前端入口：`src/main.ts`
- 窗口分发：`src/App.vue`
- 现有辅助窗口模式：
  - mini 窗口：`src/features/miniPlayer/shared.ts`、`src/composables/useMiniPlayerWindowBridge.ts`
  - 桌面歌词窗口：`src/features/desktopLyrics/shared.ts`、`src/composables/useDesktopLyricsWindowBridge.ts`
  - 任务栏控制窗口：`src/features/taskbarPlayer/shared.ts`、`src/composables/useTaskbarPlayerBridge.ts`
- Tauri 命令注册：`src-tauri/src/lib.rs`
- 命令权限白名单：`src-tauri/permissions/app-commands.toml`
- 前端 typed invoke：`src/services/tauri/contracts.ts`、`src/services/tauri/invoke.ts`

建议沿用现有辅助窗口架构，不新增路由页作为主入口。性能看板作为一个独立 WebviewWindow，由主窗口标题栏或设置页工具按钮打开。

## 功能范围

### MVP

1. 新增独立窗口 `performance-dashboard`。
2. 后端提供 `get_performance_snapshot` 命令。
3. 看板每隔固定时间拉取一次快照。
4. 显示：
   - CPU 当前占用百分比
   - CPU 峰值百分比
   - 内存当前占用 MB
   - 内存占系统物理内存百分比
   - 内存峰值 MB
   - GPU 当前占用百分比
   - GPU 峰值百分比
   - GPU 专用显存 MB
   - GPU 共享显存 MB
   - 采样时间、进程数量、采样状态
5. 展示最近 60 个采样点的折线趋势。
6. 支持暂停 / 继续、清空峰值、复制当前快照。

### 第二阶段

1. CSV 导出最近 N 分钟采样。
2. 分进程明细表：
   - 进程名
   - PID
   - CPU %
   - 内存 MB
   - GPU %
   - GPU 显存 MB
3. 事件标记：
   - 手动点击“添加标记”
   - 标记当前正在测试的操作，例如“切换播放页”“扫描曲库”“打开歌词”
4. 可选置顶。
5. 窗口位置与大小持久化。

### 暂不纳入

- 跨平台 GPU 精准统计。优先 Windows，因为当前用户测试环境与 WebView2 资源统计都以 Windows 为主。
- 系统全局性能看板。该看板只统计 Lycia Player 相关进程组，避免和任务管理器职责重叠。
- 自动性能诊断结论。第一版只提供可信观察数据，不直接判断“哪里慢”。

## 数据定义

前端使用的快照结构建议如下：

```ts
export interface PerformanceSnapshot {
  sampledAt: number;
  processCount: number;
  cpu: {
    percent: number;
    rawProcessPercent: number;
    logicalCoreCount: number;
  };
  memory: {
    usedMb: number;
    totalSystemMb: number;
    percent: number;
    workingSetMb: number;
  };
  gpu: {
    available: boolean;
    percent: number | null;
    dedicatedMemoryMb: number | null;
    sharedMemoryMb: number | null;
    dedicatedMemoryPercent: number | null;
    adapterName: string | null;
    reasonUnavailable: string | null;
  };
  processes: PerformanceProcessSnapshot[];
}

export interface PerformanceProcessSnapshot {
  pid: number;
  parentPid: number | null;
  name: string;
  cpuPercent: number;
  memoryMb: number;
  gpuPercent: number | null;
  dedicatedGpuMemoryMb: number | null;
  sharedGpuMemoryMb: number | null;
}
```

CPU 百分比建议展示两个值：

- 主显示：`cpu.percent`，按系统总 CPU 容量归一化，范围通常是 `0-100%`。
- Tooltip 或明细：`rawProcessPercent`，保留进程组原始 CPU 累加值，允许多核场景超过 `100%`。

内存百分比：

- `memory.usedMb / memory.totalSystemMb * 100`
- `usedMb` 优先使用进程 working set / RSS 累加。

GPU 百分比：

- Windows 优先使用 GPU Engine 性能计数器。
- 如果驱动、权限或系统计数器不可用，则 `available=false`，前端显示“不可用”，不要填充伪造的 0%。

## 后端实现方案

### 文件变更

建议新增：

- `src-tauri/src/performance.rs`

需要修改：

- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`
- `src-tauri/permissions/app-commands.toml`

### Rust 依赖建议

CPU / 内存建议引入：

```toml
sysinfo = "0.33"
```

GPU Windows 统计有两条路线：

1. 首选 PDH / Performance Counter。
   - 通过 Windows GPU Engine 计数器读取进程 GPU 使用率。
   - 需要匹配实例名中的 PID，例如 `pid_1234`。
   - 需要汇总 3D、Compute、Copy、Video Decode、Video Processing 等 engine。
2. 备用 DXGI / Windows API。
   - 用于拿 adapter 名称、显存上限、可用能力。
   - GPU 使用率本身仍以性能计数器为主。

当前 `Cargo.toml` 已有 `windows-sys`，但 features 不足。后续可能需要补充 Windows 相关 features，或者改用 `windows` crate 简化 PDH / DXGI 绑定。建议第一版先把 CPU / 内存做稳，GPU 计数器封装为 Windows-only 模块，并带不可用 fallback。

### 进程组识别

看板要统计“本软件所有占用”，不应只看主进程。建议策略：

1. 获取当前进程 PID。
2. 用 `sysinfo` 刷新所有进程。
3. 从当前 PID 出发，递归查找所有 parent pid 属于 Lycia 进程组的子进程。
4. 汇总进程组：
   - Lycia 主进程
   - WebView2 子进程
   - 其他由主进程派生的辅助进程

如果发现 WebView2 子进程在某些系统上 parent pid 不稳定，第二阶段再增加保守匹配：

- 进程名包含 `msedgewebview2`
- 命令行包含 Lycia app data / executable path
- 只在 parent pid 递归漏统计时作为补偿

第一版不建议宽泛按进程名统计所有 WebView2，避免把其他应用的 WebView2 算进来。

### CPU 采样

CPU 不能只读单点，需要基于两次采样间隔计算。实现建议：

1. 在 Rust 侧维护 `PerformanceMonitorState`。
2. `AppState` 内放 `Mutex<PerformanceMonitorState>`。
3. `get_performance_snapshot` 每次调用时刷新系统进程。
4. 计算各进程 CPU 使用率。
5. 汇总后除以逻辑核心数得到系统容量百分比。

注意事项：

- 第一次调用没有有效 delta，返回 `warmingUp=true` 或 CPU 为 `0` 并附状态文案。
- 采样间隔低于 200ms 时 CPU 读数波动大，前端最小刷新间隔建议限制为 250ms。
- UI 上显示最近 3 个点移动平均，明细表显示原始当前值。

### 内存采样

内存可以单点读取：

- `process.memory()` 汇总为 MB。
- `system.total_memory()` 作为系统物理内存总量。
- 百分比为 `used / total * 100`。

注意区分单位：`sysinfo` 版本不同可能返回 bytes 或 KiB，需要写测试或封装函数确认，避免 MB 显示偏 1024 倍。

### GPU 采样

Windows 下建议新增 `performance::gpu_windows` 子模块。

采样目标：

- GPU Engine utilization percentage
- Dedicated GPU memory MB
- Shared GPU memory MB
- Adapter name
- 显存总量，用于计算百分比

实现路径：

1. 枚举 GPU Engine 性能计数器实例。
2. 过滤实例名中包含目标 PID 的记录。
3. 按 PID 聚合 engine utilization。
4. 读取 GPU Process Memory 的 Dedicated / Shared Usage。
5. 如能拿到 adapter dedicated video memory，则计算 `dedicatedMemoryPercent`。
6. 任一步失败时返回 `GpuMetricsUnavailable`，包含 reason。

前端展示规则：

- `available=true`：正常显示百分比和 MB。
- `available=false`：显示“GPU 统计不可用”，并在小字显示原因，例如“系统未暴露 GPU Engine 计数器”。
- 不可用不算失败，不弹错误 Toast。

## 前端实现方案

### 文件变更

建议新增：

- `src/features/performance/shared.ts`
- `src/composables/usePerformanceDashboardWindowBridge.ts`
- `src/services/tauri/performanceApi.ts`
- `src/components/performance/PerformanceDashboardWindow.vue`
- `src/components/performance/PerformanceMetricTile.vue`
- `src/components/performance/PerformanceSparkline.vue`
- `src/components/performance/PerformanceProcessTable.vue`

需要修改：

- `src/App.vue`
- `src/components/layout/TitleBar.vue` 或 `src/components/settings/SettingsToolbox.vue`
- `src/services/tauri/contracts.ts`

### 窗口接入

新增共享常量：

```ts
export const PERFORMANCE_DASHBOARD_WINDOW_LABEL = 'performance-dashboard';
export const PERFORMANCE_DASHBOARD_BOUNDS_KEY = 'performance_dashboard_window_bounds';
export const PERFORMANCE_DASHBOARD_WINDOW_WIDTH = 720;
export const PERFORMANCE_DASHBOARD_WINDOW_HEIGHT = 520;
export const PERFORMANCE_DASHBOARD_WINDOW_MIN_WIDTH = 560;
export const PERFORMANCE_DASHBOARD_WINDOW_MIN_HEIGHT = 420;
```

`App.vue` 增加窗口判断：

```vue
<PerformanceDashboardWindow v-if="isPerformanceDashboardWindow" />
```

窗口创建建议：

```ts
new WebviewWindow(PERFORMANCE_DASHBOARD_WINDOW_LABEL, {
  url: '/',
  title: 'Lycia Performance Dashboard',
  width: 720,
  height: 520,
  minWidth: 560,
  minHeight: 420,
  visible: true,
  decorations: false,
  transparent: true,
  shadow: true,
  resizable: true,
  skipTaskbar: false,
  alwaysOnTop: false,
  center: true,
});
```

该窗口不需要和主播放器实时同步业务状态，只需要能独立轮询后端性能数据即可。

### UI 布局

看板第一屏建议为实用型工具布局，不做营销式大卡片。

顶部工具栏：

- 标题：`性能看板`
- 当前状态：运行中 / 已暂停 / 预热中 / GPU 不可用
- 刷新间隔菜单：250ms、500ms、1s、2s
- 置顶按钮
- 暂停 / 继续按钮
- 清空峰值按钮
- 复制快照按钮
- 关闭按钮

主体：

1. 指标区，2 行网格：
   - CPU
   - 内存
   - GPU
   - GPU 显存
2. 趋势区：
   - CPU / 内存 / GPU 三条线
   - 最近 60 个点
3. 进程明细：
   - 默认折叠，点击展开
   - PID、进程名、CPU、内存、GPU、显存

设计注意：

- 数字使用等宽字体，避免刷新时宽度跳动。
- 百分比保留 1 位小数，MB 保留 1 位小数。
- GPU 不可用时整块保持占位，不让布局跳动。
- 窗口需要可拖动区域，按钮区域停止拖动。
- 避免过度背景模糊，否则性能看板本身会引入额外 GPU 负担。

## 采样与展示策略

### 默认刷新

- 默认刷新间隔：1000ms。
- 最低刷新间隔：250ms。
- 页面隐藏或窗口最小化时：降频到 2000ms 或暂停采样。
- 手动暂停时：停止轮询，保留最后快照。

### 峰值统计

前端维护峰值即可：

- `peakCpuPercent`
- `peakMemoryMb`
- `peakGpuPercent`
- `peakDedicatedGpuMemoryMb`

点击“清空峰值”后，从下一次快照重新计算。

### 趋势数据

前端保留环形数组：

```ts
const MAX_HISTORY_POINTS = 60;
```

每次快照 push 一个点，超出后 shift。导出 CSV 时可用更大的内存缓冲，例如最多 30 分钟：

```ts
const MAX_EXPORT_POINTS = 30 * 60;
```

## 测试场景

### 基础验证

1. 启动开发模式：
   - `npm run tauri dev`
2. 打开性能看板。
3. 等待 2 次采样后确认：
   - CPU 不再是预热状态
   - 内存 MB 有稳定数值
   - 进程数量大于等于 1
4. 打开任务管理器对照：
   - Lycia 主进程 + WebView2 子进程内存总量接近
   - CPU 趋势方向一致

### 操作压测

建议记录以下操作：

- 启动后 idle 30 秒。
- 切换首页、专辑、歌手、播放页。
- 打开播放页歌词渲染。
- 切换 AMLL / 轻量歌词模式。
- 调整窗口大小。
- 扫描一个大曲库。
- 搜索歌曲。
- 快速滚动歌曲列表。
- 切换主题与背景效果。
- 播放高码率 FLAC。
- 开启 / 关闭均衡器。
- 打开 mini 模式。
- 打开桌面歌词。

每个场景观察：

- CPU 峰值
- CPU 是否能回落
- 内存是否持续上涨
- GPU 是否异常升高
- 子进程数量是否异常增加

### 回归测试

前端：

- `npm run typecheck`
- `npm run test`

Rust：

- `npm run test:rust`

建议新增测试：

- `performance.rs` 的 MB 单位换算测试。
- 进程树递归聚合测试，使用纯函数输入模拟 PID / parent PID。
- 前端趋势数组长度限制测试。
- 前端 GPU 不可用状态渲染测试。

## 实施步骤

### 第一步：后端 CPU / 内存

1. 添加 `sysinfo` 依赖。
2. 新增 `src-tauri/src/performance.rs`。
3. 实现进程组发现。
4. 实现 `get_performance_snapshot`，先返回 CPU / 内存 / 进程列表。
5. 在 `src-tauri/src/lib.rs` 注册模块与命令。
6. 在 `src-tauri/permissions/app-commands.toml` 放行命令。
7. 编写 Rust 单元测试。

交付标准：

- 看板暂不做 UI 时，前端或调试调用能拿到稳定 JSON。
- CPU 预热后有合理数值。
- 内存 MB 与任务管理器数量级一致。

### 第二步：独立窗口与基础 UI

1. 新增 `src/features/performance/shared.ts`。
2. 新增窗口 bridge。
3. `App.vue` 分发到 `PerformanceDashboardWindow.vue`。
4. 在标题栏或设置工具箱增加入口按钮。
5. 做指标卡与基础轮询。

交付标准：

- 能打开独立窗口。
- 主窗口可继续操作。
- 看板可实时刷新 CPU / 内存。
- 暂停、继续、清空峰值可用。

### 第三步：GPU Windows 支持

1. 增加 Windows-only GPU 采样模块。
2. 加入 GPU Engine / GPU Process Memory 读取。
3. 前端展示 GPU 可用 / 不可用状态。
4. 和任务管理器 GPU 列做方向性对照。

交付标准：

- 支持的 Windows 环境能看到 GPU 使用率。
- 不支持时显示明确不可用原因。
- 不影响 CPU / 内存看板。

### 第四步：测试增强与导出

1. 进程明细表。
2. CSV 导出。
3. 操作标记。
4. 窗口 bounds 持久化。
5. 文档补充测试指南。

交付标准：

- 可以完成一轮本地性能观察并导出数据。
- 能区分主进程与 WebView2 子进程占用。

## 风险与处理

### GPU 读数不可用

风险：部分 Windows 版本、驱动、性能计数器损坏时无法读取 GPU Engine。

处理：

- GPU 模块必须是可选能力。
- 后端返回 `available=false` 与 `reasonUnavailable`。
- 前端保持看板可用，不报错中断。

### CPU 百分比口径混乱

风险：进程 CPU 原始值可能多核超过 100%，用户理解为异常。

处理：

- 主指标显示归一化后的系统百分比。
- 明细 tooltip 显示“进程原始 CPU，可超过 100%”。
- 文档说明口径。

### 看板自身带来额外开销

风险：独立 WebViewWindow 本身会增加内存和 GPU 占用。

处理：

- UI 避免重度模糊、复杂动画和大面积阴影。
- 默认 1s 采样。
- 最低 250ms 只用于短时间观察。
- 显示“看板窗口本身也计入 Lycia 进程组”的说明。

### 进程组漏算

风险：WebView2 子进程 parent pid 在某些环境下不稳定。

处理：

- 第一版以 parent pid 递归为主。
- 明细表显示进程列表，方便发现漏算。
- 第二阶段补充命令行匹配，但必须避免误算其他应用。

## 推荐入口位置

优先推荐放在设置页工具箱或标题栏调试按钮：

1. 如果该功能主要给开发 / 测试使用：放在 `设置 -> 工具箱`。
2. 如果会长期给用户排查性能问题：标题栏增加一个 `Activity` 图标按钮，并在 tooltip 写“性能看板”。

考虑当前需求是本地测试操作观察占用，建议第一版放在设置页工具箱；等稳定后再决定是否放到标题栏。

## 命名建议

文件 / 类型命名：

- `performance.rs`
- `PerformanceSnapshot`
- `PerformanceProcessSnapshot`
- `performanceApi`
- `PerformanceDashboardWindow`
- `usePerformanceDashboardWindowBridge`

窗口 label：

- `performance-dashboard`

命令名：

- `get_performance_snapshot`

## 验收清单

- [ ] 能从主窗口打开独立性能看板。
- [ ] 看板关闭不退出主程序。
- [ ] 看板能暂停 / 继续采样。
- [ ] CPU 显示百分比，并有峰值。
- [ ] 内存显示 MB 和百分比，并有峰值。
- [ ] GPU 可用时显示百分比。
- [ ] GPU 不可用时显示原因，不影响其他指标。
- [ ] 进程数量与明细可见。
- [ ] 最近 60 个采样点趋势正常。
- [ ] `npm run typecheck` 通过。
- [ ] `npm run test` 通过。
- [ ] `npm run test:rust` 通过。

