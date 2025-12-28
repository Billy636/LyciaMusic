/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{vue,js,ts,jsx,tsx}", // 确保这里包含了 ts 和 tsx
  ],
  theme: {
    extend: {
      colors: {
        'netease-red': '#EC4141',
        'sidebar-bg': '#f5f5f7',
        'player-bg': '#ffffff',
      }
    },
  },
  plugins: [],
}