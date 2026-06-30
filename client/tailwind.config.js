/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      colors: {
        papaya: { DEFAULT: '#F97316', light: '#FF8A3D', deep: '#EA6A0E', burnt: '#C2410C', coral: '#FFB085' },
        cream: { DEFAULT: '#FFF7ED', soft: '#FFFBF5', warm: '#F8F4EF' },
        espresso: { DEFAULT: '#0E0704', panel: '#1A0F0A', char: '#231813' },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
