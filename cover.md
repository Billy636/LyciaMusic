# 歌曲列表封面显示功能详解

本项目采用**按需加载（Lazy Loading）**、**本地缓存（Disk Cache）**与**内存缓存（Memory Cache）**相结合的策略，实现了歌曲列表封面的高效显示。以下是详细的流程分析。

## 1. 核心流程概览

1.  **前端列表渲染**：使用虚拟滚动（Virtual Scrolling）技术，仅渲染当前视口内的歌曲行。
2.  **按需触发**：监听可视区域的变化，对当前可见的歌曲触发封面获取请求（配合防抖处理）。
3.  **后端处理**：Tauri 后端接收请求，检查本地磁盘是否已有缓存的缩略图。
    *   **有缓存**：直接读取缓存文件。
    *   **无缓存**：读取音频文件元数据，提取封面，压缩裁剪为 100x100 的 JPEG 并写入磁盘缓存。
4.  **数据返回**：将图片数据读取并转换为 Base64 格式字符串返回给前端。
5.  **前端展示**：前端接收 Base64 数据，存入内存缓存（Map），并通过 `<img>` 标签显示。

---

## 2. 前端实现细节

### 文件位置
*   **组件文件**: `src/components/song-list/SongTable.vue`

### 关键逻辑

1.  **虚拟滚动 (Virtual Scrolling)**
    *   通过 `virtualData` 计算属性，根据 `scrollTop` 和容器高度计算出当前应该渲染的 `items`。
    *   这大大减少了 DOM 节点数量，是流畅显示封面的基础。

2.  **防抖加载 (Debouncing)**
    *   定义了 `loadCoverDebounced` 函数，利用 `setTimeout` 实现了 20ms 的防抖。
    *   **触发时机**：`watch(() => virtualData.value.items, ...)` 监听可视列表的变化。只有当滚动停止或变慢时，才会真正发起请求。

3.  **内存缓存 (Memory Cache)**
    *   使用 `coverCache` (`Reactive Map<string, string>`) 存储已加载的封面。
    *   **Key**: 歌曲文件路径 (`song.path`)。
    *   **Value**: 图片的 Base64 Data URL。
    *   在发起请求前，会先检查 `coverCache` 是否已有数据，避免重复请求。

4.  **API 调用**
    *   调用 Tauri 命令：`invoke<string>('get_song_cover_thumbnail', { path: song.path })`。

```typescript
// 伪代码示例
const loadCoverDebounced = (() => {
  let timer = null;
  return (items) => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      items.forEach(async (song) => {
        if (hasCache(song.path)) return;
        const dataUrl = await invoke('get_song_cover_thumbnail', { path: song.path });
        cache.set(song.path, dataUrl);
      });
    }, 20);
  };
})();
```

---

## 3. 后端实现细节

### 文件位置
*   **Rust 逻辑**: `src-tauri/src/music.rs`

### 关键命令：`get_song_cover_thumbnail`

该命令负责返回封面的 Base64 数据。它依赖于辅助函数 `get_or_create_thumbnail`。

1.  **路径哈希 (Path Hashing)**
    *   使用 **SHA256** 对歌曲的绝对路径进行哈希，生成唯一的字符串 ID。
    *   缓存文件名格式：`{hash}.jpg`。

2.  **磁盘缓存目录**
    *   缓存存储在应用的 `app_data` 目录下的 `covers` 子文件夹中。
    *   例如 Windows 下通常为：`C:\Users\{User}\AppData\Roaming\{AppId}\covers\`。

3.  **生成与缓存流程 (`get_or_create_thumbnail`)**
    *   **检查**: 如果 `covers/{hash}.jpg` 已存在，直接返回其路径。
    *   **提取**: 使用 `lofty` 库读取音频文件的 ID3/元数据标签。
    *   **解析**: 提取第一张图片 (`Picture`) 数据。
    *   **处理**: 使用 `image` 库将图片加载到内存。
    *   **压缩**: 将图片 **Resize** 为 `100x100` 像素（FilterType::Triangle）。
    *   **保存**: 将处理后的图片以 **JPEG** 格式写入磁盘缓存文件。

4.  **数据转换**
    *   读取缓存文件 (`fs::read`).
    *   使用 `base64` 库将二进制数据编码为标准 Base64 字符串。
    *   拼接前缀：`data:image/jpeg;base64,...`。
    *   返回给前端。

---

## 4. 数据流向总结

```mermaid
graph TD
    A[SongTable.vue (Scroll Event)] -->|Update Virtual Items| B(Watcher)
    B -->|Debounce 20ms| C{Check JS Cache}
    C -- Cached --> D[Display Image]
    C -- Not Cached --> E[Invoke 'get_song_cover_thumbnail']
    E --> F[Rust Backend]
    F --> G{Check Disk Cache (SHA256)}
    G -- Missing --> H[Read Audio File (lofty)]
    H --> I[Extract & Resize (100x100)]
    I --> J[Save to 'covers/{hash}.jpg']
    J --> K[Read Cache File]
    G -- Exists --> K
    K --> L[Base64 Encode]
    L --> M[Return Data URL]
    M --> N[Update JS Cache]
    N --> D
```

## 5. 优势

*   **性能优化**：通过后端生成小尺寸缩略图 (100x100)，极大减少了前端内存占用和渲染压力，避免直接加载原始大图。
*   **持久化**：磁盘缓存确保了应用重启后无需重新解析音频文件，提升二次加载速度。
*   **流畅度**：虚拟滚动配合防抖请求，确保在快速拖动滚动条时不会阻塞 UI 线程或发起过多无用请求。

---

# 📅 2025-12-26 逻辑更新总结

根据最新的代码变动，封面加载逻辑进行了显著优化，主要体现在**Asset Protocol 替换 Base64**、**LRU 缓存机制**以及**哈希算法增强**三个方面。以下是更新后的详细流程。

## 1. 核心变更概览

1.  **通信协议升级**：后端不再读取文件并返回 Base64 大字符串，而是返回封面在磁盘上的**绝对路径**。前端通过 Tauri 的 `convertFileSrc` 将其转换为 `asset://` 或 `https://asset.localhost/` 链接，由浏览器直接加载本地资源。这极大地降低了 IPC（进程间通信）的开销。
2.  **缓存策略升级 (Frontend)**：前端引入了 **LRU (Least Recently Used)** 缓存机制，限制内存中缓存的图片 URL 数量（MAX_CACHE_SIZE = 200），防止长时间运行导致内存泄漏。
3.  **缓存准确性 (Backend)**：哈希生成算法加入了文件修改时间 (`mtime`)，确保当用户修改了本地音频文件的封面后，应用能检测到变化并重新生成缓存。

## 2. 更新后的前端逻辑 (`SongTable.vue`)

### 关键代码变动

*   **引入工具**：`import { convertFileSrc } from '@tauri-apps/api/core';`
*   **LRU 缓存实现**：
    ```typescript
    const MAX_CACHE_SIZE = 200;
    const updateCache = (key: string, value: string) => {
        if (coverCache.has(key)) coverCache.delete(key); // 刷新位置
        else if (coverCache.size >= MAX_CACHE_SIZE) {
            const firstKey = coverCache.keys().next().value;
            coverCache.delete(firstKey); // 淘汰最早的
        }
        coverCache.set(key, value);
    };
    ```
*   **资源加载**：
    ```typescript
    const filePath = await invoke<string>('get_song_cover_thumbnail', { path: song.path });
    if (filePath) {
        const assetUrl = convertFileSrc(filePath); // 转换为浏览器可读 URL
        updateCache(song.path, assetUrl);
    }
    ```

## 3. 更新后的后端逻辑 (`src-tauri/src/music.rs`)

### 关键变动

1.  **哈希生成优化 (`generate_hash`)**：
    *   现在结合了 **文件路径** + **文件修改时间 (mtime)** 生成 SHA256 哈希。
    *   这解决了旧版中文件内容变更但路径不变导致封面不更新的问题。

2.  **文件名规范**：
    *   缩略图：`{hash}_thumb.jpg` (100x100)
    *   原图：`{hash}_full.jpg` (原始尺寸)

3.  **Command 返回值**：
    *   `get_song_cover_thumbnail` 现在返回 `Result<String, String>`，成功时返回文件的**绝对路径**。
    *   不再进行 `fs::read` 和 `base64` 编码操作，大幅减少 Rust 端的内存分配和 CPU 占用。

## 4. 更新后的数据流向图

```mermaid
graph TD
    A[SongTable.vue] -->|Scroll & Watch| B[loadCoverDebounced]
    B -->|Check LRU Cache| C{Has Cache?}
    C -- Yes --> D[Display asset:// URL]
    C -- No --> E[Invoke 'get_song_cover_thumbnail']
    E --> F[Rust Backend]
    F --> G[Generate Hash (Path + Mtime)]
    F --> H{Check Disk Cache}
    H -- Exists --> I[Return File Path]
    H -- Missing --> J[Read Tag & Resize]
    J --> K[Save to '{hash}_thumb.jpg']
    K --> I
    I --> L[Frontend Receive Path]
    L --> M[convertFileSrc -> asset://...]
    M --> N[Update LRU Cache]
    N --> D
```

## 5. 性能提升总结

*   **内存占用大幅降低**：浏览器直接管理图片内存，不再在 JS 堆中存储巨大的 Base64 字符串。
*   **主线程不卡顿**：移除了大字符串的 Base64 解码和传输过程， IPC 消息体变得非常小（仅几十字节的路径字符串）。
*   **更智能的缓存**：LRU 机制防止了无限滚动的列表吃光内存；Modify Time 检测确保了封面数据的实时性。

---

# 📅 2025-12-26 (第二次更新) 性能与并发优化

在第一次逻辑优化的基础上，后端进一步引入了**并发控制**、**缓存自动清理**及**更鲁棒的哈希算法**，以解决大规模文件扫描时的 IO 瓶颈和磁盘占用问题。

## 1. 并发控制 (Semaphore)

为防止大量请求瞬间涌入导致系统卡顿，后端引入了信号量机制。

*   **机制**：`tokio::sync::Semaphore`
*   **实现**：
    *   定义了 `struct ImageConcurrencyLimit(pub Semaphore)`。
    *   `get_song_cover_thumbnail` 和 `get_song_cover` 命令在执行重 I/O 操作（读取音频标签、图片解码、缩放）前，必须先获取一个“许可证” (`permit`)。
    *   如果许可证已发完，请求会进入等待队列。这确保了同时进行图片生成的线程数受控。

## 2. 缓存自动清理 (Cache Cleanup)

增加了磁盘缓存的清理策略，防止 `covers` 文件夹无限膨胀。

*   **触发时机**：应用启动或特定事件触发 `run_cache_cleanup`。
*   **策略**：
    *   设定最大阈值：**500 MB**。
    *   如果缓存总大小超过阈值，按**最后访问时间/修改时间**排序。
    *   删除最旧的文件，直到总大小回到 500 MB 以下。
    *   操作在独立线程中运行，不阻塞主线程。

## 3. 哈希算法优化 (Robust Hash)

再次升级了哈希生成算法，使其对文件移动更鲁棒。

*   **旧算法**：依赖文件的绝对路径。文件移动会导致缓存失效。
*   **新算法**：基于 **文件内容指纹**。
    *   组合要素：`文件大小 (Size)` + `修改时间 (Mtime)` + `文件名 (Filename without path)`。
    *   **优势**：即使将音乐库从 `D:\Music` 移动到 `E:\Backup`，只要文件名和文件内容没变，生成的哈希值就不变，封面缓存依然命中，无需重新生成。

## 4. 总结

本次更新主要关注**稳定性**和**可维护性**。并发控制消除了高负载下的卡顿风险，缓存清理机制解决了长期使用的磁盘占用隐患，而新的哈希算法则提升了缓存的复用率和用户体验。
