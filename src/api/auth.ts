import { Hono, Context } from 'hono'
import { getCookie, setCookie, deleteCookie } from 'hono/cookie'
import { sign, verify } from 'hono/jwt'
import { drizzle } from 'drizzle-orm/d1'
import { eq } from 'drizzle-orm'
import { members } from '../db/schema'
import type { Env } from './index'
import { SecurityService } from '../services/security'

const auth = new Hono<Env>()

// Helper: Verify Torn API Key & Faction
async function verifyTornKey(apiKey: string, factionId: string) {
  const res = await fetch(`https://api.torn.com/user/?selections=profile&key=${apiKey}`)
  if (!res.ok) return { error: 'Torn API temporarily unavailable', status: 502 }
  
  const data = await res.json() as any
  if (data.error || !data.player_id) return { error: 'Invalid API Key', status: 400 }
  
  const userFactionId = data.faction?.faction_id?.toString()
  if (userFactionId !== factionId) return { error: 'You are not a member of the authorized faction', status: 403 }
  
  return { success: true, data }
}

// Helper: Set Session Cookie
async function setSessionCookie(c: Context, payload: any, secret: string) {
  const token = await sign(payload, secret, 'HS256')
  setCookie(c, 'tct_session', token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'Lax',
    path: '/'
  })
}

// Step 1: Login Redirect
auth.get('/login', async (c) => {
  const state = crypto.randomUUID()
  setCookie(c, 'oauth_state', state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
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

  // Verify existing API key
  const security = new SecurityService(c.env.ENCRYPTION_SECRET)
  const rawApiKey = await security.decrypt(member[0].api_key)
  if (!rawApiKey) {
    deleteCookie(c, 'tct_session', { path: '/' })
    return c.redirect('/bind?error=decryption_failed')
  }
  
  const tornValidation = await verifyTornKey(rawApiKey, c.env.FACTION_ID)
  if (!tornValidation.success) {
    deleteCookie(c, 'tct_session', { path: '/' })
    return c.redirect(`/unauthorized?reason=${encodeURIComponent(tornValidation.error || 'invalid')}`)
  }

  // Full Authenticated Session
  await setSessionCookie(c, {
    torn_id: member[0].torn_id,
    discord_id: discordId,
    role: member[0].role,
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24h
  }, c.env.JWT_SECRET)

  return c.redirect('/dashboard')
})

// Step 3: API Key Binding
auth.post('/bind', async (c) => {
  const body = await c.req.parseBody()
  const apiKey = body.apiKey as string
  if (!apiKey || apiKey.length !== 16) {
    return c.json({ error: 'Invalid API Key format' }, 400)
  }

  const token = getCookie(c, 'tct_session')
  if (!token) return c.json({ error: 'No active session' }, 401)

  let payload;
  try {
    payload = await verify(token, c.env.JWT_SECRET, 'HS256')
  } catch (e) {
    return c.json({ error: 'Invalid or expired session' }, 401)
  }

  if (payload.role !== 'unverified') {
    return c.json({ error: 'Already verified' }, 400)
  }

  const discordId = payload.discord_id as string

  // Validate Torn Key
  const tornValidation = await verifyTornKey(apiKey, c.env.FACTION_ID)
  if (!tornValidation.success) {
    return c.json({ error: tornValidation.error }, tornValidation.status as any)
  }

  const tornData = tornValidation.data
  const security = new SecurityService(c.env.ENCRYPTION_SECRET)
  const encryptedKey = await security.encrypt(apiKey)

  const db = drizzle(c.env.DB)
  const tornId = tornData.player_id
  const name = tornData.name

  const existing = await db.select().from(members).where(eq(members.discord_id, discordId)).limit(1)
  if (existing.length > 0) {
    await db.update(members).set({
      torn_id: tornId,
      name,
      api_key: encryptedKey,
    }).where(eq(members.discord_id, discordId))
  } else {
    await db.insert(members).values({
      torn_id: tornId,
      discord_id: discordId,
      name,
      api_key: encryptedKey,
      role: 'member',
      is_donator: tornData.donator ? 1 : 0
    })
  }

  // Issue real token
  await setSessionCookie(c, {
    torn_id: tornId,
    discord_id: discordId,
    role: existing.length > 0 ? existing[0].role : 'member',
    exp: Math.floor(Date.now() / 1000) + 60 * 60 * 24, // 24h
  }, c.env.JWT_SECRET)

  return c.json({ success: true, message: 'Bind successful' })
})

// Step 4: Current User Info
auth.get('/me', async (c) => {
  const token = getCookie(c, 'tct_session')
  if (!token) return c.json({ authenticated: false }, 401)

  try {
    const payload = await verify(token, c.env.JWT_SECRET, 'HS256')
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
