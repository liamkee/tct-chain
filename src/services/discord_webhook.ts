import { createEmergencyAlert, createMilestoneAlert } from '../utils/embed_templates'
import type { Env } from '../index'

export class DiscordWebhookService {
  private alertsWebhookUrl: string;

  constructor(env: Env['Bindings']) {
    // 优先级：env 变量 > fallback (可以在后续替换为真实的 fallback)
    this.alertsWebhookUrl = env.ALERTS_WEBHOOK_URL || '';
  }

  private async sendWebhook(payload: any) {
    if (!this.alertsWebhookUrl) {
       console.log('[Discord] No webhook URL configured, dropping payload.');
       return false;
    }

    try {
      const res = await fetch(this.alertsWebhookUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      });
      
      if (!res.ok) {
        console.error(`[Discord] Webhook failed with status ${res.status}`);
        return false;
      }
      return true;
    } catch (e) {
      console.error('[Discord] Webhook request error:', e);
      return false;
    }
  }

  async sendEmergencyAlert(timeoutSeconds: number, roleId?: string) {
    const payload = createEmergencyAlert(timeoutSeconds, roleId);
    return await this.sendWebhook(payload);
  }

  async sendMilestone(chainCurrent: number, hpm: number) {
    const payload = createMilestoneAlert(chainCurrent, hpm);
    return await this.sendWebhook(payload);
  }
}
