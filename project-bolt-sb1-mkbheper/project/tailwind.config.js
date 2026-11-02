/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#fffbeb',
          100: '#fef3c7',
          200: '#fde68a',
          300: '#fcd34d',
          400: '#fbbf24',
          500: '#f59e0b',
          600: '#d97706',
          700: '#b45309',
          800: '#92400e',
          900: '#78350f',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
      },
      animation: {
        float: 'float 4s ease-in-out infinite',
        'float-delay': 'float 4s ease-in-out 1.2s infinite',
        progress: 'progress 2.4s cubic-bezier(0.4, 0, 0.2, 1) forwards',
        'pulse-slow': 'pulseSlow 2s ease-in-out infinite',
      },
      keyframes: {
        float: {
          '0%, 100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-10px)' },
        },
        progress: {
          from: { width: '0%' },
          to: { width: '100%' },
        },
        pulseSlow: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.75' },
        },
      },
      boxShadow: {
        glow: '0 0 40px rgba(251, 191, 36, 0.15)',
        'glow-lg': '0 0 80px rgba(251, 191, 36, 0.2)',
      },
    },
  },
  plugins: [],
};
