import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import unusedImports from 'eslint-plugin-unused-imports';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'dev-dist/**',
      'node_modules/**',
      'local-assets/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      '**/*.cjs',
      '**/*.js',
    ],
  },
  tseslint.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    plugins: { 'react-hooks': reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // React-Compiler-era rules (v7) flag ~140 pre-existing patterns in the
      // admin backend; adopting them is a refactor tracked in IMPROVEMENTS.md,
      // not a lint gate. The classic rules-of-hooks / exhaustive-deps stay on.
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/refs': 'off',
      'react-hooks/immutability': 'off',
      'react-hooks/purity': 'off',
    },
  },
  {
    plugins: { 'unused-imports': unusedImports },
    rules: {
      // Pre-existing `any` usage is tracked in IMPROVEMENTS.md (type-safety
      // cleanup); not a lint gate so the rest of the rules can be enforced.
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-unused-expressions': [
        'error',
        { allowShortCircuit: true, allowTernary: true },
      ],
      // unused-imports wraps no-unused-vars and adds autofix for dead imports.
      '@typescript-eslint/no-unused-vars': 'off',
      'unused-imports/no-unused-imports': 'error',
      'unused-imports/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrors: 'none' },
      ],
    },
  },
);
