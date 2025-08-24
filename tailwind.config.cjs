const { fontFamily } = require("tailwindcss/defaultTheme")

/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './pages/**/*.{js,jsx}',
    './components/**/*.{js,jsx}',
    './app/**/*.{js,jsx}',
    './src/**/*.{js,jsx}',
  ],
  theme: {
    // Overriding the entire theme block to replace the spacing scale
    spacing: {
      px: '1px',
      '0': '0',
      '0.5': '0.03125rem', // 0.125rem / 4
      '1': '0.0625rem',   // 0.25rem / 4
      '1.5': '0.09375rem', // 0.375rem / 4
      '2': '0.125rem',    // 0.5rem / 4
      '2.5': '0.15625rem', // 0.625rem / 4
      '3': '0.1875rem',   // 0.75rem / 4
      '3.5': '0.21875rem', // 0.875rem / 4
      '4': '0.25rem',     // 1rem / 4
      '5': '0.3125rem',   // 1.25rem / 4
      '6': '0.375rem',    // 1.5rem / 4
      '7': '0.4375rem',   // 1.75rem / 4
      '8': '0.5rem',      // 2rem / 4
      '9': '0.5625rem',   // 2.25rem / 4
      '10': '0.625rem',   // 2.5rem / 4
      '11': '0.6875rem',   // 2.75rem / 4
      '12': '0.75rem',    // 3rem / 4
      '14': '0.875rem',   // 3.5rem / 4
      '16': '1rem',       // 4rem / 4
      '20': '1.25rem',    // 5rem / 4
      '24': '1.5rem',     // 6rem / 4
      '28': '1.75rem',    // 7rem / 4
      '32': '2rem',       // 8rem / 4
      '36': '2.25rem',    // 9rem / 4
      '40': '2.5rem',     // 10rem / 4
      '44': '2.75rem',    // 11rem / 4
      '48': '3rem',       // 12rem / 4
      '52': '3.25rem',    // 13rem / 4
      '56': '3.5rem',     // 14rem / 4
      '60': '3.75rem',    // 15rem / 4
      '64': '4rem',       // 16rem / 4
      '72': '4.5rem',     // 18rem / 4
      '80': '5rem',       // 20rem / 4
      '96': '6rem',       // 24rem / 4
    },
    extend: {
      spacing: {
        'component-px': 'var(--component-padding-x)',
        'component-py': 'var(--component-padding-y)',
        'component-gap': 'var(--component-gap)',
      },
      fontSize: {
        'xs': '0.1875rem', // 0.75rem / 4
        'sm': '0.21875rem', // 0.875rem / 4
        'base': '0.25rem',  // 1rem / 4
        'lg': '0.28125rem', // 1.125rem / 4
        'xl': '0.3125rem',  // 1.25rem / 4
        '2xl': '0.375rem',  // 1.5rem / 4
        '3xl': '0.46875rem',// 1.875rem / 4
        '4xl': '0.5625rem', // 2.25rem / 4
        '5xl': '0.75rem',   // 3rem / 4
        '6xl': '1rem',      // 4rem / 4
        '7xl': '1.25rem',   // 5rem / 4
      },
      boxShadow: {
        'glow-lime-md': '0 0 8px hsl(var(--primary) / 0.5)',
        'glow-lime-lg': '0 0 15px hsl(var(--primary) / 0.7)',
      },
      fontFamily: {
        sans: ["Inter", ...fontFamily.sans],
      },
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
}
