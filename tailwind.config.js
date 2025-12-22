/** @type {import('tailwindcss').Config} */
module.exports = {
  darkMode: "class",
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  plugins: [
    require('@tailwindcss/container-queries'),
    require('@tailwindcss/forms'),
  ],
  theme: {
    extend: {
      colors: {
        "primary": "#FFFFFF",
        "background-light": "#FFFFFF",
        "background-dark": "#000000",
      },
      fontFamily: {
        "display": ["var(--font-display)", "Space Grotesk", "sans-serif"],
        "mono": ["var(--font-mono)", "VT323", "monospace"],
      },
      borderRadius: {
        "DEFAULT": "0",
        "lg": "0",
        "xl": "0",
        "full": "0",
      },
      animation: {
        'strobe': 'strobe 1s linear infinite',
      },
      keyframes: {
        strobe: {
          '50%': { 'border-color': '#FFFFFF' },
        }
      }
    },
  },
}

