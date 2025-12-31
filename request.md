"刚才拉取代码试运行了一下，编译报错了。问题出在 PlayQueueSidebar.vue 的第 46 行。

在 :style 动态绑定里，对象键名如果包含连字符（比如 min-height），必须加引号，或者改成驼峰写法。现在的写法导致 Vite 解析失败了。

报错代码： min-height: '200px'

修正建议： 把它改成 'min-height': '200px' 或者 minHeight: '200px' 就可以了。"

Important notes:
it is Tauri v2.0,please remember it !

While making these changes, please ensure that none of the existing features stop working.

Do not make any single file excessively long. Use a refactoring-oriented approach so that the codebase remains clean, modular, and easy to manage and read.