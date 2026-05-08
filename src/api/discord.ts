import { Hono } from 'hono'
import { verifyKey, InteractionType, InteractionResponseType } from 'discord-interactions'
import { createStatusEmbed } from '../utils/embed_templates'
import type { Env } from '../index'

const discord = new Hono<Env>()

// Discord Interaction Verification Middleware
discord.use('/interactions', async (c, next) => {
  const signature = c.req.header('x-signature-ed25519');
  const timestamp = c.req.header('x-signature-timestamp');
  const body = await c.req.text();

  if (!signature || !timestamp) {
    return c.text('Missing signature', 401);
  }

  const isValidRequest = verifyKey(
    body,
    signature,
    timestamp,
    c.env.DISCORD_PUBLIC_KEY
  );

  if (!isValidRequest) {
    return c.text('Bad request signature', 401);
  }

  // Pass the raw string body down as parsed JSON
  c.set('parsedBody', JSON.parse(body));
  await next();
});

discord.post('/interactions', async (c) => {
  const interaction = c.get('parsedBody') as any;

  // Handle Ping (Required by Discord)
  if (interaction.type === InteractionType.PING) {
    return c.json({ type: InteractionResponseType.PONG });
  }

  // Handle Slash Commands
  if (interaction.type === InteractionType.APPLICATION_COMMAND) {
    const { name } = interaction.data;

    if (name === 'chain_status') {
      try {
        // Fetch real-time data from DO
        const id = c.env.CHAIN_MONITOR.idFromName('GLOBAL_MONITOR');
        const stub = c.env.CHAIN_MONITOR.get(id);
        
        const res = await stub.fetch('http://do/snapshot');
        if (!res.ok) throw new Error('Failed to fetch from DO');
        
        const data = await res.json() as any;
        
        const embed = createStatusEmbed(
          data.chain_current || 0,
          data.chain_max || 10,
          data.chain_timeout || 0,
          data.current_hpm || 0
        );

        return c.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: embed
        });
      } catch (e) {
        console.error('Slash command error:', e);
        return c.json({
          type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
          data: { content: '⚠️ Failed to reach Tactical Engine. Please try again later.' }
        });
      }
    }
  }

  return c.json({ error: 'Unknown interaction' }, 400);
});

export default discord;
