export class SecurityService {
  private secretKey: string;

  constructor(secretKey: string) {
    this.secretKey = secretKey;
  }

  private async getCryptoKey(): Promise<CryptoKey> {
    const encoder = new TextEncoder();
    const keyBytes = encoder.encode(this.secretKey);
    // Hash to ensure 32 bytes (256-bit)
    const hash = await crypto.subtle.digest('SHA-256', keyBytes);

    return await crypto.subtle.importKey(
      'raw',
      hash,
      'AES-GCM',
      false,
      ['encrypt', 'decrypt']
    );
  }

  private bufferToBase64(buffer: ArrayBuffer): string {
    let binary = '';
    const bytes = new Uint8Array(buffer);
    for (let i = 0; i < bytes.byteLength; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  private base64ToBuffer(base64: string): ArrayBuffer {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
  }

  async encrypt(plaintext: string): Promise<string> {
    const key = await this.getCryptoKey();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const encoded = new TextEncoder().encode(plaintext);

    const ciphertextBuffer = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      encoded
    );

    const ivBase64 = this.bufferToBase64(iv.buffer);
    const ciphertextBase64 = this.bufferToBase64(ciphertextBuffer);

    return `${ivBase64}:${ciphertextBase64}`;
  }

  async decrypt(encryptedData: string): Promise<string | null> {
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
      console.error('Decryption failed, key mismatch or tampered data.', e);
      return null;
    }
  }
}
