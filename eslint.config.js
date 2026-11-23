import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'

export default tseslint.config(
  { ignores: ['dist', '.tmp', 'playwright-report', 'test-results'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  { files: ['**/*.{js,ts,tsx,mjs}'], languageOptions: { globals: { ...globals.browser, ...globals.node } } },
  { files: ['src/**/*.{ts,tsx}'], ...reactHooks.configs.flat['recommended-latest'] },
)
