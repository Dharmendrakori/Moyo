import next from 'eslint-config-next';
import tseslint from '@typescript-eslint/eslint-plugin';

/**
 * ESLint 9 flat config.
 *
 * `eslint-config-next@16` ships a native flat config, so we consume it directly
 * rather than through `FlatCompat` - the compat shim cannot serialise the React
 * plugin's circular structure and crashes with
 * "Converting circular structure to JSON".
 *
 * ESLint runs as its own step (`npm run lint`); Next.js 16 no longer accepts an
 * `eslint` key in next.config.mjs.
 */
const config = [
  {
    ignores: [
      '.next/**',
      'node_modules/**',
      'legacy/**',
      'public/**',
      'prisma/dev.db',
      'next-env.d.ts',
    ],
  },
  ...next,
  {
    // The Next config does not register the TypeScript plugin itself, so we do
    // it here in order to be able to reference its rules below.
    plugins: { '@typescript-eslint': tseslint },
    rules: {
      // The refactor replaced every innerHTML site with React escaping.
      // This rule keeps that from regressing.
      'react/no-danger': 'error',
      '@next/next/no-img-element': 'error',
      // Unused args prefixed with _ are intentionally allowed.
      '@typescript-eslint/no-unused-vars': [
        'warn',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
];

export default config;