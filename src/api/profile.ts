import { Hono } from 'hono'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { getCookie } from 'hono/cookie'
import { verify } from 'hono/jwt'
import { members } from '../db/schema'
import { SecurityService } from '../services/security'
import type { Env } from './index'

const profile = new Hono<Env>()

profile.get('/gym-data', async (c) => {
  const token = getCookie(c, 'tct_session')
  if (!token) return c.json({ error: 'Unauthorized' }, 401)

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
    if (!payload.torn_id) return c.json({ error: 'Invalid session' }, 401)

    const db = drizzle(c.env.DB)
    const member = await db.select().from(members).where(eq(members.torn_id, payload.torn_id)).limit(1)

    if (member.length === 0 || !member[0].api_key) {
      return c.json({ error: 'API key not found. Please re-bind.' }, 400)
    }

    const security = new SecurityService(c.env.ENCRYPTION_SECRET)
    const rawKey = await security.decrypt(member[0].api_key)

    if (!rawKey) {
      return c.json({ error: 'Decryption failed' }, 500)
    }

    // Fetch user's exact stats, merits, perks, and profile
    const res = await fetch(`https://api.torn.com/user/?selections=battlestats,merits,perks,profile,bars,cooldowns&key=${rawKey}`)
    const data = await res.json() as any

    if (data.error) {
      return c.json({ error: data.error.error || 'Torn API Error' }, 400)
    }

    return c.json({
      success: true,
      data: {
        player_id: data.player_id,
        name: data.name,
        battlestats: {
          strength: data.strength,
          speed: data.speed,
          defense: data.defense,
          dexterity: data.dexterity,
          total: data.total,
          strength_modifier: data.strength_modifier,
          speed_modifier: data.speed_modifier,
          defense_modifier: data.defense_modifier,
          dexterity_modifier: data.dexterity_modifier
        },
        merits: data.merits,
        perks: {
          job_perks: data.job_perks,
          property_perks: data.property_perks,
          stock_perks: data.stock_perks,
          merit_perks: data.merit_perks,
          education_perks: data.education_perks,
          enhancer_perks: data.enhancer_perks,
          faction_perks: data.faction_perks,
          book_perks: data.book_perks
        },
        energy: data.energy,
        happy: data.happy,
        cooldowns: data.cooldowns,
        status: data.status,
        faction: data.faction
      }
    })

  } catch (e) {
    console.error('[Profile API] Error:', e)
    return c.json({ error: 'Internal Server Error' }, 500)
  }
})

export default profile
