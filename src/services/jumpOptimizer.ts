import { ITEM_PRICES, TORN_ITEMS } from '../constants/items';
import { calculateJump, type JumpConfig } from './jumpCalculator';
import { calculateBatchTrain } from './gymEngine';

export interface OptimizerParams {
  baseEnergy: number;
  baseHappy: number;
  maxEnergy: number;
  statType: 'strength' | 'speed' | 'defense' | 'dexterity';
  currentStat: number;
  gymDots: number;
  energyPerTrain: number;
  perkMultiplier: number;
  naturalEnergyPerDay: number; // NEW
}

export interface OptimalPreset {
  id: string; // 'max_stat', 'efficiency', 'economical', 'drug_free'
  label: string;
  config: JumpConfig['items'];
  statGain: number;
  cost: number;
  timeMins: number;
  gain24h: number;
  cost24h: number;
}

export function generateOptimalPresets(params: OptimizerParams): OptimalPreset[] {
  const predefinedJumps = [
    {
      id: 'jump_standard',
      label: 'eDVD Happy Jump (4x Xanax + 5x eDVD + Ecstasy)',
      config: { xanax: 4, edvd: 5, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 1, refill: 1 }
    },
    {
      id: 'jump_choco',
      label: 'Choco Jump (4x Xanax + 49x truffles + Ecstasy)',
      config: { xanax: 4, edvd: 0, truffles: 49, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 1, refill: 1 }
    },
    {
      id: 'jump_daily_routine_extra',
      label: 'Daily Routine Extra (3x Xanax + 1x Refill + 49x Choco)',
      config: { xanax: 3, edvd: 0, truffles: 49, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 0, refill: 1, sleepHours: 8 }
    },
    {
      id: 'jump_fhc',
      label: 'FHC Jump (4x Xanax + 5x FHC + Ecstasy)',
      config: { xanax: 4, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, fhc: 5, ecstasy: 1, refill: 1 }
    },
    {
      id: 'jump_drug_free_edvd',
      label: 'Drug-Free Happy Jump (5x eDVD)',
      config: { xanax: 0, edvd: 5, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 0, refill: 1 }
    }
  ];

  return predefinedJumps.map(preset => {
    // 1. Calculate jump totals
    const jump = calculateJump({
      baseEnergy: params.baseEnergy,
      baseHappy: params.baseHappy,
      maxEnergy: params.maxEnergy,
      items: preset.config
    });

    // 2. Calculate stat gain sequentially (Stacked -> FHC -> Refill)
    const trainResult = calculateJumpStatGain(
      jump,
      params.maxEnergy,
      params.statType,
      params.currentStat,
      params.gymDots,
      params.energyPerTrain,
      params.perkMultiplier,
      preset.config,
      params.baseHappy,
      params.naturalEnergyPerDay
    );

    // 3. Calculate Cost
    const totalCost =
      (preset.config.xanax * ITEM_PRICES.XANAX) +
      (preset.config.edvd * ITEM_PRICES.EDVD) +
      (preset.config.truffles * ITEM_PRICES.TRUFFLES) +
      (preset.config.tootsie * ITEM_PRICES.TOOTSIE) +
      (preset.config.lollipop * ITEM_PRICES.LOLLIPOP) +
      (preset.config.fhc * ITEM_PRICES.FHC) +
      (preset.config.ecstasy * ITEM_PRICES.ECSTASY) +
      (preset.config.refill * ITEM_PRICES.POINT * 25);

    // 4. Calculate Time
    const totalTimeMins = jump.prepTimeMins + jump.totalDrugCdMins + jump.totalBoosterCdMins;

    // 5. Calculate 24h Yield
    let gain24h, cost24h;
    if (preset.id === 'jump_daily_routine_extra') {
      gain24h = trainResult.totalStatGained;
      cost24h = totalCost;
    } else {
      const isStackedJump = preset.config.xanax > 1; // Stacking Xanax wastes natural energy
      const hasRefill = preset.config.refill > 0;
      const yieldRes = calculate24hYield(
        trainResult.totalStatGained,
        totalCost,
        totalTimeMins,
        isStackedJump,
        hasRefill,
        params.baseHappy,
        params.statType,
        params.currentStat,
        params.gymDots,
        params.energyPerTrain,
        params.perkMultiplier,
        params.naturalEnergyPerDay
      );
      gain24h = yieldRes.gain24h;
      cost24h = yieldRes.cost24h;
    }

    return {
      id: preset.id,
      label: preset.label,
      config: preset.config,
      statGain: trainResult.totalStatGained,
      cost: totalCost,
      timeMins: totalTimeMins,
      gain24h,
      cost24h
    };
  });
}

export function calculate24hYield(
  jumpStatGain: number,
  jumpCost: number,
  jumpTimeMins: number,
  isStackedJump: boolean,
  hasRefill: boolean,
  baseHappy: number,
  statType: 'strength' | 'speed' | 'defense' | 'dexterity',
  currentStat: number,
  gymDots: number,
  energyPerTrain: number,
  perkMultiplier: number,
  naturalEnergyPerDay: number
) {
  // If the jump uses a point refill, the true cycle limit is 24 hours (1440 mins) because you only get 1 per day.
  let effectiveTime = jumpTimeMins;
  if (hasRefill) {
    effectiveTime = Math.max(effectiveTime, 1440);
  }

  // Calculate the baseline natural training yield for 24h
  const naturalTrain = calculateBatchTrain(
    statType,
    currentStat,
    baseHappy,
    naturalEnergyPerDay,
    gymDots,
    energyPerTrain,
    perkMultiplier
  );

  // If the jump takes 0 time (No items used, just standard energy)
  if (effectiveTime === 0) {
    return { gain24h: naturalTrain.totalStatGained, cost24h: 0 };
  }

  const cyclesPerDay = 1440 / effectiveTime;

  let total24hGain = jumpStatGain * cyclesPerDay;
  let total24hCost = jumpCost * cyclesPerDay;

  // Add natural energy if it's not a stacked jump
  if (!isStackedJump) {
    total24hGain += naturalTrain.totalStatGained;
  }

  return { gain24h: total24hGain, cost24h: total24hCost };
}

export function calculateJumpStatGain(
  jump: ReturnType<typeof calculateJump>,
  maxEnergy: number,
  statType: 'strength' | 'speed' | 'defense' | 'dexterity',
  currentStat: number,
  gymDots: number,
  energyPerTrain: number,
  perkMultiplier: number,
  config?: JumpConfig['items'],
  baseHappy?: number,
  naturalEnergyPerDay?: number
) {
  const isDailyRoutine = config && config.xanax === 3 && config.refill === 1;

  if (isDailyRoutine) {
    const activeBaseHappy = baseHappy ?? 4000;
    const peakHappy = jump.peakHappy;
    let statVal = currentStat;
    let currentHappy = peakHappy;
    
    const sleepHours = config.sleepHours || 0;
    const activeNaturalEnergyPerDay = naturalEnergyPerDay ?? 720;

    if (sleepHours > 0) {
      // 1. Energy accumulated during sleep (usually caps at maxEnergy, e.g. 150E)
      const sleepAccumulated = Math.floor(Math.min(maxEnergy, sleepHours * (activeNaturalEnergyPerDay / 24)) / 5) * 5;
      
      // 2. Remaining natural energy gained while awake (no sleep leakage)
      const awakeNatural = Math.floor(((24 - sleepHours) * (activeNaturalEnergyPerDay / 24)) / 5) * 5;

      // A. Wake-up Jump Train: (250E Xanax #1 + sleepAccumulated) trained at peak happy
      const resJump = calculateBatchTrain(statType, statVal, currentHappy, 250 + sleepAccumulated, gymDots, energyPerTrain, perkMultiplier);
      currentHappy = resJump.finalHappy;
      statVal = resJump.finalStat;

      // B. Refill Train: maxEnergy trained right after jump train at remaining happy
      const resRefill = calculateBatchTrain(statType, statVal, currentHappy, maxEnergy, gymDots, energyPerTrain, perkMultiplier);
      currentHappy = resRefill.finalHappy;
      statVal = resRefill.finalStat;

      // C. Other 2 Xanax: 2 * 250E = 500E trained at base happy
      const resXanaxOther = calculateBatchTrain(statType, statVal, activeBaseHappy, 500, gymDots, energyPerTrain, perkMultiplier);
      statVal = resXanaxOther.finalStat;

      // D. Other awake natural energy trained at base happy
      const resNaturalOther = calculateBatchTrain(statType, statVal, activeBaseHappy, awakeNatural, gymDots, energyPerTrain, perkMultiplier);
      statVal = resNaturalOther.finalStat;

      return {
        totalStatGained: statVal - currentStat,
        finalStat: statVal,
        finalHappy: resNaturalOther.finalHappy
      };
    } else {
      // If there is no sleep scheduled, don't compute sleep accumulation or leakage.
      // Train natural energy fully and train Xanax #1 normally.
      
      // A. Regular Xanax Train: 250E (Xanax #1) trained at peak happy
      const resJump = calculateBatchTrain(statType, statVal, currentHappy, 250, gymDots, energyPerTrain, perkMultiplier);
      currentHappy = resJump.finalHappy;
      statVal = resJump.finalStat;

      // B. Refill Train: maxEnergy trained right after jump train at remaining happy
      const resRefill = calculateBatchTrain(statType, statVal, currentHappy, maxEnergy, gymDots, energyPerTrain, perkMultiplier);
      currentHappy = resRefill.finalHappy;
      statVal = resRefill.finalStat;

      // C. Other 2 Xanax: 2 * 250E = 500E trained at base happy
      const resXanaxOther = calculateBatchTrain(statType, statVal, activeBaseHappy, 500, gymDots, energyPerTrain, perkMultiplier);
      statVal = resXanaxOther.finalStat;

      // D. All natural energy trained at base happy
      const resNaturalOther = calculateBatchTrain(statType, statVal, activeBaseHappy, activeNaturalEnergyPerDay, gymDots, energyPerTrain, perkMultiplier);
      statVal = resNaturalOther.finalStat;

      return {
        totalStatGained: statVal - currentStat,
        finalStat: statVal,
        finalHappy: resNaturalOther.finalHappy
      };
    }
  }

  let totalStatGained = 0;
  let currentHappy = jump.peakHappy;
  let statVal = currentStat;

  // 1. Train Stacked Energy
  if (jump.stackedEnergy > 0) {
    const res = calculateBatchTrain(statType, statVal, currentHappy, jump.stackedEnergy, gymDots, energyPerTrain, perkMultiplier);
    totalStatGained += res.totalStatGained;
    currentHappy = res.finalHappy;
    statVal = res.finalStat;
  }

  // 2. FHCs
  for (let i = 0; i < jump.fhcCount; i++) {
    // Each FHC increases happy by 500 in Torn before training
    currentHappy = Math.min(99999, currentHappy + 500);
    const res = calculateBatchTrain(statType, statVal, currentHappy, maxEnergy, gymDots, energyPerTrain, perkMultiplier);
    totalStatGained += res.totalStatGained;
    currentHappy = res.finalHappy;
    statVal = res.finalStat;
  }

  // 3. Refill
  if (jump.refillCount > 0) {
    const res = calculateBatchTrain(statType, statVal, currentHappy, maxEnergy, gymDots, energyPerTrain, perkMultiplier);
    totalStatGained += res.totalStatGained;
    currentHappy = res.finalHappy;
    statVal = res.finalStat;
  }

  return { totalStatGained, finalStat: statVal, finalHappy: currentHappy };
}

function formatMins(mins: number) {
  if (mins === 0) return '0h';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h}h${m > 0 ? ` ${m}m` : ''}`;
}
