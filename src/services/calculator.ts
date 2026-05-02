import { TORN_ITEMS, TORN_RULES, getItemEnergy } from '../constants/items';

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
   * 基础能量计算 (Internal helper for deduplication)
   */
  private static getBaseAvailableEnergy(member: MemberTacticalData): number {
    const { energy, is_donator, refill_used } = member;
    let total = energy.current;
    
    // 如果 Refill 没用过，计入一次
    if (!refill_used) {
      total += getItemEnergy(TORN_ITEMS.REFILL, is_donator, energy.max);
    }
    return total;
  }

  /**
   * 计算单个成员的即战力 (Current Available)
   */
  static calculatePotential(member: MemberTacticalData) {
    const { energy, is_donator, last_action } = member;
    
    // 1. 判断是否“可出击”
    const isAvailable = last_action.status !== 'Offline' && !last_action.status.includes('Hospital');
    
    // 2. 计算当前即战力
    const totalEnergy = this.getBaseAvailableEnergy(member);
    const availableHits = Math.floor(totalEnergy / TORN_RULES.ENERGY_PER_HIT);
    
    return {
      isAvailable,
      availableHits,
      maxEnergy: energy.max || (is_donator ? TORN_RULES.BASE_ENERGY_DONATOR : TORN_RULES.BASE_ENERGY_NORMAL)
    };
  }

  /**
   * 极限战力推演 (Max Potential Prediction) - 即时爆种
   */
  static predictMaxPotential(member: MemberTacticalData) {
    const { energy, cooldowns, is_donator } = member;
    let totalEnergy = this.getBaseAvailableEnergy(member);

    // Booster (FHC) 推演
    let tempBoosterCD = cooldowns.booster;
    let fhcCount = 0;
    while (tempBoosterCD < TORN_RULES.BOOSTER_MAX_MINUTES) {
      totalEnergy += getItemEnergy(TORN_ITEMS.FHC, is_donator, energy.max);
      tempBoosterCD += TORN_ITEMS.FHC.cooldown.base;
      fhcCount++;
      if (tempBoosterCD === TORN_RULES.BOOSTER_MAX_MINUTES) {
        totalEnergy += getItemEnergy(TORN_ITEMS.FHC, is_donator, energy.max);
        fhcCount++;
        break;
      }
    }

    // Drug (Xanax) 推演
    let xanaxCount = 0;
    if (cooldowns.drug === 0) {
      totalEnergy += getItemEnergy(TORN_ITEMS.XANAX, is_donator);
      xanaxCount++;
    }

    return {
      totalPotentialEnergy: totalEnergy,
      maxPotentialHits: Math.floor(totalEnergy / TORN_RULES.ENERGY_PER_HIT),
      resourcesUsed: {
        fhc: fhcCount,
        xanax: xanaxCount,
        refill: !member.refill_used
      }
    };
  }

  /**
   * 动态时间轴战力预测 (Time-Aware Potential Prediction)
   * 计算在未来 targetMinutes 分钟内，该成员理论上能提供的最大击数。
   */
  static predictPotentialOverTime(member: MemberTacticalData, targetMinutes: number) {
    const { energy, cooldowns, is_donator } = member;
    
    // 1. 基础可用能量 (当前 + 未使用的 Refill)
    let totalEnergy = this.getBaseAvailableEnergy(member);

    // 2. 自然回复 (Regen)
    const regenInterval = is_donator ? TORN_RULES.REGEN_INTERVAL_DONATOR : TORN_RULES.REGEN_INTERVAL_NORMAL;
    const totalRegenEnergy = Math.floor(targetMinutes / regenInterval) * TORN_RULES.REGEN_AMOUNT;
    totalEnergy += totalRegenEnergy;

    // 3. 资源释放推演 (随着时间流逝，CD 会下降)
    let effectiveBoosterCD = Math.max(0, cooldowns.booster - targetMinutes);
    let fhcCount = 0;
    while (effectiveBoosterCD < TORN_RULES.BOOSTER_MAX_MINUTES) {
      totalEnergy += getItemEnergy(TORN_ITEMS.FHC, is_donator, energy.max);
      effectiveBoosterCD += TORN_ITEMS.FHC.cooldown.base;
      fhcCount++;
      if (effectiveBoosterCD === TORN_RULES.BOOSTER_MAX_MINUTES) {
        totalEnergy += getItemEnergy(TORN_ITEMS.FHC, is_donator, energy.max);
        fhcCount++;
        break;
      }
    }

    let xanaxCount = 0;
    if (cooldowns.drug <= targetMinutes) {
      totalEnergy += getItemEnergy(TORN_ITEMS.XANAX, is_donator);
      xanaxCount++;
    }

    return {
      totalPotentialEnergy: totalEnergy,
      potentialHits: Math.floor(totalEnergy / TORN_RULES.ENERGY_PER_HIT),
      predictionWindow: targetMinutes
    };
  }

  /**
   * 聚合全帮派战力数据
   */
  static aggregate(members: Record<string, any>, selectedIds?: string[]) {
    let totalAvailableHits = 0;
    let totalMaxPotentialHits = 0;
    let totalProjectedHits1h = 0; // 新增：1小时预测
    
    const targetMembers = selectedIds && selectedIds.length > 0 
      ? Object.entries(members).filter(([id]) => selectedIds.includes(id))
      : Object.entries(members);

    targetMembers.forEach(([_, data]) => {
      const memberData = data as MemberTacticalData;
      const current = this.calculatePotential(memberData);
      const predictedMax = this.predictMaxPotential(memberData);
      const projected1h = this.predictPotentialOverTime(memberData, 60);
      
      totalMaxPotentialHits += predictedMax.maxPotentialHits;
      totalProjectedHits1h += projected1h.potentialHits;
      if (current.isAvailable) {
        totalAvailableHits += current.availableHits;
      }
    });

    return {
      totalAvailableHits,
      totalMaxPotentialHits,
      totalProjectedHits1h,
      memberCount: targetMembers.length
    };
  }
}
