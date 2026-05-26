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
  // We need to evaluate various permutations of items.
  // Permutation limits:
  // Xanax: 0..4
  // eDVD: 0..4 (Wait, 5 if we don't care about the 24h limit? No, 5 eDVDs is 30h without faction perks, but if they have perks, it's less. Let's just allow 0..5 eDVDs)
  // FHC: 0..4 (Since FHC is 6h booster cd)
  // Truffles, Tootsie, Lollipop (we'll simplify: just test 49 truffles, 96 lollipops, etc.)
  // Ecstasy: 0..1
  // Refill: 0..1
  
  const presets: JumpConfig['items'][] = [
    // Zero cost baseline
    { xanax: 0, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 0, refill: 0 },
    
    // Normal 1 Xanax
    { xanax: 1, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 0, refill: 0 },
    
    // 99k eDVD Jump (4 Xanax + 5 eDVD + Ecstasy + Refill)
    { xanax: 4, edvd: 5, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 1, refill: 1 },
    { xanax: 4, edvd: 4, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 1, refill: 1 },
    
    // Choco Jump (4 Xanax + 49 Truffles + Ecstasy + Refill)
    { xanax: 4, edvd: 0, truffles: 49, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 1, refill: 1 },
    { xanax: 4, edvd: 0, truffles: 48, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 1, refill: 1 },
    
    // Lollipop Jump (4 Xanax + 96 Lollipops + Ecstasy + Refill)
    { xanax: 4, edvd: 0, truffles: 0, tootsie: 0, lollipop: 96, fhc: 0, ecstasy: 1, refill: 1 },
    
    // Full FHC Jump (4 Xanax + 4 FHC + Ecstasy + Refill) -> FHC replaces eDVDs for Booster CD
    { xanax: 4, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, fhc: 4, ecstasy: 1, refill: 1 },
    { xanax: 4, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, fhc: 5, ecstasy: 1, refill: 1 },

    // Drug-Free E-DVD Jump (No Xanax, No Ecstasy, 4 eDVDs + Refill)
    { xanax: 0, edvd: 4, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 0, refill: 1 },
    { xanax: 0, edvd: 5, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 0, refill: 1 },

    // Drug-Free Choco Jump
    { xanax: 0, edvd: 0, truffles: 49, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 0, refill: 1 },
    
    // Drug-Free FHC Jump
    { xanax: 0, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, fhc: 4, ecstasy: 0, refill: 1 },

    // Fast-train jumps (Time efficiency)
    { xanax: 4, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 0, refill: 1 },
    { xanax: 1, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, fhc: 0, ecstasy: 0, refill: 1 }
  ];

  const results = presets.map(config => {
    // 1. Calculate jump totals
    const jump = calculateJump({
      baseEnergy: params.baseEnergy,
      baseHappy: params.baseHappy,
      maxEnergy: params.maxEnergy,
      items: config
    });

    // 2. Calculate stat gain sequentially (Stacked -> FHC -> Refill)
    const trainResult = calculateJumpStatGain(
      jump,
      params.maxEnergy,
      params.statType,
      params.currentStat,
      params.gymDots,
      params.energyPerTrain,
      params.perkMultiplier
    );

    // 3. Calculate Cost
    const totalCost = 
      (config.xanax * ITEM_PRICES.XANAX) +
      (config.edvd * ITEM_PRICES.EDVD) +
      (config.truffles * ITEM_PRICES.TRUFFLES) +
      (config.tootsie * ITEM_PRICES.TOOTSIE) +
      (config.lollipop * ITEM_PRICES.LOLLIPOP) +
      (config.fhc * ITEM_PRICES.FHC) +
      (config.ecstasy * ITEM_PRICES.ECSTASY) +
      (config.refill * ITEM_PRICES.POINT * 25);

    // 4. Calculate Time
    const totalTimeMins = jump.prepTimeMins + jump.totalDrugCdMins + jump.totalBoosterCdMins;
    
    // 5. Calculate 24h Yield
    const isStackedJump = config.xanax > 1; // Stacking Xanax > 1 wastes natural energy
    const hasRefill = config.refill > 0;
    const { gain24h, cost24h } = calculate24hYield(
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

    return {
      config,
      statGain: trainResult.totalStatGained,
      cost: totalCost,
      timeMins: totalTimeMins,
      gain24h,
      cost24h,
      isValid: jump.totalBoosterCdMins <= 1440
    };
  });

  // Filter out invalid jumps (booster CD > 24h) unless the user has faction perks that make 5 eDVDs < 24h.
  // Actually, calculateJump currently just sums the base cooldowns. If they exceed 1440, it's flagged as isBoosterCdExceeded.
  // Wait, in calculateJump we just sum base cooldowns. Faction perks aren't passed into JumpBuilder.
  // So a 5 eDVD jump (1800m base) will ALWAYS be invalid here.
  // To allow it, we should just let them all through and let the user decide, OR filter by 1440.
  // For safety, let's keep all valid combinations (some might exceed base 1440 but users do it anyway with perks).
  // But let's severely penalize time efficiency if it exceeds 1440.
  
  const candidates = results.filter(r => r.cost > 0); // Ignore zero-cost

  // 1. Max Stat Gain
  const maxStat = [...candidates].sort((a, b) => b.statGain - a.statGain)[0];
  
  // 2. Most Economical (Stat per $)
  const economical = [...candidates].sort((a, b) => (b.statGain / b.cost) - (a.statGain / a.cost))[0];

  // 3. Max Stat Gain (Daily)
  const maxDaily = [...candidates].sort((a, b) => b.gain24h - a.gain24h)[0];

  // 4. Best Drug-Free (No Xanax, No Ecstasy)
  const drugFreeCandidates = candidates.filter(r => r.config.xanax === 0 && r.config.ecstasy === 0);
  const drugFree = drugFreeCandidates.sort((a, b) => b.statGain - a.statGain)[0];

  const presetsList: OptimalPreset[] = [];

  if (maxStat) presetsList.push({
    id: 'max_stat',
    label: `Max Stat Gain (+${Math.round(maxStat.statGain).toLocaleString()} stat)`,
    config: maxStat.config,
    statGain: maxStat.statGain,
    cost: maxStat.cost,
    timeMins: maxStat.timeMins,
    gain24h: maxStat.gain24h,
    cost24h: maxStat.cost24h
  });

  if (maxDaily && maxDaily !== maxStat) presetsList.push({
    id: 'max_daily',
    label: `Max Stat Gain (Daily) (+${Math.round(maxDaily.gain24h).toLocaleString()} stat / day)`,
    config: maxDaily.config,
    statGain: maxDaily.statGain,
    cost: maxDaily.cost,
    timeMins: maxDaily.timeMins,
    gain24h: maxDaily.gain24h,
    cost24h: maxDaily.cost24h
  });

  if (economical && economical !== maxStat && economical !== maxDaily) presetsList.push({
    id: 'economical',
    label: `Most Economical (+${Math.round(economical.statGain).toLocaleString()} stat / $${(economical.cost/1000000).toFixed(1)}m)`,
    config: economical.config,
    statGain: economical.statGain,
    cost: economical.cost,
    timeMins: economical.timeMins,
    gain24h: economical.gain24h,
    cost24h: economical.cost24h
  });

  if (drugFree) presetsList.push({
    id: 'drug_free',
    label: `Drug-Free Jump (+${Math.round(drugFree.statGain).toLocaleString()} stat)`,
    config: drugFree.config,
    statGain: drugFree.statGain,
    cost: drugFree.cost,
    timeMins: drugFree.timeMins,
    gain24h: drugFree.gain24h,
    cost24h: drugFree.cost24h
  });

  return presetsList;
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
  perkMultiplier: number
) {
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
