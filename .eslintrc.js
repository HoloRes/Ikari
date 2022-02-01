module.exports = {
	env: {
		es2021: true,
		node: true,
	},
	extends: [
		'airbnb-base',
		'airbnb-typescript/base',
	],
	parser: '@typescript-eslint/parser',
	parserOptions: {
		ecmaVersion: 12,
		sourceType: 'module',
		project: './tsconfig.json'
	},
	plugins: [
		'@typescript-eslint',
	],
	rules: {
		indent: 'off',
		'no-bitwise': 'off',
		'no-tabs': 'off',
		'no-plusplus': ['error', {
			allowForLoopAfterthoughts: true,
		}],
		'no-underscore-dangle': 'off', // Disabled as mongoose uses _id
		'@typescript-eslint/indent': ['error', 'tab'],
		'import/no-cycle': 'off',
	},
};
