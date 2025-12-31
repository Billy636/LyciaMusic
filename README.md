# LyciaMusic 🎵

A modern, high-performance desktop local music player built with **Tauri v2.0**, **Vue 3**, and **TypeScript**. Designed for beauty, speed, and a native desktop experience.

![LyciaMusic Preview](app.png)

## ✨ Key Features

### 🎨 Aesthetic & Immersive UI
*   **Dynamic Background System**: Experience fluid, Apple Music-style mesh gradients that evolve based on album art colors. Supports static blur and custom user skins.
*   **Glassmorphism Design**: A polished, translucent interface that blends perfectly with your desktop environment.
*   **Responsive Layout**: A sidebar-driven navigation with a docked "Drawer-style" play queue for seamless interaction.

### 🚀 Performance Optimized
*   **Zero-Wait Startup**: Integrated theme-aware skeleton screens eliminate initial white flashes.
*   **Smart Loading**: Route-based lazy loading and asynchronous component mounting ensure the app stays snappy.
*   **Concurrency Control**: Backend image processing is throttled using Rust semaphores to prevent CPU spikes during library scans.

### 🛠️ Native Desktop Integration
*   **System Tray**: Fully integrated tray icon with window controls and quick actions.
*   **Local Management**: High-performance music file scanning, metadata extraction, and physical file organization.
*   **Advanced UX**: Custom context menus with smart boundary detection (auto-flip) and disabled browser defaults for a true native feel.
*   **Desktop Lyrics**: High-quality floating lyrics overlay for a distraction-free listening experience.

## 💻 Tech Stack

- **Frontend**: Vue 3 (Composition API), Vite, TypeScript, Tailwind CSS 4.0.
- **Backend**: Rust, Tauri v2.0 (Beta/Stable).
- **Storage**: SQLite (via `rusqlite`) for library management, LocalStorage for UI state.
- **Audio Engine**: `rodio` (Rust audio playback library).

## 🚀 Getting Started

### Prerequisites
- [Node.js](https://nodejs.org/) (v18+)
- [Rust](https://www.rust-lang.org/tools/install) (latest stable)
- WebView2 (included in Windows 10/11)

### Installation
1.  Clone the repository:
    ```bash
    git clone https://github.com/yourusername/my-cloud-music.git
    cd my-cloud-music
    ```
2.  Install dependencies:
    ```bash
    npm install
    ```

### Development
Run the app in development mode:
```bash
npm run tauri dev
```

### Build
Generate a production executable:
```bash
npm run tauri build
```

## 📂 Project Structure

```plaintext
├── src/                # Frontend (Vue 3 + TS)
│   ├── components/     # Modular UI components
│   ├── composables/    # Shared logic (Player state, Color extraction)
│   ├── types/          # TypeScript definitions
│   └── views/          # Page-level containers
├── src-tauri/          # Backend (Rust)
│   ├── src/            # Rust logic (Audio engine, File IO, Database)
│   └── tauri.conf.json # App configuration
└── 项目结构.md         # Detailed developer documentation
```

## 📜 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

---
*Last Updated: 2025-12-31*
