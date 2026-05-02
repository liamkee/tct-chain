import { sqliteTable, text, integer, index } from 'drizzle-orm/sqlite-core';

export const members = sqliteTable('Members', {
  torn_id: integer('torn_id').primaryKey(),
  name: text('name').notNull(),
  api_key: text('api_key'),
  discord_id: text('discord_id'),
  is_donator: integer('is_donator').default(0),
  role: text('role').default('member'),
}, (table) => ({
  discordIdIdx: index('discord_id_idx').on(table.discord_id),
}));
