import { Hono } from 'hono'
import type { Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { members, factions } from '../db/schema'
import type { Env } from './index'
import { SecurityService } from '../services/security'

const auth = new Hono<Env>()

// Helper: Verify Torn API Key
async function verifyTornKey(apiKey: string) {
  const res = await fetch(`https://api.torn.com/user/?selections=profile,bars,cooldowns,refills&key=${apiKey}`)
  if (!res.ok) return { error: 'Torn API temporarily unavailable', status: 502 }
  
  const data = await res.json() as any
  if (data.error) {
    if (data.error.code === 16) {
      return { error: 'Limited Access API Key required. Your key access level is too low.', status: 403 }
    }
    return { error: data.error.error || 'Invalid API Key', status: 400 }
  }
  if (!data.player_id) return { error: 'Invalid API Key', status: 400 }
  
  return { success: true, data }
}

// Helper: Set Session Cookie
async function setSessionCookie(c: Context, payload: any, secret: string) {
  const token = await sign(payload, secret, 'HS256')
  const isSecure = new URL(c.req.url).protocol === 'https:'
  setCookie(c, 'tct_session', token, {
    httpOnly: true,
    secure: isSecure,
    sameSite: 'Lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 30 // 30 days
  })
}

// Step 1: Login Redirect
auth.get('/login', async (c) => {
  const state = crypto.randomUUID()
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: new URL(c.req.url).protocol === 'https:',
    sameSite: 'Lax',
    maxAge: 60 * 10, // 10 minutes
    path: '/'
  })

  const url = new URL(c.req.url)
  const redirectUri = `${url.origin}/api/auth/callback`

  const discordAuthUrl = new URL('https://discord.com/api/oauth2/authorize')
  discordAuthUrl.searchParams.set('client_id', c.env.DISCORD_CLIENT_ID)
  discordAuthUrl.searchParams.set('redirect_uri', redirectUri)
  discordAuthUrl.searchParams.set('response_type', 'code')
  discordAuthUrl.searchParams.set('scope', 'identify')
  discordAuthUrl.searchParams.set('state', state)

  return c.redirect(discordAuthUrl.toString())
})

// Step 2: Callback
auth.get('/callback', async (c) => {
  const code = c.req.query('code')
  const state = c.req.query('state')
  const storedState = getCookie(c, 'oauth_state')

  // CSRF Check
  if (!state || !storedState || state !== storedState) {
    return c.text('CSRF Validation Failed', 400)
  }
  
  deleteCookie(c, 'oauth_state', { path: '/' })

  if (!code) return c.text('No authorization code provided', 400)

  const url = new URL(c.req.url)
  const redirectUri = `${url.origin}/api/auth/callback`

  // Exchange Code for Token
  const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: c.env.DISCORD_CLIENT_ID,
      client_secret: c.env.DISCORD_CLIENT_SECRET,
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
    }),
  })

  if (!tokenRes.ok) return c.text('Failed to exchange token with Discord', 400)

  const tokenData = await tokenRes.json() as { access_token: string }

  // Get Discord User Info
  const userRes = await fetch('https://discord.com/api/users/@me', {
    headers: { Authorization: `Bearer ${tokenData.access_token}` },
  })

  if (!userRes.ok) return c.text('Failed to fetch Discord user info', 400)

  const discordUser = await userRes.json() as { id: string, username: string }
  const discordId = discordUser.id

  const db = drizzle(c.env.DB)
  const member = await db.select().from(members).where(eq(members.discord_id, discordId)).limit(1)

  if (member.length === 0 || !member[0].api_key) {
    // Unverified Temp Session
    await setSessionCookie(c, {
      discord_id: discordId,
      username: discordUser.username,
      role: 'unverified',
      exp: Math.floor(Date.now() / 1000) + 60 * 30, // 30 mins
    }, c.env.JWT_SECRET)
    return c.redirect('/bind')
  }

  // Full Authenticated Session
  await setSessionCookie(c, {
    torn_id: member[0].torn_id,
    discord_id: discordId,
    faction_id: member[0].faction_id,
    role: member[0].role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
  }, c.env.JWT_SECRET)

  return c.redirect('/dashboard')
})

// Step 3: API Key Verification (Preview)
auth.post('/verify', async (c) => {
  const { apiKey } = await c.req.json() as { apiKey: string }
  if (!apiKey || apiKey.length !== 16) {
    return c.json({ error: 'Invalid API Key format' }, 400)
  }

  const tornValidation = await verifyTornKey(apiKey)
  if (!tornValidation.success) {
    return c.json({ error: tornValidation.error }, tornValidation.status as any)
  }

  const data = tornValidation.data
  return c.json({
    success: true,
    profile: {
      name: data.name,
      player_id: data.player_id,
      faction_name: data.faction?.faction_name,
      faction_id: data.faction?.faction_id
    }
  })
})

auth.post('/bind', async (c) => {
  const body = await c.req.json() as { apiKey: string }
  const apiKey = body.apiKey
  if (!apiKey || apiKey.length !== 16) {
    return c.json({ error: 'Invalid API Key format' }, 400)
  }

  // We check for an existing session but don't strictly require it
  const token = getCookie(c, 'tct_session')
  let discordId = null
  if (token) {
    try {
      const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
      discordId = payload.discord_id
    } catch (e) {}
  }

  // Validate Torn Key
  const tornValidation = await verifyTornKey(apiKey)
  if (!tornValidation.success) {
    return c.json({ error: tornValidation.error }, tornValidation.status as any)
  }

  const tornData = tornValidation.data
  const security = new SecurityService(c.env.ENCRYPTION_SECRET)
  const encryptedKey = await security.encrypt(apiKey)

  const db = drizzle(c.env.DB)
  const tornId = tornData.player_id
  const name = tornData.name
  const factionId = tornData.faction?.faction_id
  const factionName = tornData.faction?.faction_name

  if (!factionId) {
    return c.json({ error: 'You must be in a faction to use this tool' }, 400)
  }

  // Detect Role: Leaders and Co-leaders are automatically admins
  const position = tornData.faction?.position || ''
  const isLeader = position === 'Leader' || position === 'Co-leader'
  const detectedRole = isLeader ? 'admin' : 'member'

  // Upsert Faction
  await db.insert(factions).values({
    id: factionId,
    name: factionName,
  }).onConflictDoUpdate({
    target: factions.id,
    set: { name: factionName }
  })

  const existing = await db.select().from(members).where(eq(members.torn_id, tornId)).limit(1)
  if (existing.length > 0) {
    await db.update(members).set({
      name,
      api_key: encryptedKey,
      role: isLeader ? 'admin' : existing[0].role, // Upgrade to admin if leader, else keep existing
      faction_id: factionId,
      discord_id: discordId || existing[0].discord_id
    }).where(eq(members.torn_id, tornId))
  } else {
    await db.insert(members).values({
      torn_id: tornId,
      discord_id: discordId,
      name,
      api_key: encryptedKey,
      role: detectedRole,

      faction_id: factionId
    })
  }

  const finalRole = isLeader ? 'admin' : (existing.length > 0 ? existing[0].role : 'member')

  // Issue real token
  await setSessionCookie(c, {
    torn_id: tornId,
    discord_id: discordId,
    faction_id: factionId,
    role: finalRole,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24 * 30, // 30 days
  }, c.env.JWT_SECRET)

  // 🚀 Proactive DO Ping: Ensure new member is picked up immediately
  try {
    const id = c.env.CHAIN_MONITOR.idFromName(factionId.toString())
    const monitor = c.env.CHAIN_MONITOR.get(id)
    await monitor.fetch('http://do/internal/init', {
      method: 'POST',
      body: JSON.stringify({ factionId: factionId.toString(), tornId: tornId.toString() })
    })
    // ⚠️ DO NOT automatically start the engine here. 
    // It should only start when the user explicitly clicks the switch 
    // or when the scheduled faction poller triggers it (which respects the global switch).
  } catch (e) {
    console.error(`[Auth] Failed to proactively ping DO for faction ${factionId}:`, e)
  }

  return c.json({ success: true, message: 'Bind successful', faction_id: factionId })
})

// Step 5: Current User Info
auth.get('/me', async (c) => {
  const token = getCookie(c, 'tct_session')
  if (!token) return c.json({ authenticated: false }, 401)

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256') as any
    
    // 🚀 Session Persistence Logic: Validate Torn API Key
    if (payload.torn_id && payload.role !== 'unverified') {
      const db = drizzle(c.env.DB)
      const member = await db.select().from(members).where(eq(members.torn_id, payload.torn_id)).limit(1)
      
      if (member.length > 0 && member[0].api_key) {
        const security = new SecurityService(c.env.ENCRYPTION_SECRET)
        const rawKey = await security.decrypt(member[0].api_key)
        
        if (rawKey) {
          // Quick ping to Torn to ensure key is still valid
          const res = await fetch(`https://api.torn.com/user/?selections=basic&key=${rawKey}`)
          const data = await res.json() as any
          
          if (data.error) {
            console.log(`[Auth] Invaliding session for ${payload.torn_id} due to API error: ${data.error.error}`)
            deleteCookie(c, 'tct_session', { path: '/' })
            return c.json({ authenticated: false, error: 'Session expired due to invalid API key' }, 401)
          }
        }
      }
    }

    return c.json({
      authenticated: true,
      user: payload
    })
  } catch (e) {
    return c.json({ authenticated: false }, 401)
  }
})

auth.get('/logout', (c) => {
  deleteCookie(c, 'tct_session', { path: '/' })
  return c.redirect('/')
})

export default auth
