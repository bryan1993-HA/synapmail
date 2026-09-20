import type { Config } from "tailwindcss";

// Theme tokens are raw `var(--x)` values, which Tailwind cannot give an alpha
// channel to on its own: it silently drops every `bg-foreground/25`-style class
// instead of emitting a rule. Wrapping each token here restores them.
const token = (name: string) =>
  `color-mix(in oklab, var(--${name}) calc(<alpha-value> * 100%), transparent)`;

const config: Config = {
  darkMode: "class",
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        background: token("background"),
        foreground: token("foreground"),
        card: {
          DEFAULT: token("card"),
          foreground: token("card-foreground"),
        },
        popover: {
          DEFAULT: token("popover"),
          foreground: token("popover-foreground"),
        },
        primary: {
          DEFAULT: token("primary"),
          foreground: token("primary-foreground"),
        },
        secondary: {
          DEFAULT: token("secondary"),
          foreground: token("secondary-foreground"),
        },
        muted: {
          DEFAULT: token("muted"),
          foreground: token("muted-foreground"),
        },
        accent: {
          DEFAULT: token("accent"),
          foreground: token("accent-foreground"),
        },
        destructive: {
          DEFAULT: token("destructive"),
        },
        border: token("border"),
        input: token("input"),
        ring: token("ring"),
        sidebar: {
          DEFAULT: token("sidebar"),
          foreground: token("sidebar-foreground"),
          primary: token("sidebar-primary"),
          "primary-foreground": token("sidebar-primary-foreground"),
          accent: token("sidebar-accent"),
          "accent-foreground": token("sidebar-accent-foreground"),
          border: token("sidebar-border"),
          ring: token("sidebar-ring"),
        },
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "BlinkMacSystemFont",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
    },
  },
  plugins: [],
};
export default config;
