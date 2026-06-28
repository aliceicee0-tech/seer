/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        // Monochrome premium palette (Black, White, Zinc)
        brand: {
          50: "#fafafa",
          100: "#f4f4f5",
          200: "#e4e4e7",
          300: "#d4d4d8",
          400: "#a1a1aa",
          500: "#71717a",
          600: "#52525b",
          700: "#3f3f46",
          800: "#27272a",
          900: "#18181b",
        },
        ink: {
          900: "#000000", // Pure OLED Black
          800: "#09090b", // Deep dark Gray
          700: "#18181b", // Dark Gray
          600: "#27272a", // Gray Border
        },
        zinc: {
          150: "#ececed",
          350: "#bcbcc0",
          450: "#8a8a93",
          550: "#61616a",
          650: "#4b4b52",
          750: "#333338",
          850: "#202024",
        },
        rose: {
          450: "#f85872",
        },
        polymarket: {
          blue: "#004bff",
          red: "#f43f5e",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
        display: ["Sora", "system-ui", "Segoe UI", "Roboto", "sans-serif"],
      },
      boxShadow: {
        card: "0 2px 8px rgba(0, 0, 0, 0.04), 0 1px 3px rgba(0, 0, 0, 0.02)",
        glow: "0 4px 16px rgba(0, 75, 255, 0.04)",
      },
    },
  },
  plugins: [],
};
