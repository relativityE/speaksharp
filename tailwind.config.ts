import type { Config } from 'tailwindcss'
import { speakSharpTheme } from './src/lib/theme'
const defaultTheme = require('tailwindcss/defaultTheme')

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
    './src/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: speakSharpTheme.layout.containers,
    },
    extend: {
      colors: speakSharpTheme.colors,
      spacing: speakSharpTheme.layout.spacing,
      fontFamily: {
        sans: [speakSharpTheme.typography.fontFamily.primary, ...defaultTheme.fontFamily.sans],
        mono: [speakSharpTheme.typography.fontFamily.mono, ...defaultTheme.fontFamily.mono],
      },
      fontSize: Object.fromEntries(
        Object.entries(speakSharpTheme.typography.scale).map(([name, { size, weight, lineHeight }]) => [
          name,
          [size, { lineHeight, fontWeight: weight }],
        ])
      ),
      boxShadow: speakSharpTheme.shadows,
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
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

export default config
