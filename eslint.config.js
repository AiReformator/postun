import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', '**/.wrangler/**', '**/worker-configuration.d.ts', 'apps/web/public/**/*.min.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // Logs must never carry user content; only console.error/warn with safe codes are allowed.
      'no-console': ['error', { allow: ['warn', 'error'] }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-restricted-syntax': [
        'error',
        { selector: "CallExpression[callee.name='eval']", message: 'eval is forbidden' },
        { selector: "NewExpression[callee.name='Function']", message: 'new Function is forbidden' }
      ]
    }
  },
  {
    files: ['scripts/**/*.mjs', 'apps/web/build.mjs', 'apps/web/test/**/*.mjs', 'apps/web/vitest.config.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
    rules: { 'no-console': 'off' }
  },
  {
    files: ['apps/web/src/**/*.mjs', 'apps/web/public/**/*.js'],
    languageOptions: {
      globals: {
        document: 'readonly', window: 'readonly', location: 'readonly', fetch: 'readonly', URL: 'readonly', Node: 'readonly',
        DOMParser: 'readonly', setTimeout: 'readonly', confirm: 'readonly', alert: 'readonly', prompt: 'readonly',
        localStorage: 'readonly', navigator: 'readonly'
      }
    }
  }
);
