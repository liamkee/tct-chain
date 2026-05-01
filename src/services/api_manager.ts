import type { Env } from '../index'

export class ApiManager {
  constructor(private env: Env['Bindings']) {}

  async fetchWithBackoff(url: string, options?: RequestInit, maxRetries = 3): Promise<Response> {
    let attempt = 0;
    let delay = 1000;

    while (attempt < maxRetries) {
      try {
        const res = await fetch(url, options);
        if (res.status === 502 || res.status === 504) {
           throw new Error(`HTTP ${res.status}`);
        }
        return res;
      } catch (err: any) {
        attempt++;
        if (attempt >= maxRetries) {
           this.logAnalytics('api_error', url, err.message);
           throw err;
        }
        await new Promise(resolve => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff (1s, 2s, 4s...)
      }
    }
    throw new Error('Unreachable');
  }

  logAnalytics(event: string, blob1: string = '', blob2: string = '', metric: number = 1) {
    if (this.env.ANALYTICS) {
       this.env.ANALYTICS.writeDataPoint({
          blobs: [event, blob1, blob2],
          doubles: [metric],
          indexes: [event]
       });
    } else {
       console.log(`[Analytics Mock] ${event} | ${blob1} | ${blob2} | value: ${metric}`);
    }
  }
}

export class KeyPool {
   private keys: string[];
   private currentIndex: number = 0;

   constructor(keys: string[]) {
      this.keys = keys.length > 0 ? keys : ['MOCK_KEY'];
   }

   // 80% of 100 limits = 80 threshold
   getKey(usage: number): string {
      if (usage >= 80) {
         this.currentIndex = (this.currentIndex + 1) % this.keys.length;
         console.log(`[KeyPool] Rotated to key index ${this.currentIndex}`);
      }
      return this.keys[this.currentIndex];
   }
}
