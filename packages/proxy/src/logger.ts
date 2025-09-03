import type { LogLevel } from "./env";

type LoggerFn = (msg: string) => void;

export interface Logger {
	level: LogLevel;
	error: LoggerFn;
	warn: LoggerFn;
	info: LoggerFn;
	debug: LoggerFn;
}

const levelOrder: Record<LogLevel, number> = {
	error: 0,
	warn: 1,
	info: 2,
	debug: 3,
};

function makePrinter(level: LogLevel, current: () => LogLevel): LoggerFn {
	return (msg: string) => {
		if (levelOrder[level] <= levelOrder[current()]) {
			// Single-line, stderr only
			const ts = new Date().toISOString();
			const line = `[${ts}] [${level}] ${msg}`;


			console.error(line);
		}
	};
}

export function createLogger(level: LogLevel): Logger {
	let currentLevel: LogLevel = level;
	const getter = () => currentLevel;
	return {
		get level() {
			return currentLevel;
		},
		set level(v: LogLevel) {
			currentLevel = v;
		},
		error: makePrinter("error", getter),
		warn: makePrinter("warn", getter),
		info: makePrinter("info", getter),
		debug: makePrinter("debug", getter),
	} as Logger;
}
