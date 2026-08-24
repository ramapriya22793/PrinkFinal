/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#FF304C',
          light: '#FF4D65',
          dark: '#E62B44',
          soft: '#FFEAF0'
        },
        navy: {
          DEFAULT: '#0B0F33',
          light: '#1B215A',
        }
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        'premium': '0 10px 40px -10px rgba(0,0,0,0.08)',
        'soft': '0 4px 20px -5px rgba(0,0,0,0.05)',
      }
    },
  },
  plugins: [],
}
