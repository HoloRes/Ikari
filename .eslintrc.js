module.exports = {
	env: {
		browser: false,
		node: true,
		commonjs: true,
		es2021: true,
	},
	extends: [
		'airbnb-base',
	],
	parserOptions: {
		ecmaVersion: 12,
	},
	rules: {
		indent: [2, 'tab'],
		'no-tabs': 0,
		'no-underscore-dangle': 0, // Disabled as mongoose uses _id
	},
};
