import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';
import prettier from 'eslint-plugin-prettier/recommended';

export default tseslint.config(
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    prettier,
    {
        files: ['src/**/*.ts', 'src/**/*.tsx'],
        languageOptions: {
            ecmaVersion: 2020,
            sourceType: 'module',
        },
    },
    {
        ignores: ['dist/**', 'node_modules/**', '*.js', '*.mjs'],
    },
);
