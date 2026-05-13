PRAGMA foreign_keys = OFF; PRAGMA defer_foreign_keys=TRUE;
CREATE TABLE d1_migrations(
		id         INTEGER PRIMARY KEY AUTOINCREMENT,
		name       TEXT UNIQUE,
		applied_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP NOT NULL
);
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(1,'0000_ambitious_vector.sql','2026-05-01 08:13:45');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(2,'0001_stormy_ultimates.sql','2026-05-02 08:50:52');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(3,'0002_add_history_table.sql','2026-05-09 10:27:31');
INSERT INTO "d1_migrations" ("id","name","applied_at") VALUES(4,'0002_concerned_wallop.sql','2026-05-09 10:27:31');

CREATE TABLE `Factions` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`commander_api_key` text,
	`status` text DEFAULT 'active'
);
INSERT INTO "Factions" ("id","name","commander_api_key","status") VALUES(53822,'Black Trail',NULL,'active');

CREATE TABLE `Members` (
	`torn_id` integer PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`api_key` text,
	`discord_id` text,
	`is_donator` integer DEFAULT 0,
	`role` text DEFAULT 'member'
, `faction_id` integer REFERENCES Factions(id));
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(2153760,'xhang98','gVMyz5k7iuSPZPPv:14PPeksFc8RUrZtj71eo1efKPpyvSNXGj+Otjcyu2FE=',NULL,0,'member',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(3146135,'Hamburgerler','2YTxL0OiEnf4+8Va:Yx9H8mm3GZGptWCCTCTmdDuyVCCQyr1kqaq1Jsf4XiQ=',NULL,0,'admin',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(3204607,'Praulent','O6ENivQn/kmo1pS7:oMHjO3PVB0CavZDRgWu0G4A4SEetLtojMd+FhGlBUdI=',NULL,0,'member',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(3819405,'LacyPearl','MsLdVcya5zxoU0ET:ZlBDU1LLwTD9epISN83I86Jh/jcZSDTrE5E34vDaA7o=',NULL,0,'member',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(3825479,'AT0M5K','lZGGoa/wy0ePQhLw:mD7pWat3P08MGX0AVMF01dbPwBQG7BxOJSwE0TKgku4=',NULL,0,'member',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(3912086,'Emil1o','BZzQE009dqf9Hv2k:YOxBlm7KWnfs2Hpqws/mZ3QwDOU2banyyr8Qpp3nFSQ=',NULL,0,'member',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(3962536,'liamk92','Ah6bUitQWmwyxp0J:PVS4L+tsdeIi09+IGopL7nmJqiRMhdSUHjxMTjB3+qY=',NULL,1,'member',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(4011114,'MuzluGofret','9iVLu0CTBhEKn9BM:pVcSTmYBe64TitF+DiH/qqlC+vwppcQDkddp0Y4Giak=',NULL,0,'member',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(4020129,'postOne','xqKin5xQe4PAKcQU:JBI0uIjOT0PkokBoRW6VumyFHuVwfXQs1/ZLQrVNagw=',NULL,0,'member',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(4178705,'c12p06','Jo5pfkne3Iup/Y+Z:JaN3U1xOrEhH0W9qwPWXdtZ7CwXr6LKR9gVuP1zCE+Q=',NULL,0,'member',53822);
INSERT INTO "Members" ("torn_id","name","api_key","discord_id","is_donator","role","faction_id") VALUES(4213642,'Turbetta','AdQKg+lhYVvbQVEa:393qo4J8/r7ib1qsh0bruDsZm1TMMPcfklhe1NFip6A=',NULL,0,'member',53822);

CREATE TABLE `ChainHistory` (
	`id` integer PRIMARY KEY AUTOINCREMENT,
	`timestamp` integer NOT NULL,
	`chain_count` integer NOT NULL,
	`hpm` real NOT NULL,
	`eta` real,
	`recent_hpm` real,
	`metadata` text 
);

DELETE FROM sqlite_sequence;
INSERT INTO "sqlite_sequence" ("name","seq") VALUES('d1_migrations',4);
CREATE INDEX `discord_id_idx` ON `Members` (`discord_id`);
CREATE INDEX `faction_id_idx` ON `Members` (`faction_id`);
