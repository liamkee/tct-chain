CREATE TABLE `ChainHistory` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`timestamp` integer NOT NULL,
	`chain_count` integer NOT NULL,
	`hpm` real NOT NULL,
	`eta` real,
	`recent_hpm` real,
	`metadata` text -- 用于存放原始滑动窗口 JSON
);
