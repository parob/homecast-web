import type { Config } from "tailwindcss";

export default {
  darkMode: ["class"],
  content: ["./pages/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./app/**/*.{ts,tsx}", "./src/**/*.{ts,tsx}"],
  prefix: "",
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    fontFamily: {
      sans: [
        '"SF Pro Display"',
        '"SF Pro Text"',
        '-apple-system',
        'BlinkMacSystemFont',
        '"Segoe UI"',
        'Roboto',
        '"Helvetica Neue"',
        'Arial',
        'sans-serif',
      ],
    },
    extend: {
      colors: {
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
        },
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        sidebar: {
          DEFAULT: "hsl(var(--sidebar-background))",
          foreground: "hsl(var(--sidebar-foreground))",
          primary: "hsl(var(--sidebar-primary))",
          "primary-foreground": "hsl(var(--sidebar-primary-foreground))",
          accent: "hsl(var(--sidebar-accent))",
          "accent-foreground": "hsl(var(--sidebar-accent-foreground))",
          border: "hsl(var(--sidebar-border))",
          ring: "hsl(var(--sidebar-ring))",
        },
      },
      // Apple-leaning radius ladder. Every step is one notch larger than the
      // Tailwind/shadcn defaults, which is what makes legacy screens match the
      // hand-tuned chrome without touching each call site. Pair with the
      // continuous-corner rule in index.css.
      //
      // --corner-scale is 1 everywhere except where corner-shape is live, where
      // it grows the radius to match the shape (see index.css for why). Going
      // through the scale rather than overriding each class is what keeps the
      // per-side (rounded-t-lg) and responsive (sm:rounded-xl) variants honest.
      //
      // Only the surface tier scales. A radius past half an element's height is
      // clamped by CSS into a pill, and the control tier has no headroom left:
      // scaling md turned chips and menu items into pills, and lg turned the
      // h-10 w-10 icon tiles into circles. xl and up are already clamped on
      // h-10 controls (input, button), so scaling them costs nothing there and
      // only reads on the tall surfaces — cards, sheets, dialogs, widgets —
      // which is where the corner is actually visible. sm/md/lg still get the
      // continuous shape, just not the extra radius; at 8-16px the difference
      // between a squircle and a circular arc is a couple of pixels anyway.
      // `full` and `none` stay off this ladder, so pills are never touched.
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "calc(22px * var(--corner-scale, 1))",
        "2xl": "calc(28px * var(--corner-scale, 1))",
        "3xl": "calc(40px * var(--corner-scale, 1))",
      },
      backgroundImage: {
        "gradient-radial": "radial-gradient(ellipse at center, var(--tw-gradient-stops))",
      },
      // Motion tokens. `ease-standard` is the iOS sheet curve — it leaves fast
      // and settles slowly, which is what makes Apple's transitions feel like
      // deceleration rather than a linear slide. Durations are named by intent
      // so a panel and a tile agree without each picking its own number.
      transitionTimingFunction: {
        standard: "cubic-bezier(0.32, 0.72, 0, 1)",
      },
      transitionDuration: {
        fast: "150ms",
        base: "200ms",
        slow: "300ms",
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
        "fade-in": {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
        "scale-in": {
          "0%": { opacity: "0", transform: "scale(0.95)" },
          "100%": { opacity: "1", transform: "scale(1)" },
        },
        "pulse-soft": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.7" },
        },
        "slide-up": {
          "0%": { opacity: "0", transform: "translateY(4px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
        "fade-in": "fade-in 0.3s ease-out",
        "scale-in": "scale-in 0.2s ease-out",
        "pulse-soft": "pulse-soft 2s ease-in-out infinite",
        "slide-up": "slide-up 0.2s ease-out",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
} satisfies Config;
