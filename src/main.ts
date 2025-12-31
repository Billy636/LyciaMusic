import { createApp } from 'vue'
import './style.css'
import App from './App.vue'
import router from './router' // 👈 1. 引入路由

const app = createApp(App)

app.use(router) // 👈 2. 使用路由



// 禁用全局默认右键菜单 (仅在生产环境下彻底禁用，或根据需求全局禁用)

// 如果需要保留开发模式下的调试，可以加上 if (import.meta.env.PROD)

document.addEventListener('contextmenu', (e) => e.preventDefault());



app.mount('#app')
