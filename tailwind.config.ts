import type { Config } from 'tailwindcss';

/**
 * Larimar design tokens.
 *
 * The palette is derived from the larimar gemstone: deep navy for trust, the
 * stone's own blue for identity, a pale wash for surfaces, and a restrained sand
 * accent reserved for monetary emphasis. Nothing here is decorative for its own
 * sake — a cash product earns trust by looking calm and legible, not lively.
 */
const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        navy: {
          50: '#F2F5F8',
          100: '#DDE5ED',
          200: '#B9C8D8',
          300: '#8CA3BC',
          400: '#5C7A9C',
          500: '#3A5B7E',
          600: '#254564',
          700: '#17334E',
          800: '#0F2740',
          900: '#0A1F33',
          950: '#061423',
        },
        larimar: {
          50: '#F0FAFD',
          100: '#DBF2F9',
          200: '#CFE9F1',
          300: '#8FD3E6',
          400: '#4FB8D6',
          500: '#29A9CC',
          600: '#1C93B8',
          700: '#17758F',
          800: '#175F74',
          900: '#184F61',
          950: '#0B3341',
        },
        sand: {
          50: '#FDF8EF',
          100: '#FAEDD3',
          200: '#F4D9A4',
          300: '#EDC270',
          400: '#E8B24A',
          500: '#DF9628',
          600: '#C5761E',
          700: '#A4581B',
          800: '#85461D',
          900: '#6D3A1B',
        },
        success: { 50: '#F0FDF6', 500: '#16A34A', 600: '#15803D', 700: '#166534' },
        warning: { 50: '#FFFBEB', 500: '#F59E0B', 600: '#D97706', 700: '#B45309' },
        danger: { 50: '#FEF2F2', 500: '#DC2626', 600: '#B91C1C', 700: '#991B1B' },
      },
      fontFamily: {
        sans: ['var(--font-sans)', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'Roboto', 'sans-serif'],
        // Tabular figures for every monetary value. Digits must not jitter.
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
      borderRadius: {
        xl: '0.875rem',
        '2xl': '1.25rem',
        '3xl': '1.75rem',
      },
      boxShadow: {
        card: '0 1px 2px rgba(10,31,51,0.04), 0 8px 24px -8px rgba(10,31,51,0.10)',
        lift: '0 2px 4px rgba(10,31,51,0.05), 0 16px 40px -12px rgba(10,31,51,0.18)',
      },
      keyframes: {
        'fade-up': {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        'fade-up': 'fade-up 0.4s ease-out both',
      },
    },
  },
  plugins: [],
};

export default config;
