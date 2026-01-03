修复反馈：修复不完整 (Feedback: Incomplete Fix)
标题：文件夹拖拽已修复，但歌单和歌手/专辑列表依然无效 (Folders Fixed, but Playlists & Artist Lists Still Broken)

1. 测试结果 (Test Results)

✅ 文件夹 (Folders): 修复成功！可以正常拖拽排序，且有 Ghost 效果。这证明你的 mousedown 自定义逻辑是可行的。

❌ 我的歌单 (Sidebar Playlists): 失败。APP 左侧边栏的“我的歌单”依然无法拖动（鼠标无反应）。

❌ 歌手/专辑页面的列表 (Artist/Album List View): 失败。在“本地音乐 -> 歌手”页面中，左侧的歌手列表（List View Sidebar）依然无法拖动。

❌ 排序菜单 (Sort Menu): 失败。点击右上角的三个点 ...，依然没有出现“按名称/按数量/自定义”的排序选项。

2. 问题分析与修复要求 (Analysis & Request)

A. 范围覆盖缺失 (Missing Scope in Sidebar.vue) 你可能只在“文件夹”组件上绑定了 mousedown 事件，但忘记了在“歌单”组件上绑定。

要求： 请检查 Sidebar.vue（或 SongListSidebar.vue），将文件夹 (Folder) 上的那个成功的 @mousedown="startDrag(...)" 逻辑，完全复制应用到歌单 (Playlist) 的 <li> 或 <div> 元素上。

B. 视图模式遗漏 (Missing Scope in Artists.vue/Albums.vue) 你可能只修复了歌手/专辑的“网格视图 (Grid View/Cards)”，但忽略了“列表视图 (List View)”。

要求： 请检查 Artists.vue 和 Albums.vue。

用户指的是左侧的导航列表（即点击切换歌手的地方）。

请确保这个列表项 (List Items) 也绑定了 startDrag 事件，并支持拖拽。

C. 菜单渲染逻辑 (Menu Logic) 菜单依然不显示，说明这不仅仅是 z-index 的问题，可能是 v-if 条件判断错误。

要求： 请检查代码，确保“排序选项”的 v-if 条件在数据加载完成后为 true。如果逻辑太复杂，请暂时移除 v-if，让菜单先强制显示出来以便调试。

总结： 请不要只改底层逻辑，必须把 UI 层面的事件绑定 (Event Binding) 覆盖到每一个需要拖拽的组件上。请参照“文件夹”的成功代码，把剩下两个地方补全。

Important notes:
it is Tauri v2.0 project,please remember it !

While making these changes, please ensure that none of the existing features stop working.

Do not make any single file excessively long. Use a refactoring-oriented approach so that the codebase remains clean, modular, and easy to manage and read.