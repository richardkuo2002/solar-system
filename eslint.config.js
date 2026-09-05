// Flat ESLint config (v0.9). Default recommended ruleset only — no custom
// stylistic rules (semicolons/quotes/etc.), not asked for. No `globals`
// package: the browser/Node globals this codebase actually uses are small
// and stable enough to declare inline.
import js from '@eslint/js';

const browserGlobals = {
  window: 'readonly', document: 'readonly', console: 'readonly',
  URLSearchParams: 'readonly', URL: 'readonly', Blob: 'readonly',
  requestAnimationFrame: 'readonly', requestIdleCallback: 'readonly',
  localStorage: 'readonly', history: 'readonly', navigator: 'readonly',
  performance: 'readonly', fetch: 'readonly', setTimeout: 'readonly',
  clearTimeout: 'readonly', AbortController: 'readonly',
  ResizeObserver: 'readonly',
};

// Node 18+ also has fetch/setTimeout/URLSearchParams as real globals —
// scripts/ uses them directly (no 'node:' import needed for these).
const nodeGlobals = {
  process: 'readonly', Buffer: 'readonly', console: 'readonly',
  fetch: 'readonly', setTimeout: 'readonly', URLSearchParams: 'readonly',
};

export default [
  js.configs.recommended,
  {
    // `series` is destructured only to exclude it from the rest object
    // (see analysis/export.js) — a standard idiom no-unused-vars has a
    // built-in option for, not a rule to silence globally.
    rules: { 'no-unused-vars': ['error', { ignoreRestSiblings: true }] },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: browserGlobals },
  },
  {
    files: ['scripts/**/*.js', 'scripts/**/*.mjs'],
    languageOptions: { ecmaVersion: 2022, sourceType: 'module', globals: nodeGlobals },
  },
  { ignores: ['node_modules/', 'assets/', 'src-tauri/', 'web-dist/'] },
];
