/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // Terminal dynamic themes powered by CSS variables
        term: {
          bg: "var(--bg)",
          panel: "var(--panel)",
          border: "var(--border)",
          fg: "var(--fg)",
          dim: "var(--dim)",
          system: "var(--system)",
          waiting: "var(--waiting)",
          error: "var(--error)",
          action: "var(--action)",
          magenta: "var(--magenta)",
        },
      },
      fontFamily: {
        mono: [
          "ui-monospace",
          "SFMono-Regular",
          "Menlo",
          "Consolas",
          "Liberation Mono",
          "monospace",
        ],
      },
      keyframes: {
        blink: {
          "0%, 49%": { opacity: "1" },
          "50%, 100%": { opacity: "0" },
        },
      },
      animation: {
        blink: "blink 1s steps(1) infinite",
      },
    },
  },
  plugins: [],
};