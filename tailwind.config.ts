import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        app: "rgb(var(--bg-app) / <alpha-value>)",
        surface: "rgb(var(--bg-surface) / <alpha-value>)",
        surface2: "rgb(var(--bg-surface-2) / <alpha-value>)",
        edge: "rgb(var(--border) / <alpha-value>)",
        ink: {
          100: "rgb(var(--text-primary) / <alpha-value>)",
          300: "rgb(var(--text-muted) / <alpha-value>)",
          500: "rgb(var(--text-faint) / <alpha-value>)",
        },
        bitcoin: {
          DEFAULT: "#F7931A",
          dim: "#8A5818",
          glow: "#FFB347",
        },
        bull: {
          DEFAULT: "#2DD4A7",
          dim: "#14463C",
        },
        bear: {
          DEFAULT: "#F4495C",
          dim: "#4A1820",
        },
      },
      fontFamily: {
        mono: ["IBM Plex Mono", "ui-monospace", "SFMono-Regular", "monospace"],
        sans: ["Space Grotesk", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(247,147,26,0.25), 0 0 24px -4px rgba(247,147,26,0.35)",
      },
    },
  },
  plugins: [],
};

export default config;
