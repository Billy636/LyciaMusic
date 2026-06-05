import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { getCurrentWindow } from '@tauri-apps/api/window'
import './style.css'
import '@applemusic-like-lyrics/core/style.css'
import App from './App.vue'
import router from './router'
import { applyPersistedStartupTheme, shouldApplyStartupThemePaint } from './composables/startupTheme'

const currentWindowLabel = (() => {
  try {
    return getCurrentWindow().label
  } catch {
    return 'main'
  }
})()

if (shouldApplyStartupThemePaint(currentWindowLabel)) {
  applyPersistedStartupTheme()
}

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')

const formatError = (error: unknown) => {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}${error.stack ? `\n\n${error.stack}` : ''}`
  }

  if (typeof error === 'string') {
    return error
  }

  try {
    return JSON.stringify(error, null, 2)
  } catch {
    return String(error)
  }
}

const showFatalError = (title: string, error: unknown) => {
  const message = formatError(error)
  console.error(title, error)

  try {
    localStorage.setItem('lycia_last_fatal_error', `${title}\n\n${message}`)
  } catch {
    // Ignore storage failures. The visible fallback is the important part.
  }

  const appRoot = document.getElementById('app')
  if (!appRoot) return

  appRoot.innerHTML = `
    <div style="height:100vh;display:flex;align-items:center;justify-content:center;padding:24px;background:#f5f5f5;color:#111827;font-family:'Segoe UI',system-ui,sans-serif;">
      <div style="width:min(920px,100%);background:#ffffff;border:1px solid rgba(17,24,39,0.08);border-radius:16px;box-shadow:0 20px 50px rgba(15,23,42,0.08);padding:24px;">
        <div style="font-size:20px;font-weight:600;margin-bottom:12px;">${escapeHtml(title)}</div>
        <div style="font-size:14px;line-height:1.6;color:#4b5563;margin-bottom:16px;">应用启动时发生异常。请把下面的错误信息反馈给开发者。</div>
        <pre style="margin:0;white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;padding:16px;border-radius:12px;background:#111827;color:#f9fafb;font-size:12px;line-height:1.6;">${escapeHtml(message)}</pre>
      </div>
    </div>
  `
}

const app = createApp(App)
const pinia = createPinia()

app.use(pinia)
app.use(router)
app.config.errorHandler = (error, _instance, info) => {
  showFatalError(`前端运行错误: ${info}`, error)
}

document.addEventListener('contextmenu', (e) => e.preventDefault())

window.addEventListener('error', (event) => {
  showFatalError('窗口脚本错误', event.error ?? event.message)
})

window.addEventListener('unhandledrejection', (event) => {
  showFatalError('未处理的异步错误', event.reason)
})

try {
  app.mount('#app')
} catch (error) {
  showFatalError('应用挂载失败', error)
}
