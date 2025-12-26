我想知道，软件是如何判别歌曲被插入到哪个位置？
软件通过监听鼠标在列表行上的移动位置，利用几何计算来精确判别插入点。具体的判别逻辑主要在 SongList.vue 的 onGlobalMouseMove 函数中实现。

以下是详细的判别步骤：

锁定目标行： 当你在列表中拖拽时，软件会实时检测鼠标下方的是哪一行（<tr> 元素）。 代码：const row = target?.closest('tr');

计算相对高度（关键逻辑）： 软件会计算鼠标指针距离当前行顶部的垂直距离 (relativeY)。 代码：const relativeY = e.clientY - rect.top;

上下半区判定： 软件将每一行的高度一分为二，通过判断鼠标是在行的上半部分还是下半部分来决定插入位置：

上半区（< 50%）：

判定：鼠标位于该行的上半部分。

逻辑：认为你想把歌插到这就行前面。

结果：insertIndex = 当前行的索引 (rowIndex)。

视觉：红线显示在该行的顶部。

下半区（>= 50%）：

判定：鼠标位于该行的下半部分。

逻辑：认为你想把歌插到这就行后面。

结果：insertIndex = 当前行的索引 + 1 (rowIndex + 1)。

视觉：红线显示在该行的底部。

代码依据：

TypeScript

if (relativeY < rect.height / 2) {
  dragSession.insertIndex = rowIndex;       // 插在当前行之前
  dragSession.sortLineTop = rowOffsetTop;
} else {
  dragSession.insertIndex = rowIndex + 1;   // 插在当前行之后
  dragSession.sortLineTop = rowOffsetTop + rowHeight;
}
最终执行： 当你松开鼠标（onGlobalMouseUp）时，软件会拿到这个计算好的 insertIndex，在数组中找到对应的位置，将你拖拽的歌曲插入进去。

总结： 并不是简单地“拖到哪行就在哪行”，而是精确到了行内位置。如果你拖到某首歌的“头上”，就插在它前面；拖到“脚下”，就插在它后面。


优化方案
为了达到“丝般顺滑”的专业级体验，建议引入以下优化：

1. 引入“死区”或“阈值” (Dead Zone / Hysteresis)
不要简单地用 50% 一刀切。可以设置一个中间区域，在这个区域内保持上一次的状态不变，防止抖动。

优化逻辑：

< 30%：绝对确认为“上半区”。

> 70%：绝对确认为“下半区”。

30% - 70%：中间地带。如果不希望过于灵敏，可以在这个区域保持红线位置不变（即锁定上一次的判定结果），或者在这个区域不显示红线（但这会导致死角）。

通常做法是引入滞后性：只有当鼠标明确跨过中线一定距离后，才切换状态。

2. 智能屏蔽“自身” (Ignore Self)
当鼠标悬停在正在被拖拽的那首歌（或选中的多首歌）身上时，隐藏排序红线。

优化逻辑：

TypeScript

// 伪代码思路
const draggingPaths = new Set(dragSession.songs.map(s => s.path));
const targetSongPath = displaySongList[rowIndex].path;

if (draggingPaths.has(targetSongPath)) {
    // 你正拖着自己在自己身上晃悠，啥也不显示
    dragSession.sortLineTop = -1;
    dragSession.insertIndex = -1;
    return;
}
这能大幅减少视觉干扰，告诉用户：“放这里没用”。

3. 视觉反馈升级：从“红线”到“占位符” (Placeholder)
目前的红线 (sort-line) 是一种比较“复古”的提示方式。现代应用（如 Notion, VS Code）倾向于实时腾出空间。

优化方案：

当计算出 insertIndex 时，不画红线，而是直接在列表中间撑开一个高度为 ROW_HEIGHT 的空白区域（利用 CSS 的 transform 或插入一个透明的 <li>）。

这能让用户所见即所得地看到“松手后它会长在哪”。

注：这需要改动 SongTable 的渲染逻辑，成本较高，目前的红线方案对于 MVP 来说已经足够好。

4. 列表边缘自动滚动 (Auto Scroll)
这是一个非常重要的交互细节。

问题：如果我想把第 1 首歌拖到第 100 首（屏幕外），目前的逻辑是：拖到底部，如果我不滚动滚轮，就没法继续往下拖。

优化：在 onGlobalMouseMove 中检测，如果鼠标逼近屏幕边缘（比如距离底部 < 50px），就自动让列表容器向下滚动。


