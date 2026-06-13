/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx,ts,tsx}", "./public/index.html"],
  theme: {
    extend: {
      fontFamily: {
        cypher: ['Unbounded', 'sans-serif'],
        cypherBody: ['Chivo', 'sans-serif'],
        business: ['"Playfair Display"', 'serif'],
        businessBody: ['Manrope', 'sans-serif'],
        millennium: ['Fredoka', 'sans-serif'],
        millenniumBody: ['"Work Sans"', 'sans-serif'],
        stealth: ['"Share Tech Mono"', 'monospace'],
        stealthBody: ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      colors: {
        bgc: 'var(--bgc)',
        surface: 'var(--surface)',
        surface2: 'var(--surface-2)',
        primary: { DEFAULT: 'var(--primary)', foreground: 'var(--primary-fg)' },
        secondary: 'var(--secondary)',
        accent: 'var(--accent)',
        textmain: 'var(--text-main)',
        textmuted: 'var(--text-muted)',
        bordercol: 'var(--border-col)',
        // shadcn fallbacks
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        card: { DEFAULT: 'hsl(var(--card))', foreground: 'hsl(var(--card-foreground))' },
        popover: { DEFAULT: 'hsl(var(--popover))', foreground: 'hsl(var(--popover-foreground))' },
        muted: { DEFAULT: 'hsl(var(--muted))', foreground: 'hsl(var(--muted-foreground))' },
        destructive: { DEFAULT: 'hsl(var(--destructive))', foreground: 'hsl(var(--destructive-foreground))' },
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
      },
      keyframes: {
        'pulse-glow': {
          '0%,100%': { opacity: '0.7', filter: 'drop-shadow(0 0 12px var(--primary))' },
          '50%': { opacity: '1', filter: 'drop-shadow(0 0 24px var(--primary))' },
        },
        'orbit-spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'scanline': {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100vh)' },
        },
        'float': {
          '0%,100%': { transform: 'translateY(0px)' },
          '50%': { transform: 'translateY(-8px)' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        'accordion-down': { from: { height: '0' }, to: { height: 'var(--radix-accordion-content-height)' } },
        'accordion-up': { from: { height: 'var(--radix-accordion-content-height)' }, to: { height: '0' } },
      },
      animation: {
        'pulse-glow': 'pulse-glow 3s ease-in-out infinite',
        'orbit-spin': 'orbit-spin 24s linear infinite',
        'scanline': 'scanline 6s linear infinite',
        'float': 'float 5s ease-in-out infinite',
        'shimmer': 'shimmer 3s linear infinite',
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
