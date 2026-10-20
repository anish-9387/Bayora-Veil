/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}"
  ],
  theme: {
    extend: {
      colors: {
        bayora: {
          dark: '#0a0f1a',
          surface: '#111827',
          border: '#1f2937',
          primary: '#3b82f6',
          primaryHover: '#2563eb',
          success: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444',
          text: '#f3f4f6',
          textMuted: '#9ca3af'
        }
      }
    }
  },
  plugins: []
}