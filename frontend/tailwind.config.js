/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        /* Obsidian color palette */
        obsidian: {
          bg: '#0d0d0d',
          surface: '#1a1a1a',
          'surface-hover': '#252525',
          border: '#2d2d2d',
          text: '#e0e0e0',
          'text-muted': '#8b8b8b',
          accent: '#7c3aed',
          'accent-light': '#a855f7',
          success: '#0fb981',
          warning: '#f39c12',
          error: '#e74c3c',
        },
        /* Override gray for dark theme */
        gray: {
          900: "#0d0d0d",
          950: "#0a0a0a",
        },
      },
      animation: {
        'pulse-ring': 'pulse-ring 2s infinite',
        'fade-in': 'fade-in 0.3s ease-in-out',
        'slide-in-right': 'slide-in-right 0.3s ease-out',
      },
      keyframes: {
        'pulse-ring': {
          '0%, 100%': { transform: 'scale(1)', opacity: '1' },
          '50%': { transform: 'scale(1.05)', opacity: '0.8' },
        },
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'slide-in-right': {
          '0%': { transform: 'translateX(100%)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
      },
    },
  },
  plugins: [],
}
