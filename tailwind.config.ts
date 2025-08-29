import type { Config } from 'tailwindcss'
import colors from 'tailwindcss/colors'

const config: Config = {
  content: [
    './index.html',
    './src/**/*.{js,ts,jsx,tsx}',
  ],
  theme: {
    extend: {
      // Restore all default palettes
      colors: {
        blue: colors.blue,
        neutral: colors.neutral,
        gray: colors.gray,
        black: colors.black,
        white: colors.white,
      },
      fontSize: {
        'base-xl': '1.5rem', // for toast
      },
      borderRadius: {
        pill: '9999px', // pill shape
      },
    },
  },
  plugins: [],
}

export default config
