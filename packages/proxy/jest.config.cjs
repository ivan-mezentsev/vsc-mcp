module.exports = {
	testEnvironment: "node",
	testMatch: ["**/test/**/*.test.ts"],
	transform: {
		"^.+\\.(ts|tsx)$": [
			"babel-jest",
			{ presets: ["@babel/preset-env", "@babel/preset-typescript"] },
		],
	},
	moduleFileExtensions: ["ts", "js", "json"],
	globals: {
		"ts-jest": {
			tsconfig: "tsconfig.test.json",
		},
	},
};
