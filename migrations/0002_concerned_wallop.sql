CREATE TABLE `Factions` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`commander_api_key` text,
	`status` text DEFAULT 'active'
);
--> statement-breakpoint
ALTER TABLE `Members` ADD `faction_id` integer REFERENCES Factions(id);--> statement-breakpoint
CREATE INDEX `faction_id_idx` ON `Members` (`faction_id`);