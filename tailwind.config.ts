import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/components/**/*.{js,ts,jsx,tsx,mdx}",
    "./src/app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        "zn-bg":      "#14130F",
        "zn-raised":  "#1A1812",
        "zn-surface": "#221F17",
        "zn-overlay": "#2C2820",
        "zn-call":    "#5C9A6B",
        "zn-put":     "#B65640",
        "zn-atm":     "#B59665",
        "zn-brand":   "#B59665",
        "zn-hi":      "#F3EEE3",
        "zn-mid":     "#9C9484",
        "zn-lo":      "#5C5648",
        "zn-heat-lo": "#362A14",
        "zn-heat-hi": "#E8D6A8",
        "zn-heat-neg":"#B65640",
        "zn-heat-pos":"#5C9A6B",
      },
      fontFamily: {
        serif: ["Fraunces", "Georgia", "serif"],
        sans: ["IBM Plex Sans", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "ui-monospace", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
