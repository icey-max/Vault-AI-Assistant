import type { Config } from "tailwindcss";

const config = {
  content: ["./src/**/*.{ts,tsx}", "./styles.css"],
  corePlugins: {
    preflight: false
  },
  theme: {
    extend: {
      colors: {
        background: "var(--background-primary)",
        foreground: "var(--text-normal)",
        muted: "var(--background-secondary)",
        "muted-foreground": "var(--text-muted)",
        border: "var(--background-modifier-border)",
        accent: "var(--interactive-accent)",
        "accent-foreground": "var(--text-on-accent)"
      },
      borderRadius: {
        md: "8px",
        sm: "6px"
      }
    }
  }
} satisfies Config;

export default config;
