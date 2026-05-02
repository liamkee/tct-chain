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
   * 极限战力推演 (Max Potential Prediction)
   */
  static predictMaxPotential(member: MemberTacticalData) {
    const { cooldowns, is_donator } = member;
    
    // 从基础可用能量开始 (Energy + Refill)
    let totalEnergy = this.getBaseAvailableEnergy(member);

    // 1. Booster (FHC) 推演
    let tempBoosterCD = cooldowns.booster;
    let fhcCount = 0;
    while (tempBoosterCD < TORN_RULES.BOOSTER_MAX_MINUTES) {
      totalEnergy += getItemEnergy(TORN_ITEMS.FHC, is_donator, member.energy.max);
      tempBoosterCD += TORN_ITEMS.FHC.cooldown.base;
      fhcCount++;
      // 特殊处理：理论极限第 5 张
      if (tempBoosterCD === TORN_RULES.BOOSTER_MAX_MINUTES) {
        totalEnergy += getItemEnergy(TORN_ITEMS.FHC, is_donator, member.energy.max);
        fhcCount++;
        break;
      }
    }

    // 2. Drug (Xanax) 推演
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
   * 聚合全帮派战力数据
   */
  static aggregate(members: Record<string, any>, selectedIds?: string[]) {
    let totalAvailableHits = 0;
    let totalMaxPotentialHits = 0;
    
    const targetMembers = selectedIds && selectedIds.length > 0 
      ? Object.entries(members).filter(([id]) => selectedIds.includes(id))
      : Object.entries(members);

    targetMembers.forEach(([_, data]) => {
      const current = this.calculatePotential(data as MemberTacticalData);
      const predicted = this.predictMaxPotential(data as MemberTacticalData);
      
      totalMaxPotentialHits += predicted.maxPotentialHits;
      if (current.isAvailable) {
        totalAvailableHits += current.availableHits;
      }
    });

    return {
      totalAvailableHits,
      totalMaxPotentialHits,
      memberCount: targetMembers.length
    };
  }
}
