import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const factions = sqliteTable('Factions', {
  id: integer('id').primaryKey(),
  name: text('name').notNull(),
  commander_api_key: text('commander_api_key'),
  status: text('status').default('active'),
});

export const members = sqliteTable('Members', {
  torn_id: integer('torn_id').primaryKey(),
  name: text('name').notNull(),
  api_key: text('api_key'),
  discord_id: text('discord_id'),
  is_donator: integer('is_donator').default(0),
  role: text('role').default('member'),
  faction_id: integer('faction_id').references(() => factions.id),
}, (table) => ({
  discordIdIdx: index('discord_id_idx').on(table.discord_id),
  factionIdIdx: index('faction_id_idx').on(table.faction_id),
}));
export const chainHistory = sqliteTable('ChainHistory', {
  id: integer('id').primaryKey({ autoIncrement: true }),
  faction_id: integer('faction_id').notNull().references(() => factions.id),
  timestamp: integer('timestamp').notNull(),
  chain_count: integer('chain_count').notNull(),
  hpm: integer('hpm').notNull(),
  eta: integer('eta'),
  recent_hpm: integer('recent_hpm'),
  metadata: text('metadata'),
});
