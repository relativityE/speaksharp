import animatePlugin from "tailwindcss-animate";
export default {
    darkMode: "class",
    content: [
        './index.html',
        "./pages/**/*.{ts,tsx}",
        "./components/**/*.{ts,tsx}",
        "./app/**/*.{ts,tsx}",
        "./src/**/*.{ts,tsx}"
    ],
    prefix: "",
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
                border: "hsl(var(--border))",
                input: "hsl(var(--input))",
                ring: "hsl(var(--ring))",
                background: "hsl(var(--background))",
                foreground: "hsl(var(--foreground))",
                primary: {
                    DEFAULT: "hsl(var(--primary))",
                    foreground: "hsl(var(--primary-foreground))",
                    light: "hsl(var(--primary-light))",
                    dark: "hsl(var(--primary-dark))",
                },
                secondary: {
                    DEFAULT: "hsl(var(--secondary))",
                    foreground: "hsl(var(--secondary-foreground))",
                    light: "hsl(var(--secondary-light))",
                    dark: "hsl(var(--secondary-dark))",
                },
                accent: {
                    DEFAULT: "hsl(var(--accent))",
                    foreground: "hsl(var(--accent-foreground))",
                    light: "hsl(var(--accent-light))",
                    dark: "hsl(var(--accent-dark))",
                },
                destructive: {
                    DEFAULT: "hsl(var(--destructive))",
                    foreground: "hsl(var(--destructive-foreground))",
                },
                muted: {
                    DEFAULT: "hsl(var(--muted))",
                    foreground: "hsl(var(--muted-foreground))",
                },
                popover: {
                    DEFAULT: "hsl(var(--popover))",
                    foreground: "hsl(var(--popover-foreground))",
                },
                card: {
                    DEFAULT: "hsl(var(--card))",
                    foreground: "hsl(var(--card-foreground))",
                },
                sidebar: {
                    DEFAULT: "hsl(var(--sidebar-background))",
                    foreground: "hsl(var(--sidebar-foreground))",
                    primary: "hsl(var(--sidebar-primary))",
                    "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
                    accent: "hsl(var(--sidebar-accent))",
                    "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
                    border: "hsl(var(--sidebar-border))",
                    ring: "hsl(var(--sidebar-ring))",
                },
                // #1480 shared colour roles (Landing Rev 2 §1). Values live ONLY in index.css `--brand-*`.
                signature: {
                    DEFAULT: "var(--brand-signature)",
                    text: "var(--brand-signature-text)",
                    ground: "var(--brand-signature-ground)",
                    border: "var(--brand-signature-border)",
                },
                ink: {
                    DEFAULT: "var(--brand-ink)",
                    raised: "var(--brand-ink-raised)",
                    hairline: "var(--brand-ink-hairline)",
                    text: "var(--brand-ink-text)",
                    muted: "var(--brand-ink-muted)",
                },
                money: {
                    DEFAULT: "var(--brand-money)",
                    soft: "var(--brand-money-soft)",
                    "on-ink": "var(--brand-money-on-ink)",
                },
                status: {
                    DEFAULT: "var(--brand-status)",
                },
                // Merged into Tailwind's built-in `neutral` scale; the numeric steps are untouched.
                neutral: {
                    page: "var(--brand-neutral-page)",
                    band: "var(--brand-neutral-band)",
                    border: "var(--brand-neutral-border)",
                    "border-soft": "var(--brand-neutral-border-soft)",
                    "border-strong": "var(--brand-neutral-border-strong)",
                    heading: "var(--brand-neutral-heading)",
                    body: "var(--brand-neutral-body)",
                    secondary: "var(--brand-neutral-secondary)",
                    muted: "var(--brand-neutral-muted)",
                },
                // #1480 Designer rulings (15 Sep): reserved and system colours, all from the shared --brand-* source.
                record: {
                    DEFAULT: "var(--brand-record)",
                    text: "var(--brand-record-text)",
                },
                progress: {
                    DEFAULT: "var(--brand-status)",
                    bar: "var(--brand-progress-bar)",
                },
                regression: {
                    DEFAULT: "var(--brand-regression)",
                },
                // System states. Named `state` because a bare `success` key would retro-colour existing classes.
                state: {
                    error: "var(--brand-error)",
                    "error-ground": "var(--brand-error-ground)",
                    "error-border": "var(--brand-error-border)",
                    success: "var(--brand-status)",
                    "success-ground": "var(--brand-success-ground)",
                    "success-border": "var(--brand-success-border)",
                },
                surface: {
                    landing: "var(--brand-neutral-page)",
                    session: "var(--brand-surface-session)",
                    "session-text": "var(--brand-surface-session-text)",
                },
                // Metric palette: a metric keeps one colour everywhere (chart, rail, review card).
                metric: {
                    fillers: "var(--brand-signature)",
                    pace: "var(--brand-ink-hairline)",
                    "pace-on-ink": "var(--brand-ink-muted)",
                    clarity: "var(--brand-metric-clarity)",
                    baseline: "var(--brand-neutral-border-strong)",
                },
                chart: {
                    grid: "var(--brand-neutral-border-soft)",
                    axis: "var(--brand-neutral-secondary)",
                    zero: "var(--brand-neutral-border-strong)",
                },
                // Focus Points identity (app routes only). Named `focus-points` so it cannot be read as keyboard focus.
                "focus-points": {
                    DEFAULT: "var(--brand-focus)",
                    strong: "var(--brand-focus-strong)",
                    ground: "var(--brand-focus-ground)",
                    border: "var(--brand-focus-border)",
                },
            },
            backgroundImage: {
                'gradient-primary': 'var(--gradient-primary)',
                'gradient-secondary': 'var(--gradient-secondary)',
                'gradient-accent': 'var(--gradient-accent)',
                'gradient-hero': 'var(--gradient-hero)',
                'gradient-subtle': 'var(--gradient-subtle)',
            },
            boxShadow: {
                'elegant': 'var(--shadow-elegant)',
                'focus': 'var(--shadow-focus)',
                'card': 'var(--shadow-card)',
                'glow': '0 0 20px rgba(53, 183, 243, 0.3)',
                'cyan-glow': '0 0 20px rgba(53, 183, 243, 0.4)',
                'yellow-glow': '0 0 20px rgba(238, 189, 43, 0.4)',
            },
            minHeight: {
                'double': '600px',
                'half': '300px',
            },
            transitionTimingFunction: {
                'smooth': 'cubic-bezier(0.4, 0, 0.2, 1)',
                'bounce': 'cubic-bezier(0.68, -0.55, 0.265, 1.55)',
            },
            borderRadius: {
                lg: "var(--radius)",
                md: "calc(var(--radius) - 2px)",
                sm: "calc(var(--radius) - 4px)",
            },
            keyframes: {
                "accordion-down": {
                    from: {
                        height: "0",
                    },
                    to: {
                        height: "var(--radix-accordion-content-height)",
                    },
                },
                "accordion-up": {
                    from: {
                        height: "var(--radix-accordion-content-height)",
                    },
                    to: {
                        height: "0",
                    },
                },
                "pulse-ring": {
                    "0%": { transform: "scale(0.8)", opacity: "0.5" },
                    "100%": { transform: "scale(2)", opacity: "0" },
                },
                "fade-in-up": {
                    "0%": { opacity: "0", transform: "translateY(10px)" },
                    "100%": { opacity: "1", transform: "translateY(0)" },
                },
            },
            animation: {
                "accordion-down": "accordion-down 0.2s ease-out",
                "accordion-up": "accordion-up 0.2s ease-out",
                "pulse-ring": "pulse-ring 2s cubic-bezier(0.4, 0, 0.6, 1) infinite",
                "fade-in-up": "fade-in-up 0.5s ease-out forwards",
            },
        },
    },
    plugins: [animatePlugin],
};
