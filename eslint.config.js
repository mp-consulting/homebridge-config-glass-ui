import antfu from '@antfu/eslint-config'

export default antfu(
  {
    ignores: ['dist', 'info', 'ui/src/scss/vendor'],
    typescript: true,
    react: true,
    formatters: {
      css: true,
      html: true,
      markdown: true,
      svg: true,
    },
    rules: {
      'markdown/require-alt-text': 'off',
    },
  },
  {
    // The server is not React: Nest's `useFactory`/`useValue` are not hooks
    files: ['src/**', 'test/**'],
    rules: {
      'react/no-unnecessary-use-prefix': 'off',
      'react/purity': 'off',
    },
  },
  {
    // A react-router route module exports the page plus what lazy() reads from it
    files: ['ui/src/**/route.tsx'],
    rules: {
      'react-refresh/only-export-components': ['error', { allowExportNames: ['loader', 'action', 'shouldRevalidate', 'children', 'handle', 'ErrorBoundary'] }],
    },
  },
  {
    // JS/TS-specific rules (these crash on non-JS SourceCode objects like markdown)
    files: ['**/*.?([cm])[jt]s?(x)'],
    rules: {
      'curly': ['error', 'all'],
      'jsdoc/check-alignment': 'error',
      'jsdoc/check-line-alignment': 'error',
      'jsdoc/no-bad-blocks': 'error',
      'jsdoc/no-blank-block-descriptions': 'error',
      'jsdoc/require-asterisk-prefix': 'error',
      'jsdoc/require-description-complete-sentence': 'off',
      'jsdoc/require-hyphen-before-param-description': 'error',
      'no-undef': 'error',
      'perfectionist/sort-exports': 'error',
      'perfectionist/sort-imports': [
        'error',
        {
          groups: [
            ['type-builtin', 'type-external', 'type-internal'],
            ['type-parent', 'type-sibling', 'type-index'],
            'builtin',
            'external',
            'internal',
            ['parent', 'sibling', 'index'],
            'side-effect',
            'unknown',
          ],
          internalPattern: ['^@/.*'],
          order: 'asc',
          type: 'natural',
          newlinesBetween: 1,
        },
      ],
      'perfectionist/sort-named-exports': 'error',
      'perfectionist/sort-named-imports': 'error',
      'style/brace-style': ['error', '1tbs'],
      'style/quote-props': ['error', 'consistent-as-needed'],
      'ts/consistent-type-imports': 'off',
      'unicorn/no-useless-spread': 'error',
      'unused-imports/no-unused-vars': ['error', { caughtErrors: 'none', args: 'none' }],
    },
  },
)
  .append({
    files: ['test/**/*.e2e-spec.ts', 'ui/src/**/*.spec.ts'],
    rules: {
      // antfu's base config only applies its test rules to `*.spec.ts` (not
      // `*.e2e-spec.ts`), and this repo titles describe blocks after the class
      // under test, so switch off the lowercase-title rule where it does apply
      'test/prefer-lowercase-title': 'off',
      'test/expect-expect': 'error',
      'test/no-commented-out-tests': 'error',
      'test/no-conditional-expect': 'error',
      'test/no-disabled-tests': 'warn',
      'test/no-focused-tests': 'error',
      'test/no-identical-title': 'error',
      'test/no-import-node-test': 'error',
      'test/no-interpolation-in-snapshots': 'error',
      'test/no-mocks-import': 'error',
      'test/no-standalone-expect': 'error',
      'test/no-unneeded-async-expect-function': 'error',
      'test/padding-around-before-each-blocks': 'error',
      'test/padding-around-after-each-blocks': 'error',
      'test/padding-around-before-all-blocks': 'error',
      'test/padding-around-after-all-blocks': 'error',
      'test/padding-around-describe-blocks': 'error',
      'test/padding-around-test-blocks': 'error',
      'test/prefer-called-exactly-once-with': 'error',
      'test/require-local-test-context-for-concurrent-snapshots': 'error',
      'test/valid-describe-callback': 'error',
      'test/valid-expect': 'error',
      'test/valid-expect-in-promise': 'error',
      'test/valid-title': 'error',
    },
  })
