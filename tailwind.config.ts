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
        // "The Final Run" — brass & teak. Warm metal on dark wood, replacing
        // the chrome/cyan chrome. Used across the HUD and every screen so the
        // game reads as one object.
        brass: {
          DEFAULT: "#C9A227",
          light: "#E8C46A",
          pale: "#F2DFA6",
          deep: "#8A6F1E",
        },
        copper: {
          DEFAULT: "#B87333",
          light: "#D99058",
        },
        teak: {
          DEFAULT: "#2B211A",
          light: "#3E3126",
          deep: "#150F0B",
        },
        /** the saffron of a prayer ribbon — the squat/duck signal colour */
        saffron: "#E8913A",
        /** frost on a fallen log — the jump signal colour */
        frost: "#A9C9D4",
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
        // landing dust: bigger throw + a brief scale-up before it fades, so
        // the touchdown reads heavy rather than as a polite puff
        fxDust: {
          '0%': { opacity: '1', transform: 'translate(0, 0) scale(0.6)' },
          '30%': { opacity: '0.95', transform: 'scale(1.25)' },
          '100%': {
            opacity: '0',
            transform: 'translate(var(--dx, 0px), var(--dy, -40px)) scale(0.45)',
          },
        },
        // beam whoosh-over: bold dark shadow RIPS top→bottom as the beam
        // passes overhead — the visceral half of clearing a duck
        fxStreak: {
          '0%': { opacity: '0', transform: 'translateY(-100%)' },
          '10%': { opacity: '1' },
          '70%': { opacity: '1' },
          '100%': { opacity: '0', transform: 'translateY(340%)' },
        },
        // jump speed-edge: partial-screen side bars sweeping down — replaces
        // the old fullscreen repeating-conic-gradient (a fullscreen repaint)
        fxEdge: {
          '0%': { opacity: '0', transform: 'translateY(-30%)' },
          '20%': { opacity: '0.7' },
          '100%': { opacity: '0', transform: 'translateY(60%)' },
        },
        // head-mode vignette pulse: static box-shadow, OPACITY-only animation
        fxPulse: {
          '0%': { opacity: '0' },
          '25%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        // sealed-Kosha gold wash: same opacity-only shape as fxPulse, but it
        // holds before it goes — a reward should linger where a stumble stings
        fxGold: {
          '0%': { opacity: '0' },
          '20%': { opacity: '1' },
          '55%': { opacity: '0.85' },
          '100%': { opacity: '0' },
        },
        cuePop: {
          '0%': { transform: 'scale(1.18)' },
          '100%': { transform: 'scale(1)' },
        },
      },
      animation: {
        'fade-up': 'fadeUp 0.5s ease-out',
        'slide-in': 'slideIn 0.3s ease-out',
        pulse: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'screen-in': 'screenIn 0.35s ease-out',
        'fx-dust': 'fxDust 0.38s ease-out forwards',
        'fx-streak': 'fxStreak 0.24s ease-in forwards',
        'fx-edge': 'fxEdge 0.35s ease-out forwards',
        'fx-pulse': 'fxPulse 0.4s ease-out forwards',
        'fx-gold': 'fxGold 0.55s ease-out forwards',
        'cue-pop': 'cuePop 0.2s ease-out',
      },
    },
  },
  plugins: [],
};
export default config;
