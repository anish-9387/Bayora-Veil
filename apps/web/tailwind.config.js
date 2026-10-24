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
          dark: '#f2f4f7',
          surface: '#ffffff',
          border: '#dce1e9',
          primary: { DEFAULT: '#334f75', hover: '#243b5b' },
          primaryHover: '#243b5b',
          success: '#15704b',
          warning: '#955b0d',
          danger: '#b52e45',
          text: { DEFAULT: '#222c3b', muted: '#626e80' },
          textMuted: '#626e80'
        }
      }
    }
  },
  plugins: []
}
