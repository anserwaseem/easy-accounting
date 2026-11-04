const { defineConfig, globalIgnores } = require('eslint/config');

const typescriptEslint = require('@typescript-eslint/eslint-plugin');
const js = require('@eslint/js');

const { FlatCompat } = require('@eslint/eslintrc');

const compat = new FlatCompat({
  baseDirectory: __dirname,
  recommendedConfig: js.configs.recommended,
  allConfig: js.configs.all,
});

module.exports = defineConfig([
  {
    extends: compat.extends('erb'),

    plugins: {
      '@typescript-eslint': typescriptEslint,
    },

    languageOptions: {
      globals: {
        React: 'readonly',
        globalThis: 'readonly',
      },

      ecmaVersion: 2020,
      sourceType: 'module',

      parserOptions: {
        sourceType: 'module',
      },
    },

    rules: {
      'import/no-extraneous-dependencies': 'off',
      'react/react-in-jsx-scope': 'off',
      'react/jsx-filename-extension': 'off',
      'import/extensions': 'off',
      'import/no-unresolved': 'off',
      'import/no-import-module-exports': 'off',
      'no-shadow': 'off',
      '@typescript-eslint/no-shadow': 'error',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': 'error',
      'import/no-default-export': 'off',
      'import/prefer-default-export': 'off',
      'react/jsx-props-no-spreading': 'off',
      'react/require-default-props': 'off',
      'no-plusplus': 'off',

      'no-use-before-define': [
        'error',
        {
          functions: false,
        },
      ],

      'consistent-return': 'off',
      'no-extra-boolean-cast': 'off',
      'no-restricted-syntax': ['off', 'ForOfStatement'],
      'global-require': 'off',
      'import/no-dynamic-require': 'off',
      'no-console': 'off',
      'no-continue': 'off',
      'no-underscore-dangle': 'off',
      'promise/always-return': 'off',
      'no-useless-constructor': 'off',

      'react/function-component-definition': [
        2,
        {
          namedComponents: 'arrow-function',
          unnamedComponents: 'arrow-function',
        },
      ],

      'jsx-a11y/control-has-associated-label': [
        'error',
        {
          labelAttributes: ['label'],
          controlComponents: [],
          ignoreElements: [
            'audio',
            'canvas',
            'embed',
            'input',
            'textarea',
            'tr',
            'td',
            'th',
            'video',
          ],

          ignoreRoles: [
            'grid',
            'listbox',
            'menu',
            'menubar',
            'radiogroup',
            'row',
            'tablist',
            'toolbar',
            'tree',
            'treegrid',
          ],

          depth: 5,
        },
      ],
    },

    settings: {
      'import/resolver': {
        node: {},

        webpack: {
          config: require.resolve('./.erb/configs/webpack.config.eslint.ts'),
        },
      },

      'import/parsers': {
        '@typescript-eslint/parser': ['.ts', '.tsx'],
      },
    },
  },
  globalIgnores(['**/.eslintrc.js']),
  {
    files: ['src/core/**/*.ts'],
    ignores: ['src/core/**/__tests__/**'],

    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: [
                'electron',
                'electron-*',
                'better-sqlite3',
                'fs',
                'path',
                'os',
                'child_process',
                'crypto',
                'node:*',
                '**/main/**',
                '**/renderer/**',
              ],

              message:
                'src/core must stay platform-free — inject platform capabilities via ports (src/core/ports.ts) or the DatabaseDriver.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/core/sync/__tests__/convergenceScenarios.ts'],

    rules: {
      'jest/no-export': 'off',
    },
  },
  globalIgnores([
    '**/logs',
    '**/*.log',
    '**/pids',
    '**/*.pid',
    '**/*.seed',
    '**/coverage',
    '**/.eslintcache',
    '**/node_modules',
    '**/.DS_Store',
    'release/app/dist',
    'release/build',
    '.erb/dll',
    'apps/web',
    '**/workers',
    '**/.idea',
    '**/npm-debug.log.*',
    '**/*.css.d.ts',
    '**/*.sass.d.ts',
    '**/*.scss.d.ts',
    '**/apps/',
    '**/.local/',
  ]),
]);
