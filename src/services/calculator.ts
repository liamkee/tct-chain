export interface MemberStatus {
  state: string;
  status: string;
  until?: number;
}

export interface MemberTacticalData {
  energy: {
    current: number;
    max: number;
  };
  cooldowns: {
    drug: number;
    booster: number;
    medical: number;
  };
  last_action: {
    status: string;
    relative: string;
  };
  is_donator: boolean;
  refill_used: boolean;
}

export class TacticalCalculator {
  /**
   * 计算单个成员的即战力
   */
  static calculatePotential(member: MemberTacticalData) {
    const { energy, is_donator, refill_used, last_action } = member;
    
    // 1. 判断是否“在线/可出击”
    const isAvailable = last_action.status !== 'Offline' && !last_action.status.includes('Hospital');
    
    // 2. 计算剩余潜在出击数 (假设每次攻击消耗 25 能量)
    let potentialHits = Math.floor(energy.current / 25);
    
    // 如果 Refill 没用过，额外增加能量对应的次数
    // 注意：Torn 中 Refill 补充的数量等于你的当前最大能量 (通常是 100/150，但有 Merit 时最高 250)
    if (!refill_used) {
      const refillEnergy = energy.max || (is_donator ? 150 : 100);
      potentialHits += Math.floor(refillEnergy / 25);
    }
    
    return {
      isAvailable,
      potentialHits,
      maxEnergy: energy.max || (is_donator ? 150 : 100)
    };
  }

  /**
   * 聚合全帮派战力数据
   */
  static aggregate(members: Record<string, any>, selectedIds?: string[]) {
    let totalAvailableHits = 0;
    let totalPotentialHits = 0;
    
    const targetMembers = selectedIds && selectedIds.length > 0 
      ? Object.entries(members).filter(([id]) => selectedIds.includes(id))
      : Object.entries(members);

    targetMembers.forEach(([_, data]) => {
      // 这里的 data 结构取决于 DO 存储的格式
      // 我们需要从 DO 存储的多个 key 中拼凑 MemberTacticalData
      const calc = this.calculatePotential(data as MemberTacticalData);
      
      totalPotentialHits += calc.potentialHits;
      if (calc.isAvailable) {
        totalAvailableHits += calc.potentialHits;
      }
    });

    return {
      totalAvailableHits,
      totalPotentialHits,
      memberCount: targetMembers.length
    };
  }
}
