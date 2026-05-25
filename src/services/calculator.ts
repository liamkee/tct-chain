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
  last_updated?: number;
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

    // 修正：當現有能量已達到或超出上限時，不再進行回能計算，保持原有溢出能量
    const newEnergy = lastEnergy >= energyMax
      ? lastEnergy
      : Math.min(lastEnergy + ticksElapsed * TORN_RULES.REGEN_AMOUNT, energyMax);

    return {
      energy: newEnergy,
      ticksElapsed,
      isPredicted: ticksElapsed > 0 && lastEnergy < energyMax,
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
   * 爆發力推演 (Burst Potential) - 現有 + Refill + 1 Xanax + FHCs
   */
  static predictBurstPotential(member: MemberTacticalData, options: { excludeXanax?: boolean, excludeFHC?: boolean, excludeRefill?: boolean } = {}) {

    const { energy_max, cooldowns, status } = member;


    let totalEnergy = member.energy || 0;

    // 1. Refill
    if (!member.refill_used && !options.excludeRefill) {
      totalEnergy += getItemEnergy(TORN_ITEMS.REFILL, energy_max);
    }

    // 2. Xanax (如果沒 CD)
    let xanaxCount = 0;
    if (cooldowns && (cooldowns.drug || 0) === 0 && !options.excludeXanax) {
      totalEnergy += getItemEnergy(TORN_ITEMS.XANAX);
      xanaxCount++;
    }

    // 3. FHC (Booster cooldown limit is 24h = 86400s)
    let fhcCount = 0;
    const currentBoosterCd = cooldowns?.booster || 0;
    if (currentBoosterCd <= TORN_RULES.BOOSTER_CD_THRESHOLD && !options.excludeFHC) {
      // Calculate how many FHCs (6h = 21600s) can be taken
      // Adding 1 second to threshold perfectly handles Torn's "Over-stacking" wait-1-second mechanic
      fhcCount = Math.ceil((TORN_RULES.BOOSTER_CD_THRESHOLD + 1 - currentBoosterCd) / 21600);
      totalEnergy += fhcCount * (energy_max || 100);
    }

    const currentEnergy = member.energy || 0;
    const currentHits = Math.floor(currentEnergy / TORN_RULES.ENERGY_PER_HIT);
    const totalHits = Math.floor(totalEnergy / TORN_RULES.ENERGY_PER_HIT);

    return {
      totalPotentialEnergy: totalEnergy,
      maxPotentialHits: totalHits,
      reserveHits: totalHits - currentHits,
      resourcesUsed: {
        xanax: xanaxCount,
        refill: !member.refill_used,
        fhc: fhcCount
      }
    };
  }

  /**
   * 動態時間軸戰力預測 (Time-Aware Potential Prediction)
   * 修正：不再計算 FHC，只計算自然回能 + 1次 Xanax (如果CD到)
   */
  static predictPotentialOverTime(member: MemberTacticalData, targetMinutes: number, options: { excludeXanax?: boolean } = {}) {
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
    if (drugCdMinutes <= targetMinutes && !options.excludeXanax) {
      totalEnergy += getItemEnergy(TORN_ITEMS.XANAX);
    }

    return {
      totalPotentialEnergy: totalEnergy,
      potentialHits: Math.floor(totalEnergy / TORN_RULES.ENERGY_PER_HIT),
      predictionWindow: targetMinutes
    };
  }

  static aggregate(members: Record<string, any>, selectedIds?: string[], options: {
    excludeXanax?: boolean,
    excludeFHC?: boolean,
    excludeRefill?: boolean,
    hideOffline?: boolean,
    hideHospital?: boolean,
    hideTraveling?: boolean
  } = {}) {
    let totalAvailableHits = 0;
    let totalBurstHits = 0;
    let totalReserveHits = 0;
    let totalProjectedHits1h = 0;

    const targetMembers = selectedIds && selectedIds.length > 0
      ? Object.entries(members).filter(([id]) => selectedIds.includes(id))
      : Object.entries(members);

    let validMemberCount = 0;

    targetMembers.forEach(([_, data]) => {
      const memberData = data as MemberTacticalData;
      // Skip members who have never been polled successfully
      if (!memberData.last_updated) return;

      // Apply visibility filters to the calculation
      if (options.hideOffline && memberData.last_action?.status === 'Offline') return;
      if (options.hideHospital && memberData.status?.state === 'Hospital') return;
      if (options.hideTraveling && memberData.status?.state === 'Traveling') return;

      validMemberCount++;
      const current = TacticalCalculator.calculatePotential(memberData);
      const burst = TacticalCalculator.predictBurstPotential(memberData, options);
      const projected1h = TacticalCalculator.predictPotentialOverTime(memberData, 60, options);

      totalBurstHits += burst.maxPotentialHits;
      totalReserveHits += burst.reserveHits;
      totalProjectedHits1h += projected1h.potentialHits;
      if (current.isAvailable) {
        totalAvailableHits += current.availableHits;
      }
    });

    return {
      totalAvailableHits,
      totalMaxPotentialHits: totalBurstHits,
      totalReserveHits,
      totalProjectedHits1h,
      memberCount: validMemberCount
    };
  }
}
