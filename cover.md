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
