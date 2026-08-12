import type { Config } from "tailwindcss";

export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        void: "#0E0B09",
        coal: "#161110",
        soot: "#1E1714",
        bark: "#282019",
        bone: "#ECE5DA",
        stone: "#A29384",
        line: "rgb(236 229 218 / 0.08)",
        "line-strong": "rgb(236 229 218 / 0.15)",
        ember: {
          DEFAULT: "#FF8A3D",
          hi: "#FFB15C",
          deep: "#C8551F",
          faint: "rgb(255 138 61 / 0.12)",
        },
        flare: "#FF5C49",
        mineral: {
          DEFAULT: "#8FD8D2",
          hi: "#C4EFEB",
          deep: "#4E9B95",
          faint: "rgb(143 216 210 / 0.10)",
        },
        moss: "#9DB98A",
      },
      fontFamily: {
        display: ['"Bricolage Grotesque"', "Georgia", "serif"],
        sans: ['"Instrument Sans"', "system-ui", "sans-serif"],
        mono: ['"Spline Sans Mono"', "ui-monospace", "monospace"],
      },
      spacing: {
        "4.5": "1.125rem",
        "13": "3.25rem",
        "15": "3.75rem",
        "18": "4.5rem",
        "22": "5.5rem",
        "26": "6.5rem",
        "30": "7.5rem",
        "34": "8.5rem",
        "38": "9.5rem",
        "42": "10.5rem",
        "50": "12.5rem",
        "58": "14.5rem",
        "66": "16.5rem",
        "74": "18.5rem",
        "82": "20.5rem",
        "88": "22rem",
        "100": "25rem",
        "120": "30rem",
      },
      boxShadow: {
        ember: "0 0 22px -4px rgb(255 138 61 / 0.5)",
        "ember-lg": "0 0 60px -10px rgb(255 138 61 / 0.55)",
        mineral: "0 0 22px -4px rgb(143 216 210 / 0.45)",
        lift: "0 24px 60px -24px rgb(0 0 0 / 0.85)",
        hairline: "inset 0 1px 0 rgb(255 255 255 / 0.045)",
      },
      backgroundImage: {
        "void-fade":
          "linear-gradient(180deg, #12100D 0%, #0E0B09 45%, #0B0807 100%)",
        "ember-radial":
          "radial-gradient(circle at 50% 120%, rgb(255 138 61 / 0.14), transparent 60%)",
        panel: "linear-gradient(165deg, #1E1714 0%, #161110 100%)",
      },
      borderRadius: {
        "4xl": "2rem",
      },
      zIndex: {
        canvas: "1",
        dive: "30",
        hud: "40",
        "cortex-status": "41",
        "cortex-toolbar": "42",
        rail: "45",
        veil: "50",
        drawer: "60",
        popover: "62",
        sheet: "64",
        command: "66",
        toast: "70",
      },
      transitionDuration: {
        350: "350ms",
        450: "450ms",
        550: "550ms",
      },
      transitionTimingFunction: {
        "ease-out-expo": "cubic-bezier(0.22, 1, 0.36, 1)",
        "ease-spring": "cubic-bezier(0.34, 1.56, 0.64, 1)",
      },
      keyframes: {
        flicker: {
          "0%, 100%": { opacity: "1" },
          "8%": { opacity: "0.55" },
          "16%": { opacity: "0.9" },
          "38%": { opacity: "0.45" },
          "54%": { opacity: "0.95" },
          "72%": { opacity: "0.6" },
          "86%": { opacity: "1" },
        },
        breathe: {
          "0%, 100%": { transform: "scale(1)", opacity: "0.85" },
          "50%": { transform: "scale(1.08)", opacity: "1" },
        },
        reignite: {
          "0%": {
            transform: "scale(0.7)",
            filter: "brightness(2.4) saturate(1.6)",
            opacity: "0.4",
          },
          "60%": { transform: "scale(1.18)", filter: "brightness(1.6)" },
          "100%": {
            transform: "scale(1)",
            filter: "brightness(1)",
            opacity: "1",
          },
        },
        scanline: {
          "0%": { transform: "translateX(-100%)" },
          "100%": { transform: "translateX(100%)" },
        },
        drift: {
          "0%": { transform: "translate3d(0, 0, 0)", opacity: "0" },
          "12%": { opacity: "0.9" },
          "85%": { opacity: "0.5" },
          "100%": {
            transform: "translate3d(var(--drift-x, 24px), -120px, 0)",
            opacity: "0",
          },
        },
        rise: {
          from: { opacity: "0", transform: "translateY(18px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "pulse-ring": {
          "0%": { transform: "scale(0.4)", opacity: "0.9" },
          "100%": { transform: "scale(1.6)", opacity: "0" },
        },
        shimmer: {
          "0%": { transform: "translateX(-120%)" },
          "60%, 100%": { transform: "translateX(160%)" },
        },
        blink: {
          "50%": { opacity: "0" },
        },
        signal: {
          "0%": { offsetDistance: "0%", opacity: "0" },
          "10%": { opacity: "1" },
          "90%": { opacity: "1" },
          "100%": { offsetDistance: "100%", opacity: "0" },
        },
        "sheet-in": {
          from: { opacity: "0.6", transform: "translateY(24px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "popover-in": {
          from: {
            opacity: "0",
            transform: "translateY(-6px) scale(0.985)",
          },
          to: {
            opacity: "1",
            transform: "translateY(0) scale(1)",
          },
        },
        "camera-settle": {
          from: { opacity: "0.92", transform: "scale(1.015)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
        "graph-enter": {
          from: { opacity: "0", transform: "scale(1.02)" },
          to: { opacity: "1", transform: "scale(1)" },
        },
      },
      animation: {
        flicker: "flicker 2.6s ease-in-out infinite",
        breathe: "breathe 4.2s ease-in-out infinite",
        reignite: "reignite 0.9s cubic-bezier(0.22, 1, 0.36, 1)",
        scanline: "scanline 1.8s ease-in-out infinite",
        drift: "drift 12s linear infinite",
        rise: "rise 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
        "pulse-ring":
          "pulse-ring 2.2s cubic-bezier(0.22, 1, 0.36, 1) infinite",
        shimmer: "shimmer 3.2s ease-in-out infinite",
        blink: "blink 1.1s steps(2) infinite",
        signal: "signal 1.4s ease-in-out infinite",
        "sheet-in": "sheet-in 0.38s cubic-bezier(0.22, 1, 0.36, 1) both",
        "popover-in": "popover-in 0.26s cubic-bezier(0.22, 1, 0.36, 1) both",
        "camera-settle":
          "camera-settle 0.52s cubic-bezier(0.22, 1, 0.36, 1) both",
        "graph-enter": "graph-enter 0.6s cubic-bezier(0.22, 1, 0.36, 1) both",
      },
    },
  },
  plugins: [],
} satisfies Config;