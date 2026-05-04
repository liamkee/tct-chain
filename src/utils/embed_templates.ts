export const COLORS = {
  EMERGENCY: 0xFF0000,
  MILESTONE: 0x00FF00,
  INFO: 0x0000FF,
  WARNING: 0xFFA500
};

// 辅助函数：生成字符画进度条 [██████░░░░] 60%
export function generateProgressBar(current: number, max: number, length: number = 10): string {
  if (max <= 0) return `[${'░'.repeat(length)}] 0%`;
  const percentage = Math.max(0, Math.min(100, Math.floor((current / max) * 100)));
  const filledLength = Math.max(0, Math.min(length, Math.floor((length * percentage) / 100)));
  const emptyLength = length - filledLength;
  
  const filledBar = '█'.repeat(filledLength);
  const emptyBar = '░'.repeat(emptyLength);
  
  return `[${filledBar}${emptyBar}] ${percentage}%`;
}

export function createEmergencyAlert(timeoutSeconds: number, roleId?: string) {
  const content = roleId ? `<@&${roleId}> ⚠️ **CHAIN EMERGENCY** ⚠️` : `⚠️ **CHAIN EMERGENCY** ⚠️`;
  
  return {
    content,
    embeds: [
      {
        title: "🔥 CHAIN AT RISK 🔥",
        description: `The chain timeout is critically low: **${Math.floor(timeoutSeconds)}s** remaining! Need immediate hits!`,
        color: COLORS.EMERGENCY,
        timestamp: new Date().toISOString()
      }
    ]
  };
}

export function createMilestoneAlert(chainCurrent: number, hpm: number) {
  return {
    content: "🎉 **CHAIN MILESTONE REACHED** 🎉",
    embeds: [
      {
        title: `🏆 Chain hits: ${chainCurrent} 🏆`,
        description: `Excellent work team! We are maintaining a speed of **${Math.floor(hpm)} hits/min**. Keep it up!`,
        color: COLORS.MILESTONE,
        timestamp: new Date().toISOString()
      }
    ]
  };
}

export function createStatusEmbed(chainCurrent: number, chainMax: number, timeout: number, hpm: number) {
  return {
    embeds: [
      {
        title: "📊 Current Chain Status",
        color: timeout < 90 ? COLORS.EMERGENCY : (timeout < 180 ? COLORS.WARNING : COLORS.INFO),
        fields: [
          {
            name: "Progress",
            value: `${generateProgressBar(chainCurrent, chainMax)}\n(${chainCurrent} / ${chainMax})`,
            inline: false
          },
          {
            name: "Timeout",
            value: `${Math.floor(timeout)}s`,
            inline: true
          },
          {
            name: "Speed (HPM)",
            value: `${Math.floor(hpm)} hits/min`,
            inline: true
          }
        ],
        timestamp: new Date().toISOString()
      }
    ]
  };
}
