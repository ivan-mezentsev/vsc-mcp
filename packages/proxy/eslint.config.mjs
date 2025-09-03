import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";
import eslintConfigPrettier from "eslint-config-prettier";
import eslintPluginPrettier from "eslint-plugin-prettier";

export default [
	js.configs.recommended,
	{
		files: ["**/*.ts", "**/*.js"],
		languageOptions: {
			parser: tsparser,
			ecmaVersion: 2020,
			sourceType: "module",
			globals: {
				node: true,
				console: "readonly",
				process: "readonly",
				__dirname: "readonly",
				setTimeout: "readonly",
			},
		},
		plugins: {
			"@typescript-eslint": tseslint,
			prettier: eslintPluginPrettier,
		},
		rules: {
			...tseslint.configs.recommended.rules,
			...tseslint.configs["eslint-recommended"].rules,
			"no-unused-vars": "off",
			"@typescript-eslint/no-unused-vars": [
				"error",
				{
					argsIgnorePattern: "^_",
				},
			],
			"@typescript-eslint/ban-ts-comment": "error",
			"no-prototype-builtins": "error",
			"@typescript-eslint/no-empty-function": "off",
			"prettier/prettier": "error",
		},
	},
	// Prettier integration - must be last to override conflicting rules
	eslintConfigPrettier,
	// Jest test files configuration
	{
		files: ["**/*.test.ts"],
		languageOptions: {
			globals: {
				jest: "readonly",
				describe: "readonly",
				test: "readonly",
				it: "readonly",
				expect: "readonly",
				beforeEach: "readonly",
				afterEach: "readonly",
				beforeAll: "readonly",
				afterAll: "readonly",
				navigator: "readonly",
			},
		},
	},
	// Node.js files configuration
	{
		files: ["**/*.js"],
		languageOptions: {
			globals: {
				module: "readonly",
				require: "readonly",
				exports: "readonly",
				__dirname: "readonly",
				__filename: "readonly",
				global: "readonly",
				process: "readonly",
				Buffer: "readonly",
				navigator: "readonly",
			},
		},
		rules: {
			"@typescript-eslint/no-require-imports": "off",
		},
	},
	// CommonJS helpers (wrapper)
	{
		files: ["**/*.cjs"],
		languageOptions: {
			globals: {
				require: "readonly",
				module: "readonly",
				__dirname: "readonly",
				process: "readonly",
				console: "readonly",
			},
		},
	},
	{
		ignores: ["node_modules/", "dist/", "version-bump.mjs", "**/jest.*"],
	},
];
