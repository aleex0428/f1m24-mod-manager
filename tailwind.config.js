/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Accent — Formula 1 red
        f1red: {
          DEFAULT: "#e10600",
          light: "#ff2a26",
          dark: "#a30400",
        },
        primary: {
          DEFAULT: "#e10600",
          hover: "#ff2a26",
        },
        // Base surfaces (darkest → lightest)
        bg: {
          DEFAULT: "#08090b",
          secondary: "#0c0e12",
          elevated: "#111318",
        },
        surface: {
          DEFAULT: "#14161c",
          raised: "#1a1d25",
          overlay: "#22262f",
        },
        border: {
          DEFAULT: "#23262e",
          subtle: "#191c22",
          strong: "#333846",
        },
        text: {
          primary: "#f2f3f5",
          secondary: "#a3a8b4",
          muted: "#6b7180",
        },
        warning: "#f59e0b",
        success: "#22c55e",
        danger: "#ef4444",
        info: "#38bdf8",
      },
      fontFamily: {
        // Local stacks only — remote fonts are blocked by the CSP.
        sans: [
          "Inter",
          "Segoe UI Variable Text",
          "Segoe UI",
          "system-ui",
          "sans-serif",
        ],
        display: [
          "Bahnschrift",
          "Segoe UI Variable Display",
          "Segoe UI Semibold",
          "Inter",
          "system-ui",
          "sans-serif",
        ],
        mono: ["Cascadia Mono", "Consolas", "ui-monospace", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in": "slideIn 0.25s ease-out",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 3s linear infinite",
        sweep: "sweep 1.4s linear infinite",
        "bar-stripes": "barStripes 1s linear infinite",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(12px) scale(0.98)" },
          "100%": { opacity: "1", transform: "translateY(0) scale(1)" },
        },
        slideIn: {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        sweep: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(400%)" },
        },
        barStripes: {
          "0%": { backgroundPosition: "0 0" },
          "100%": { backgroundPosition: "28px 0" },
        },
      },
      boxShadow: {
        f1: "0 0 20px rgba(225, 6, 0, 0.18)",
        "f1-strong": "0 0 34px rgba(225, 6, 0, 0.32)",
        surface: "0 8px 30px rgba(0, 0, 0, 0.45)",
        glow: "0 0 12px rgba(225, 6, 0, 0.4)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 10px 30px -12px rgba(0,0,0,0.8)",
      },
      borderRadius: {
        xl: "12px",
        "2xl": "16px",
      },
      backgroundImage: {
        "f1-hero": "linear-gradient(135deg, #0d0d0d 0%, #1a0000 50%, #0d0d0d 100%)",
        "grid-fine":
          "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "48px 48px",
      },
    },
  },
  plugins: [],
};
