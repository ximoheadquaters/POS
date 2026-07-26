/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#F1F7F4',
          100: '#DDEBE4',
          200: '#B8D3C4',
          300: '#8FB8A1',
          500: '#386F55',
          600: '#2B6249',
          700: '#1A593B',
          800: '#164A32',
          900: '#103826',
        },
        slate: {
          50: '#F8F7F5',
          100: '#F0EEEA',
          200: '#DDD8D2',
          300: '#C7C0B8',
          400: '#81776E',
          500: '#6B6158',
          600: '#4C4239',
          700: '#3C342E',
          800: '#211D1A',
          900: '#000000',
        },
        earth: '#4C4239',
        ink: '#000000',
      },
    },
  },
  plugins: [],
};
