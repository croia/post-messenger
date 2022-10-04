module.exports = {
  env: {
    browser: true,
    node: true,
  },
  extends: [
    'eslint:recommended',
    'plugin:@typescript-eslint/recommended',
    'plugin:react/recommended',
    'airbnb-typescript',
  ],
  parser: '@typescript-eslint/parser',
  parserOptions: {
    project: ['./tsconfig.eslint.json'],
  },
  plugins: [
    'import',
    'sort-keys-fix',
    '@typescript-eslint',
  ],
  rules: {
    '@typescript-eslint/explicit-module-boundary-types': ['error', {
      allowArgumentsExplicitlyTypedAsAny: false,
      allowDirectConstAssertionInArrowFunctions: true,
      allowHigherOrderFunctions: true,
      allowTypedFunctionExpressions: true,
    }],
    '@typescript-eslint/member-delimiter-style': ['error'],
    '@typescript-eslint/ban-ts-comment': ['error', {
      'ts-expect-error': 'allow-with-description'
    }],
    'arrow-parens': [
      'error',
      'as-needed',
      { requireForBlockBody: true },
    ],
    'import/order': [
      'error', {
        alphabetize: {
          /* sort in ascending order. Options: ['ignore', 'asc', 'desc'] */
          caseInsensitive: true,
          order: 'asc', /* ignore case. Options: [true, false] */
        },
        groups: [
          'builtin',
          'external',
          'internal',
          'sibling',
          'parent',
          'index',
          'object',
        ],
      },
    ],
    'import/prefer-default-export': 'off',
    'lines-between-class-members': [
      'error',
      'always',
      { exceptAfterSingleLine: true },
    ],
    'max-classes-per-file': 'off',
    'max-len': ['error', { code: 150 }],
    'no-nested-ternary': 'off',
    'no-restricted-syntax': [
      'error',
      'LabeledStatement',
      'WithStatement',
    ],
    'operator-linebreak': [
      'error',
      'after',
      { overrides: { ':': 'before', '?': 'before' } },
    ],
    'sort-keys-fix/sort-keys-fix': 'error',
  },
};
