import type { Config } from 'tailwindcss'
import colors from 'tailwindcss/colors'

const config: Config = {
  content: [
    './pages//*.{js,ts,jsx,tsx,mdx}',
    './components//.{js,ts,jsx,tsx,mdx}',
    './app/**/.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a'
        },
        purple: {
          50: '#faf5ff',
          100: '#f3e8ff',
          200: '#e9d5ff',
          300: '#d8b4fe',
          400: '#c084fc',
          500: '#a855f7',
          600: '#9333ea',
          700: '#7c3aed',
          800: '#6b21a8',
          900: '#581c87'
        },
        green: {
          50: '#ecfdf5',
          100: '#d1fae5',
          200: '#a7f3d0',
          300: '#6ee7b7',
          400: '#34d399',
          500: '#10b981',
          600: '#059669',
          700: '#047857',
          800: '#065f46',
          900: '#064e3b'
        },
        orange: {
          50: '#fff7ed',
          100: '#ffedd5',
          200: '#fed7aa',
          300: '#fdba74',
          400: '#fb923c',
          500: '#f97316',
          600: '#ea580c',
          700: '#c2410c',
          800: '#9a3412',
          900: '#7c2d12'
        },
        red: {
          50: '#fef2f2',
          100: '#fee2e2',
          200: '#fecaca',
          300: '#fca5a5',
          400: '#f87171',
          500: '#ef4444',
          600: '#dc2626',
          700: '#b91c1c',
          800: '#991b1b',
          900: '#7f1d1d'
        },
        gray: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827'
        }
      },
      spacing: {
        0: '0',
        1: '0.25rem',
        2: '0.5rem',
        3: '0.75rem',
        4: '1rem',
        5: '1.25rem',
        6: '1.5rem',
        8: '2rem',
        10: '2.5rem',
        12: '3rem',
        16: '4rem',
        20: '5rem',
        24: '6rem',
        32: '8rem',
        40: '10rem',
        48: '12rem',
        56: '14rem',
        64: '16rem'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', '-apple-system', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'Monaco', 'monospace']
      },
      fontSize: {
        xs: '0.75rem',
        sm: '0.875rem',
        base: '1rem',
        lg: '1.125rem',
        xl: '1.25rem',
        '2xl': '1.5rem',
        '3xl': '1.875rem',
        '4xl': '2.25rem',
        '5xl': '3rem',
        '6xl': '3.75rem'
      },
      fontWeight: {
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700'
      },
      lineHeight: {
        tight: '1.2',
        normal: '1.5',
        relaxed: '1.625'
      },
      letterSpacing: {
        tight: '-0.025em',
        normal: '0',
        wide: '0.025em'
      },
      keyframes: {
        'accordion-down': {
          from: { height: '0' },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: '0' },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [
    require('tailwindcss-animate'),
    function ({ addComponents, theme }) {
      addComponents({
        // Buttons
        '.btn-primary': {
          '@apply bg-primary-600 text-white hover:bg-primary-700 shadow-lg font-semibold': {},
        },
        '.btn-secondary': {
          '@apply border-2 border-gray-300 text-gray-700 hover:border-primary-600 hover:text-primary-600 font-semibold': {},
        },
        '.btn-destructive': {
            '@apply bg-red-500 text-white hover:bg-red-600 shadow-lg font-semibold': {},
        },
        '.btn-outline': {
            '@apply border border-primary-600 bg-transparent text-primary-600 hover:bg-primary-100 font-semibold': {},
        },
        '.btn-ghost': {
          '@apply text-gray-700 hover:text-primary-600': {},
        },
        '.btn-accent': {
          '@apply bg-gradient-to-r from-primary-600 to-purple-600 text-white hover:shadow-lg font-semibold': {},
        },
        // Button Sizes
        '.btn-sm': {
            '@apply h-8 px-3 text-sm': {},
        },
        '.btn-md': {
            '@apply h-9 px-4 py-2 text-base': {},
        },
        '.btn-lg': {
            '@apply h-10 px-6 text-lg': {},
        },

        // Cards
        '.card-default': {
          '@apply bg-white p-8 rounded-2xl border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1': {},
        },
        '.card-feature': {
          '@apply group p-8 rounded-2xl border border-gray-100 hover:border-primary-200 hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1': {},
        },
        '.card-testimonial': {
          '@apply bg-white p-8 rounded-2xl border border-gray-100 shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1': {},
        },
        '.card-pricing': {
          '@apply relative bg-white rounded-2xl shadow-lg hover:shadow-xl transition-all duration-300 transform hover:-translate-y-1': {},
        },

        // Badges
        '.badge-success': {
          '@apply bg-green-100 text-green-800 px-4 py-2 rounded-full text-sm font-medium': {},
        },
        '.badge-primary': {
          '@apply bg-primary-100 text-primary-800 px-4 py-2 rounded-full text-sm font-medium': {},
        },
        '.badge-accent': {
          '@apply bg-purple-100 text-purple-800 px-4 py-2 rounded-full text-sm font-medium': {},
        },

        // Icon Containers
        '.icon-container-sm': {
          '@apply w-12 h-12 rounded-xl flex items-center justify-center': {},
        },
        '.icon-container-md': {
          '@apply w-16 h-16 rounded-xl flex items-center justify-center': {},
        },
        '.icon-container-lg': {
          '@apply w-20 h-20 rounded-xl flex items-center justify-center': {},
        },

        // Backgrounds
        '.bg-gradient-speaksharp': {
          '@apply bg-gradient-to-br from-primary-50 via-white to-purple-50': {},
        },
        '.bg-solid-light': {
          '@apply bg-gray-50': {},
        },
        '.bg-solid-white': {
          '@apply bg-white': {},
        },
        '.bg-glassmorphism': {
          '@apply bg-white/70 backdrop-blur-sm': {},
        },

        // Animations
        '.anim-fade-in-up': {
          '@apply animate-fade-in-up': {},
        },
        '.anim-scale-on-hover': {
          '@apply transform hover:scale-105 transition-transform duration-200': {},
        },
        '.anim-slide-up': {
          '@apply transform hover:-translate-y-1 transition-transform duration-300': {},
        },
        '.anim-icon-scale': {
          '@apply transform group-hover:scale-110 transition-transform duration-300': {},
        },

        // Typography
        '.h1': { '@apply text-4xl sm:text-5xl lg:text-6xl font-bold text-gray-900 leading-tight': {} },
        '.h2': { '@apply text-3xl sm:text-4xl font-bold text-gray-900 leading-tight': {} },
        '.h3': { '@apply text-2xl sm:text-3xl font-bold text-gray-900 leading-tight': {} },
        '.h4': { '@apply text-xl font-semibold text-gray-900': {} },
        '.body-lg': { '@apply text-xl text-gray-600 leading-relaxed': {} },
        '.body': { '@apply text-gray-600 leading-normal': {} },
        '.body-sm': { '@apply text-sm text-gray-600': {} },
        '.text-accent': { '@apply bg-gradient-to-r from-primary-600 to-purple-600 bg-clip-text text-transparent': {} },
        '.caption': { '@apply text-sm text-gray-500': {} },

        // Toasts (migrated from old plugin)
        ".toast": {
          borderRadius: "9999px",
          color: "white",
          fontWeight: "500",
          boxShadow: "0 1px 3px rgba(0,0,0,0.1), 0 1px 2px rgba(0,0,0,0.06)",
          transition: "all 0.2s ease-in-out",
        },
        ".toast-sm": {
          fontSize: "0.875rem",
          padding: "0.5rem 1rem",
        },
        ".toast-md": {
          fontSize: "1rem",
          padding: "0.75rem 1.5rem",
        },
        ".toast-lg": {
          fontSize: "1.125rem",
          padding: "1rem 2rem",
        },
        ".toast-success": {
          backgroundColor: theme('colors.green.500'),
        },
        ".toast-error": {
          backgroundColor: theme('colors.red.500'),
        },
        ".toast-warning": {
          backgroundColor: theme('colors.orange.500'),
          color: theme('colors.gray.900'),
        },
        ".toast-info": {
          backgroundColor: theme('colors.primary.500'),
        },
      });
    },
  ],
}

export default config
