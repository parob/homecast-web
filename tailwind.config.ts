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
      // Text size is a type-only scale.
      //
      // It used to be the root font size (16/18/20px), which meant every rem in
      // the app moved with it — button heights, the tab bar, icons, padding,
      // gaps. Picking "Small" shrank the whole interface rather than the words
      // in it. The root font size is now fixed at TEXT_SCALE_BASE_PX, so chrome
      // is the same size at every setting, and only these tokens multiply by
      // `--text-scale` (0.8 / 0.9 / 1, set on <html> from the setting).
      //
      // The rem values are Tailwind's own, so `text-sm` at 20px root × 0.8 is
      // the same 14px it was at a 16px root — every rung renders type at
      // exactly the size it did before, without the chrome coming with it.
      //
      // Line heights are deliberately NOT scaled: they are what keeps a row of
      // text the height it was, which is the whole point of the setting now.
      // Anything hard-coded in px (`text-[10px]`) never tracked this and still
      // does not.
      fontSize: {
        xs: ["calc(0.75rem * var(--text-scale))", { lineHeight: "1rem" }],
        sm: ["calc(0.875rem * var(--text-scale))", { lineHeight: "1.25rem" }],
        base: ["calc(1rem * var(--text-scale))", { lineHeight: "1.5rem" }],
        lg: ["calc(1.125rem * var(--text-scale))", { lineHeight: "1.75rem" }],
        xl: ["calc(1.25rem * var(--text-scale))", { lineHeight: "1.75rem" }],
        "2xl": ["calc(1.5rem * var(--text-scale))", { lineHeight: "2rem" }],
        "3xl": ["calc(1.875rem * var(--text-scale))", { lineHeight: "2.25rem" }],
        "4xl": ["calc(2.25rem * var(--text-scale))", { lineHeight: "2.5rem" }],
        "5xl": ["calc(3rem * var(--text-scale))", { lineHeight: "1" }],
        "6xl": ["calc(3.75rem * var(--text-scale))", { lineHeight: "1" }],
        "7xl": ["calc(4.5rem * var(--text-scale))", { lineHeight: "1" }],
        "8xl": ["calc(6rem * var(--text-scale))", { lineHeight: "1" }],
        "9xl": ["calc(8rem * var(--text-scale))", { lineHeight: "1" }],
      },
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
      // This ladder is the only thing that sets how round anything looks, in
      // every engine. Raising a step is what makes corners rounder — don't
      // reach for corner-shape, which is Chromium-only and made Chrome look
      // harder than Safari, not softer (see the note in index.css).
      //
      // Headroom is the constraint when raising a step: CSS clamps a radius
      // past half an element's height into a pill, so the control tier has
      // almost none left. md is on 26-30px chips and inputs, lg is on the
      // h-10 w-10 icon tiles, and xl/2xl already clamp on h-10 controls.
      // `full` and `none` stay off this ladder, so pills are never touched.
      borderRadius: {
        sm: "8px",
        md: "12px",
        lg: "16px",
        xl: "22px",
        "2xl": "28px",
        "3xl": "40px",
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
