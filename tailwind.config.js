/** @type {import('tailwindcss').Config} */

/*
 * Design tokens.
 *
 * Everything visual is named here so a value is defined once and reused, and
 * so a sweep like "make every micro-label one step larger" is a single edit
 * rather than a hunt through 25 files. The rules that hold the system
 * together:
 *
 *  - Type: only the steps below. No arbitrary `text-[13px]` in components —
 *    if a size is missing it belongs in this scale, not in a class.
 *  - Space: Tailwind's own 4px scale, used in whole steps (2/3/4/5/6).
 *  - Elevation: `shadow-elev-0..3`. Higher means further from the page:
 *    0 flat rows, 1 cards, 2 popovers and menus, 3 modals.
 *  - Motion: `duration-fast|base|slow` with `ease-out-expo`, never bare
 *    millisecond values.
 */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // Accent — Formula 1 red.
        // `accent` reads through CSS variables so the shade can be tuned in
        // one place; f1red stays as the literal for gradients and shadows.
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
          // Lifted from #6b7180: the old value fell under 4.5:1 against the
          // raised surfaces it was used on, and it carries the smallest text
          // in the app.
          muted: "#7d8494",
        },
        warning: "#f59e0b",
        success: "#22c55e",
        danger: "#ef4444",
        info: "#38bdf8",
      },

      /* ── Type scale ──────────────────────────────────────────
         Eight steps, each with its own line height. 11px is the floor:
         nothing in the app may be smaller, which is why the old
         `text-[10px]` labels moved up to `text-2xs`. */
      fontSize: {
        "2xs": ["11px", { lineHeight: "1.45", letterSpacing: "0.01em" }],
        xs: ["12px", { lineHeight: "1.5" }],
        sm: ["14px", { lineHeight: "1.55" }],
        md: ["15px", { lineHeight: "1.5" }],
        base: ["16px", { lineHeight: "1.5" }],
        lg: ["18px", { lineHeight: "1.4" }],
        xl: ["20px", { lineHeight: "1.35" }],
        "2xl": ["24px", { lineHeight: "1.25", letterSpacing: "-0.01em" }],
        "3xl": ["30px", { lineHeight: "1.2", letterSpacing: "-0.02em" }],
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

      /* ── Motion ──────────────────────────────────────────────
         Three durations and one signature curve. `ease-out-expo` is the
         decelerating curve used for anything that enters; state changes on
         something already on screen use the shorter durations with it too. */
      transitionDuration: {
        fast: "120ms",
        base: "200ms",
        slow: "320ms",
      },
      transitionTimingFunction: {
        "out-expo": "cubic-bezier(0.16, 1, 0.3, 1)",
        "in-out-soft": "cubic-bezier(0.4, 0, 0.2, 1)",
      },

      animation: {
        "fade-in": "fadeIn 0.2s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-up": "slideUp 0.28s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-in": "slideIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)",
        "slide-down": "slideDown 0.18s cubic-bezier(0.16, 1, 0.3, 1)",
        "scale-in": "scaleIn 0.16s cubic-bezier(0.16, 1, 0.3, 1)",
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        "spin-slow": "spin 3s linear infinite",
        sweep: "sweep 1.4s linear infinite",
        "bar-stripes": "barStripes 1s linear infinite",
        /* Rows enter with a delay set per index — see `.stagger` in index.css. */
        "row-in": "rowIn 0.34s cubic-bezier(0.16, 1, 0.3, 1) backwards",
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
        slideDown: {
          "0%": { opacity: "0", transform: "translateY(-6px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        slideIn: {
          "0%": { opacity: "0", transform: "translateX(-8px)" },
          "100%": { opacity: "1", transform: "translateX(0)" },
        },
        scaleIn: {
          "0%": { opacity: "0", transform: "scale(0.96)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        rowIn: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
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

      /* ── Elevation ───────────────────────────────────────────
         elev-0 sits on the page, elev-3 floats above everything. The old
         names are kept as aliases so nothing has to change in one go. */
      boxShadow: {
        "elev-0": "0 1px 0 0 rgba(255,255,255,0.03) inset",
        "elev-1":
          "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 10px 30px -12px rgba(0,0,0,0.8)",
        "elev-2": "0 8px 30px rgba(0, 0, 0, 0.45)",
        "elev-3": "0 24px 70px -12px rgba(0, 0, 0, 0.85)",
        f1: "0 0 20px rgba(225, 6, 0, 0.18)",
        "f1-strong": "0 0 34px rgba(225, 6, 0, 0.32)",
        surface: "0 8px 30px rgba(0, 0, 0, 0.45)",
        glow: "0 0 12px rgba(225, 6, 0, 0.4)",
        card: "0 1px 0 0 rgba(255,255,255,0.04) inset, 0 10px 30px -12px rgba(0,0,0,0.8)",
      },

      borderRadius: {
        lg: "10px",
        xl: "12px",
        "2xl": "16px",
        "3xl": "20px",
      },

      backgroundImage: {
        "f1-hero": "linear-gradient(135deg, #0d0d0d 0%, #1a0000 50%, #0d0d0d 100%)",
        "grid-fine":
          "linear-gradient(rgba(255,255,255,0.025) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.025) 1px, transparent 1px)",
      },
      backgroundSize: {
        grid: "48px 48px",
      },
      zIndex: {
        /* One ladder for the whole app, so a new overlay never has to guess.
           menu < drawer < modal < drag ghost < drop overlay. */
        menu: "60",
        drawer: "70",
        modal: "100",
        palette: "110",
        dropzone: "120",
      },
    },
  },
  plugins: [],
};
