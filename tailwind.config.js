/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    './app/**/*.{js,jsx,ts,tsx}',
    './components/**/*.{js,jsx,ts,tsx}',
  ],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        // ── Bold Industrial Palette ──
        // Warm stone neutrals
        bg: {
          DEFAULT: '#F5F3F0',
          card: '#FFFFFF',
          muted: '#EDEAE6',
          dim: '#E0DCD6',
        },
        text: {
          DEFAULT: '#1C1917',
          sub: '#57534E',
          muted: '#A8A29E',
        },
        line: {
          DEFAULT: '#D6D3D1',
          strong: '#C4C0BB',
        },

        // Brand
        navy: {
          DEFAULT: '#1E293B',
          light: '#334155',
          dark: '#0F172A',
        },
        orange: {
          DEFAULT: '#EA580C',
          dark: '#C2410C',
          light: '#FFF7ED',
          muted: '#FFEDD5',
        },

        // Semantic status
        teal: {
          DEFAULT: '#0D9488',
          bg: '#F0FDFA',
          border: '#99F6E4',
        },
        danger: {
          DEFAULT: '#DC2626',
          bg: '#FEF2F2',
          border: '#FECACA',
        },
        amber: {
          DEFAULT: '#D97706',
          bg: '#FFFBEB',
          border: '#FDE68A',
        },
        indigo: {
          DEFAULT: '#4F46E5',
          bg: '#EEF2FF',
          border: '#C7D2FE',
        },
        stone: {
          DEFAULT: '#78716C',
          bg: '#F5F5F4',
        },
      },
      fontFamily: {
        inter: ['Inter', 'system-ui', 'sans-serif'],
      },
      borderRadius: {
        sm: '6px',
        md: '10px',
        lg: '14px',
        xl: '18px',
        full: '9999px',
      },
      boxShadow: {
        sm: '0 1px 3px rgba(28, 25, 23, 0.06)',
        md: '0 4px 12px rgba(28, 25, 23, 0.08)',
        lg: '0 12px 32px rgba(28, 25, 23, 0.1)',
      },
    },
  },
  plugins: [],
};
