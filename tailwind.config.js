const path = require('path');
const fs = require('fs');

/**
 * Content globs are resolved as absolute paths (via `__dirname`) rather than
 * left relative. Relative globs are resolved against the current working
 * directory, which is this file's own directory when the root Electron
 * build (webpack, cwd = repo root) requires it, but apps/web's Vite build
 * (see apps/web/vite.config.ts) loads this same file from cwd = apps/web —
 * relative globs would silently stop matching anything there. Absolute
 * globs work identically from either caller, so this one config keeps
 * serving both builds' Tailwind output without being forked.
 */
const fromRoot = (glob) => path.join(__dirname, glob);

const readContentFiles = (root, includeFile) => {
  const contents = [];
  const visit = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (entry.name !== '__tests__') {
          visit(path.join(directory, entry.name));
        }
      } else if (
        includeFile(entry.name) &&
        !/\.(test|spec)\.[^.]+$/.test(entry.name)
      ) {
        contents.push(
          fs.readFileSync(path.join(directory, entry.name), 'utf8'),
        );
      }
    }
  };
  visit(root);
  return contents.join('\n');
};

const contentGlobs = [
  fromRoot('src/renderer/**/*.tsx'),
  fromRoot('src/renderer/lib/invoicePrint/urduFont.ts'),
  fromRoot('apps/web/src/**/*.tsx'),
  `!${fromRoot('**/__tests__/**')}`,
  `!${fromRoot('**/*.test.*')}`,
  `!${fromRoot('**/*.spec.*')}`,
];

/** @type {import('tailwindcss').Config} */
module.exports = {
  future: {
    // Gate :hover variants behind @media (hover: hover) so touch taps
    // never leave a sticky hover state (mobile-native skill).
    hoverOnlyWhenSupported: true,
  },
  darkMode: ['class'],
  // production reads the UI sources sequentially to stay within build-container fd limits.
  safelist: [
    "font-['Jameel_Noori_Nastaleeq',serif]",
    "font-['Noto_Nastaliq_Urdu',serif]",
    "font-['Jameel_Noori_Nastaleeq','Noto_Nastaliq_Urdu',serif]",
  ],
  content:
    process.env.NODE_ENV === 'production'
      ? [
          {
            raw: [
              readContentFiles(
                path.resolve(__dirname, 'src/renderer'),
                (file) => file.endsWith('.tsx'),
              ),
              readContentFiles(
                path.resolve(__dirname, 'src/renderer/lib/invoicePrint'),
                (file) => file === 'urduFont.ts',
              ),
              readContentFiles(
                path.resolve(__dirname, 'apps/web/src'),
                (file) => file.endsWith('.tsx'),
              ),
            ].join('\n'),
            extension: 'tsx',
          },
        ]
      : contentGlobs,
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: {
        '2xl': '1400px',
      },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      keyframes: {
        'accordion-down': {
          from: { height: 0 },
          to: { height: 'var(--radix-accordion-content-height)' },
        },
        'accordion-up': {
          from: { height: 'var(--radix-accordion-content-height)' },
          to: { height: 0 },
        },
      },
      animation: {
        'accordion-down': 'accordion-down 0.2s ease-out',
        'accordion-up': 'accordion-up 0.2s ease-out',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
};
