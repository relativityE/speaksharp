import tailwindcssAnimate from "tailwindcss-animate"

/** @type {import('tailwindcss').Config} */
const config = {
  darkMode: ["class"],
  content: [
    './pages/**/*.{ts,tsx}',
    './components/**/*.{ts,tsx}',
    './app/**/*.{ts,tsx}',
    './src/**/*.{ts,tsx,js,jsx,mdx,css}',
    './index.html'
	],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        bg: '#F9FAFB',
        surface: '#FFFFFF',
        border: '#D1D5DB',
        text: '#111827',
        'text-muted': '#6B7280',
        primary: '#2563EB',
        'primary-hover': '#1D4ED8',
        secondary: '#9333EA',
        success: '#16A34A',
        warning: '#F59E0B',
        error: '#DC2626',
      },
      borderRadius: {
        DEFAULT: '4px'
      },
      boxShadow: {
        card: '0 1px 2px rgba(0,0,0,0.05)'
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif']
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [tailwindcssAnimate],
}

export default config
