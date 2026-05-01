CREATE TABLE `Members` (
	`torn_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`api_key` text,
	`discord_id` text,
	`is_donator` integer DEFAULT 0,
	`role` text DEFAULT 'member'
);
