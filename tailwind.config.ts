import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: 'selector',
  content: [
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: "var(--color-background)",
        foreground: "var(--color-foreground)",
        primary: {
          DEFAULT: "var(--color-primary)",
          light: "var(--color-primary-light)",
        },
        surface: {
          DEFAULT: "var(--color-surface)",
          "2": "var(--color-surface-2)",
          "3": "var(--color-surface-3)",
        },
        muted: {
          DEFAULT: "var(--color-muted)",
          foreground: "var(--color-muted-foreground)",
        },
        accent: {
          green: "var(--color-accent-green)",
          red: "var(--color-accent-red)",
          orange: "var(--color-accent-orange)",
          purple: "var(--color-accent-purple)",
          cyan: "var(--color-accent-cyan)",
          teal: {
            DEFAULT: "var(--color-accent-teal)",
            hover: "var(--color-accent-teal-hover)",
            soft: "var(--color-accent-teal-soft)",
            border: "var(--color-accent-teal-border)",
            glow: "var(--color-accent-teal-glow)",
          },
          amber: {
            DEFAULT: "var(--color-accent-amber)",
            soft: "var(--color-accent-amber-soft)",
            border: "var(--color-accent-amber-border)",
          },
          danger: {
            DEFAULT: "var(--color-accent-danger)",
            soft: "var(--color-accent-danger-soft)",
            border: "var(--color-accent-danger-border)",
          },
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        heading: ['Space Grotesk', 'Inter', 'system-ui', 'sans-serif'],
      },
      backdropBlur: { glass: '20px' },
      boxShadow: {
        glass: '0 8px 32px 0 rgba(15, 23, 42, 0.37)',
        'glass-sm': '0 4px 16px 0 rgba(15, 23, 42, 0.25)',
      },
      borderRadius: { glass: '20px', 'glass-sm': '16px' },
      keyframes: {
        fadeUp: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        slideIn: {
          '0%': { opacity: '0', transform: 'translateX(-10px)' },
          '100%': { opacity: '1', transform: 'translateX(0)' },
        },
        pulse: {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        screenIn: {
          '0%': { opacity: '0', transform: 'translateY(6px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        fxLines: {
          '0%': { opacity: '0', transform: 'scale(1.12)' },
          '18%': { opacity: '0.85' },
          '100%': { opacity: '0', transform: 'scale(1)' },
        },
        fxDust: {
          '0%': { opacity: '0.9', transform: 'translate(0, 0) scale(1)' },
          '100%': {
            opacity: '0',
            transform: 'translate(var(--dx, 0px), var(--dy, -40px)) scale(0.5)',
          },
        },
        fxStreak: {
          '0%': { opacity: '0', transform: 'translateY(-60%)' },
          '25%': { opacity: '0.8' },
          '100%': { opacity: '0', transform: 'translateY(140%)' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.5s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'screen-in': 'screenIn 0.35s ease-out',
        'fx-lines': 'fxLines 0.4s ease-out forwards',
        'fx-dust': 'fxDust 0.5s ease-out forwards',
        'fx-streak': 'fxStreak 0.45s ease-in forwards',
      },
    },
  },
  plugins: [],
};
export default config;
