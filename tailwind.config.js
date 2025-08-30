/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          main: 'hsl(221, 83%, 53%)',
          hover: 'hsl(221, 83%, 48%)',
          light: 'hsl(221, 83%, 96%)',
          dark: 'hsl(221, 83%, 15%)',
          DEFAULT: 'hsl(221, 83%, 53%)',
          foreground: 'hsl(0, 0%, 98%)',
        },
        privacy: {
          main: 'hsl(142, 71%, 45%)',
          hover: 'hsl(142, 71%, 40%)',
          light: 'hsl(142, 71%, 95%)',
          dark: 'hsl(142, 71%, 15%)',
          DEFAULT: 'hsl(142, 71%, 45%)',
          foreground: 'hsl(0, 0%, 98%)',
        },
        secondary: {
          main: 'hsl(256, 71%, 95%)',
          foreground: 'hsl(256, 71%, 15%)',
          DEFAULT: 'hsl(256, 71%, 95%)',
        },
        neutral: {
          50: 'hsl(210, 40%, 99%)',
          100: 'hsl(210, 40%, 96%)',
          200: 'hsl(214, 32%, 91%)',
          300: 'hsl(215, 16%, 65%)',
          400: 'hsl(215, 16%, 47%)',
          500: 'hsl(215, 25%, 27%)',
          600: 'hsl(215, 25%, 12%)',
          900: 'hsl(215, 25%, 4%)',
        },
        destructive: {
          DEFAULT: 'hsl(0 84% 60%)',
          foreground: 'hsl(0 0% 98%)',
        },
        muted: {
          DEFAULT: 'hsl(210 40% 96%)',
          foreground: 'hsl(215 16% 47%)',
        },
        accent: {
          DEFAULT: 'hsl(221 83% 96%)',
          foreground: 'hsl(221 83% 15%)',
        },
        popover: {
          DEFAULT: 'hsl(0 0% 100%)',
          foreground: 'hsl(215 25% 12%)',
        },
        card: {
          DEFAULT: 'hsl(0 0% 100%)',
          foreground: 'hsl(215 25% 12%)',
        },
        border: 'hsl(214 32% 91%)',
        input: 'hsl(214 32% 91%)',
        ring: 'hsl(221 83% 53%)',
      },
      spacing: {
        section: '5rem',
        component: '2rem',
        element: '1rem',
        tight: '0.5rem',
        loose: '3rem',
      },
      fontFamily: {
        sans: ['Inter', 'sans-serif'],
        mono: ['JetBrains Mono', 'monospace'],
      },
      fontSize: {
        hero: ['4.5rem', { lineHeight: '1.1', fontWeight: '800' }],
        display: ['3.5rem', { lineHeight: '1.2', fontWeight: '700' }],
        heading: ['2.25rem', { lineHeight: '1.3', fontWeight: '600' }],
        subheading: ['1.5rem', { lineHeight: '1.4', fontWeight: '500' }],
        body: ['1rem', { lineHeight: '1.6', fontWeight: '400' }],
        caption: ['0.875rem', { lineHeight: '1.5', fontWeight: '400' }],
      },
      boxShadow: {
        card: '0 4px 6px -1px hsl(221 83% 53% / 0.1), 0 2px 4px -1px hsl(221 83% 53% / 0.06)',
        feature: '0 10px 25px -3px hsl(221 83% 53% / 0.15), 0 4px 6px -2px hsl(221 83% 53% / 0.05)',
        hero: '0 25px 50px -12px hsl(221 83% 53% / 0.25)',
        navigation: '0 4px 6px -1px hsl(221 83% 53% / 0.1)',
        modal: '0 20px 25px -5px hsl(221 83% 53% / 0.1), 0 10px 10px -5px hsl(221 83% 53% / 0.04)',
      },
      borderRadius: {
        lg: '0.75rem',
        md: '0.5rem',
        sm: '0.25rem',
        pill: '9999px',
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
  plugins: [require('tailwindcss-animate')],
}
