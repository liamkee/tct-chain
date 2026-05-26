import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

// Setup basic polyfills for Web Crypto API in Node 18+
const crypto = globalThis.crypto;

class SecurityService {
  constructor(secretKey) {
    this.secretKey = secretKey;
  }

  async getCryptoKey() {
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(this.secretKey);
    const hash = await crypto.subtle.digest('SHA-256', keyBytes);

    return await crypto.subtle.importKey(
      'raw',
      hash,
      'AES-GCM',
      false,
      ['encrypt', 'decrypt']
    );
  }

  base64ToBuffer(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async decrypt(encryptedData) {
    try {
      const parts = encryptedData.split(':');
      if (parts.length !== 2) return null;

      const iv = this.base64ToBuffer(parts[0]);
      const ciphertext = this.base64ToBuffer(parts[1]);
      const key = await this.getCryptoKey();

      const decryptedBuffer = await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: new Uint8Array(iv) },
        key,
        ciphertext
      );

      return new TextDecoder().decode(decryptedBuffer);
    } catch (e) {
      return null;
    }
  }
}

async function run() {
  const envContent = fs.readFileSync('.dev.vars', 'utf-8');
  let secret = '';
  for (const line of envContent.split('\n')) {
    if (line.startsWith('ENCRYPTION_SECRET=')) {
      secret = line.split('=')[1].trim();
    }
  }

  if (!secret) {
    console.error('No ENCRYPTION_SECRET found');
    return;
  }

  const security = new SecurityService(secret);
  const dbPath = path.join('.wrangler', 'state', 'v3', 'd1', 'miniflare-D1DatabaseObject', 'e77f8bcdadc60924fd6b2a59552ddad1c6ba89b80d9aca15dae570d77eee1ccb.sqlite');
  
  if (!fs.existsSync(dbPath)) {
    console.error('Database file not found at', dbPath);
    return;
  }

  const db = new Database(dbPath);
  const members = db.prepare('SELECT torn_id as id, name, api_key FROM members WHERE api_key IS NOT NULL').all();

  console.log(`Found ${members.length} members with API keys. Checking API levels...`);
  console.log('--------------------------------------------------');

  for (const member of members) {
    let key = member.api_key;
    if (key.includes(':')) {
      key = await security.decrypt(key);
    }
    
    if (!key) {
      console.log(`[${member.id}] ${member.name.padEnd(15)} : FAILED TO DECRYPT KEY`);
      continue;
    }

    try {
      const res = await fetch(`https://api.torn.com/key/?selections=info&key=${key}`);
      const data = await res.json();

      if (data.error) {
        console.log(`[${member.id}] ${member.name.padEnd(15)} : API ERROR - Code ${data.error.code} (${data.error.error})`);
      } else {
        const accessLevel = data.access_level;
        const accessType = data.access_type;
        const color = accessLevel >= 3 ? '\x1b[32m' : '\x1b[31m'; // Green if >=3 (Limited/Full), Red if <3
        console.log(`[${member.id}] ${member.name.padEnd(15)} : ${color}Level ${accessLevel} (${accessType})\x1b[0m`);
      }
    } catch (e) {
      console.log(`[${member.id}] ${member.name.padEnd(15)} : NETWORK ERROR`);
    }
    
    // Add a tiny delay to not hammer Torn API
    await new Promise(r => setTimeout(r, 200));
  }
}

run().catch(console.error);
