import { TORN_ITEMS, TORN_RULES, getItemEnergy } from '../constants/items';

// ============================================================
// Offline Prediction Types
// ============================================================
export interface OfflineEnergyPrediction {
  energy: number;
  ticksElapsed: number;
  isPredicted: boolean;
}

export interface PredictedCooldowns {
  drug: number;
  booster: number;
  medical: number;
}

/**
 * Per-cooldown-type refresh metadata.
 * Tells the system whether the predicted CD value might be inaccurate
 * and needs fresh API data (only relevant for ONLINE members).
 */
export interface CooldownRefreshFlags {
  drug: boolean;      // true when predicted CD reaches 0 (could take another)
  booster: boolean;   // true when predicted CD < 24h threshold
  medical: boolean;   // true when predicted CD < 6h threshold
}

export interface MemberStatus {
  state: string;
  until: number;
}

export interface MemberTacticalData {
  id: string;
  name: string;
  energy: number;
  energy_max: number;
  cooldowns: {
    drug: number;
    booster: number;
    medical: number;
  };
  status: MemberStatus;
  last_action: {
    status: string;
    seconds: number;
  };

  refill_used: boolean;
}

export class TacticalCalculator {
  // ============================================================
  // Offline Prediction Engine
  // ============================================================

  /**
   * Predict current energy for an offline member based on clock-aligned ticks.
   *
   * Torn's energy regen is NOT "every N minutes from last update" — it fires
   * at fixed server clock boundaries:
   *   Normal:  :00, :15, :30, :45  (every 15 min)
   *   Donator: :00, :10, :20, :30, :40, :50  (every 10 min)
   *
   * We count how many of these boundaries have been crossed since the last
   * known data point. Since 900s and 600s divide evenly into 3600s (1 hour),
   * and hours divide evenly into the Unix epoch, floor(ts / interval) gives
   * us the correct tick index.
   */
  static predictCurrentEnergy(
    lastEnergy: number,
    energyMax: number,
    lastUpdatedTs: number, // unix seconds
    isDonator: boolean
  ): OfflineEnergyPrediction {
    const nowSec = Math.floor(Date.now() / 1000);

    // Interval in seconds (15min = 900s, 10min = 600s)
    const intervalSec = isDonator
      ? TORN_RULES.REGEN_INTERVAL_DONATOR * 60
      : TORN_RULES.REGEN_INTERVAL_NORMAL * 60;

    // Clock-aligned tick index: floor division against epoch
    const lastTickIndex = Math.floor(lastUpdatedTs / intervalSec);
    const nowTickIndex = Math.floor(nowSec / intervalSec);
    const ticksElapsed = Math.max(0, nowTickIndex - lastTickIndex);

    const regenEnergy = ticksElapsed * TORN_RULES.REGEN_AMOUNT;

    return {
      energy: Math.min(lastEnergy + regenEnergy, energyMax),
      ticksElapsed,
      isPredicted: ticksElapsed > 0,
    };
  }

  /**
   * Predict current cooldowns for ANY member (online or offline).
   * Cooldowns are countdown timers in seconds — subtract elapsed time.
   *
   * Per-type stacking rules:
   *   Drug:    Cannot stack. Once detected, countdown is 100% predictable.
   *   Medical: 6h limit. Predictable while > 6h. Below 6h, member could
   *            use another medical item (if online), invalidating prediction.
   *   Booster: 24h limit. Predictable while > 24h. Below 24h, member could
   *            use another booster (if online), invalidating prediction.
   *
   * For OFFLINE members, all CDs are always predictable (can't use items).
   */
  static predictCurrentCooldowns(
    cooldowns: { drug: number; booster: number; medical: number },
    lastUpdatedTs: number // unix seconds
  ): { predicted: PredictedCooldowns; needsRefresh: CooldownRefreshFlags } {
    const nowSec = Math.floor(Date.now() / 1000);
    const elapsedSeconds = Math.max(0, nowSec - lastUpdatedTs);

    const predicted: PredictedCooldowns = {
      drug: Math.max(0, (cooldowns.drug || 0) - elapsedSeconds),
      booster: Math.max(0, (cooldowns.booster || 0) - elapsedSeconds),
      medical: Math.max(0, (cooldowns.medical || 0) - elapsedSeconds),
    };

    // Refresh flags: does this CD type need fresh API data?
    // Only meaningful for ONLINE members (offline always use prediction).
    const needsRefresh: CooldownRefreshFlags = {
      // Drug: no CD = member can take drug at any time (if online)
      drug: predicted.drug === 0,
      // Booster: needs refresh when predicted drops below 24h threshold
      booster: predicted.booster < TORN_RULES.BOOSTER_CD_THRESHOLD && (cooldowns.booster || 0) > 0,
      // Medical: needs refresh when predicted drops below 6h threshold
      medical: predicted.medical < TORN_RULES.MEDICAL_CD_THRESHOLD && (cooldowns.medical || 0) > 0,
    };

    return { predicted, needsRefresh };
  }

  /**
   * 基础能量计算 (Internal helper for deduplication)
   */
  private static getBaseAvailableEnergy(member: MemberTacticalData): number {
    const { energy, energy_max, refill_used } = member;
    let total = energy || 0;
    
    // 如果 Refill 沒用過，計入一次
    if (!refill_used) {
      total += getItemEnergy(TORN_ITEMS.REFILL, energy_max);
    }
    return total;
  }

  /**
   * 計算單個成員的即戰力 (Current Available)
   * 修正：離線成員如果沒住院，其現有能量也應算作即時戰力
   */
  static calculatePotential(member: MemberTacticalData) {
    const { energy_max, status } = member;
    
    // 1. 判斷是否“可出擊”：只要沒住院、沒坐牢、沒旅遊，能量就是隨時可用的
    const isTacticallyAvailable = !['Hospital', 'Jail', 'Traveling'].includes(status.state);
    
    // 2. 計算當前能量 (不含資源)
    const currentEnergy = member.energy || 0;
    const availableHits = Math.floor(currentEnergy / TORN_RULES.ENERGY_PER_HIT);
    
    return {
      isAvailable: isTacticallyAvailable,
      availableHits,
      maxEnergy: energy_max || TORN_RULES.BASE_ENERGY_NORMAL
    };
  }

  /**
   * 爆發力推演 (Burst Potential) - 現有 + Refill + 1 Xanax
   * 不再計算 FHC，因為那不是常規戰術參考
   */
  static predictBurstPotential(member: MemberTacticalData) {
    const { energy_max, cooldowns, status } = member;
    if (['Hospital', 'Jail', 'Traveling'].includes(status.state)) {
      return { totalPotentialEnergy: 0, maxPotentialHits: 0 };
    }

    let totalEnergy = member.energy || 0;

    // 1. Refill
    if (!member.refill_used) {
      totalEnergy += getItemEnergy(TORN_ITEMS.REFILL, energy_max);
    }

    // 2. Xanax (如果沒 CD)
    let xanaxCount = 0;
    if (cooldowns && (cooldowns.drug || 0) === 0) {
      totalEnergy += getItemEnergy(TORN_ITEMS.XANAX);
      xanaxCount++;
    }

    return {
      totalPotentialEnergy: totalEnergy,
      maxPotentialHits: Math.floor(totalEnergy / TORN_RULES.ENERGY_PER_HIT),
      resourcesUsed: {
        xanax: xanaxCount,
        refill: !member.refill_used
      }
    };
  }

  /**
   * 動態時間軸戰力預測 (Time-Aware Potential Prediction)
   * 修正：不再計算 FHC，只計算自然回能 + 1次 Xanax (如果CD到)
   */
  static predictPotentialOverTime(member: MemberTacticalData, targetMinutes: number) {
    const { cooldowns, status, energy_max } = member;
    
    // 1. 基礎可用能量 (當前，不含 Refill)
    let totalEnergy = member.energy || 0;

    // 2. 自然回能 (Regen)
    const now = Math.floor(Date.now() / 1000);
    const hospRemainingSeconds = Math.max(0, (status.until || 0) - now);
    const hospRemainingMinutes = Math.ceil(hospRemainingSeconds / 60);
    
    const effectiveRegenMinutes = Math.max(0, targetMinutes - hospRemainingMinutes);
    const isDonator = (energy_max || 100) > 100;
    const regenInterval = isDonator ? TORN_RULES.REGEN_INTERVAL_DONATOR : TORN_RULES.REGEN_INTERVAL_NORMAL;
    const totalRegenEnergy = Math.floor(effectiveRegenMinutes / regenInterval) * TORN_RULES.REGEN_AMOUNT;
    totalEnergy += totalRegenEnergy;

    // 3. 資源釋放推演 (只計算 Xanax)
    const drugCdMinutes = (cooldowns?.drug || 0) / 60;
    if (drugCdMinutes <= targetMinutes) {
      totalEnergy += getItemEnergy(TORN_ITEMS.XANAX);
    }

    return {
      totalPotentialEnergy: totalEnergy,
      potentialHits: Math.floor(totalEnergy / TORN_RULES.ENERGY_PER_HIT),
      predictionWindow: targetMinutes
    };
  }

  /**
   * 聚合全幫派戰力數據
   */
  static aggregate(members: Record<string, any>, selectedIds?: string[]) {
    let totalAvailableHits = 0;
    let totalBurstHits = 0; // 改名：Burst Potential
    let totalProjectedHits1h = 0;
    
    const targetMembers = selectedIds && selectedIds.length > 0 
      ? Object.entries(members).filter(([id]) => selectedIds.includes(id))
      : Object.entries(members);

    targetMembers.forEach(([_, data]) => {
      const memberData = data as MemberTacticalData;
      const current = TacticalCalculator.calculatePotential(memberData);
      const burst = TacticalCalculator.predictBurstPotential(memberData);
      const projected1h = TacticalCalculator.predictPotentialOverTime(memberData, 60);
      
      totalBurstHits += burst.maxPotentialHits;
      totalProjectedHits1h += projected1h.potentialHits;
      if (current.isAvailable) {
        totalAvailableHits += current.availableHits;
      }
    });

    return {
      totalAvailableHits,
      totalMaxPotentialHits: totalBurstHits, // 保持 Key 名不變，以免前端崩潰
      totalProjectedHits1h,
      memberCount: targetMembers.length
    };
  }
}
