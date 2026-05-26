import { TORN_RULES, TORN_ITEMS, getEffectiveCooldown, getItemEnergy } from '../constants/items';

export interface JumpConfig {
  baseEnergy: number;
  baseHappy: number;
  maxEnergy: number;
  items: {
    xanax: number;
    refill: number; // 0 or 1 usually
    fhc: number;
    edvd: number;
    truffles: number;
    tootsie: number;
    lollipop: number;
    ecstasy: number; // 0 or 1
  };
}

export interface TimelineEvent {
  timeOffsetMins: number;
  action: string;
  drugCdAccumulated: number;
  boosterCdAccumulated: number;
  energyChange: number;
  happyChange: number;
}

export interface JumpCalculationResult {
  totalEnergy: number; // For UI display of total energy spent
  stackedEnergy: number; // The energy available at the moment of peak happy
  fhcCount: number;
  refillCount: number;
  peakHappy: number;
  totalDrugCdMins: number;
  totalBoosterCdMins: number;
  isBoosterCdExceeded: boolean;
  timeline: TimelineEvent[];
  prepTimeMins: number;
}

/**
 * Calculates the exact energy, happy, cooldowns, and timeline for a given jump config.
 */
export function calculateJump(config: JumpConfig): JumpCalculationResult {
  let currentEnergy = config.baseEnergy;
  let currentHappy = config.baseHappy;
  
  let totalDrugCd = 0;
  let totalBoosterCd = 0;
  let prepTimeMins = 0;
  
  const timeline: TimelineEvent[] = [];
  
  // Median CDs
  const avgXanaxCd = getEffectiveCooldown(TORN_ITEMS.XANAX, 'avg'); // ~420 mins (7 hours)
  const avgEcstasyCd = getEffectiveCooldown(TORN_ITEMS.ECSTASY, 'avg'); // ~215 mins

  // --- STAGE 1: Stacking Energy ---
  // Taking Xanax
  if (config.items.xanax > 0) {
    let totalEGain = 0;
    let totalHLoss = 0;
    const startPrepTime = prepTimeMins;
    
    for (let i = 0; i < config.items.xanax; i++) {
      let eGain = getItemEnergy(TORN_ITEMS.XANAX, config.maxEnergy);
      const hLoss = (TORN_ITEMS.XANAX.happy as number) || -75;
      
      currentEnergy += eGain;
      // The user explicitly requested that Base Energy + Xanax cannot exceed 1000e.
      // E.g., 150 base + 4 xanax (1000) = 1000e, not 1150e.
      const excessEnergy = currentEnergy > 1000 ? currentEnergy - 1000 : 0;
      if (excessEnergy > 0) {
        currentEnergy = 1000;
        eGain -= excessEnergy; // Adjust the gain so the timeline reflects the clamped value
      }
      
      const prevHappy = currentHappy;
      currentHappy = Math.max(0, currentHappy + hLoss);
      
      totalEGain += eGain;
      totalHLoss += (currentHappy - prevHappy);
      totalDrugCd += avgXanaxCd;
      prepTimeMins += avgXanaxCd;
    }
    
    timeline.push({
      timeOffsetMins: startPrepTime,
      action: `Take ${config.items.xanax}x Xanax`,
      drugCdAccumulated: totalDrugCd,
      boosterCdAccumulated: totalBoosterCd,
      energyChange: totalEGain,
      happyChange: totalHLoss
    });
  }
  
  // --- STAGE 2: Happy Boosters ---
  // You can take boosters simultaneously as they just stack Booster CD
  
  const processBooster = (itemId: string, count: number) => {
    const item = TORN_ITEMS[itemId];
    if (!item || count <= 0) return;
    
    const hGain = (item.happy as number) || 0;
    const eGain = getItemEnergy(item, config.maxEnergy);
    const cd = item.cooldown.base;
    
    currentEnergy += eGain * count;
    const prevHappy = currentHappy;
    currentHappy = Math.min(99999, currentHappy + hGain * count);
    const actualHappyGain = currentHappy - prevHappy;
    totalBoosterCd += cd * count;
    
    timeline.push({
      timeOffsetMins: prepTimeMins,
      action: `Use ${count}x ${item.name}`,
      drugCdAccumulated: totalDrugCd,
      boosterCdAccumulated: totalBoosterCd,
      energyChange: eGain * count,
      happyChange: actualHappyGain
    });
  };

  processBooster('EDVD', config.items.edvd);
  processBooster('TRUFFLES', config.items.truffles);
  processBooster('TOOTSIE_ROLLS', config.items.tootsie);
  processBooster('LOLLIPOP', config.items.lollipop);

  // --- STAGE 3: Final Multipliers (Ecstasy) ---
  
  if (config.items.ecstasy > 0) {
    // Ecstasy doubles your current happy up to 99999.
    const prevHappy = currentHappy;
    currentHappy = Math.min(99999, currentHappy * 2);
    const actualHappyGain = currentHappy - prevHappy;
    
    totalDrugCd += avgEcstasyCd;
    
    timeline.push({
      timeOffsetMins: prepTimeMins,
      action: 'Take Ecstasy',
      drugCdAccumulated: totalDrugCd,
      boosterCdAccumulated: totalBoosterCd,
      energyChange: 0,
      happyChange: actualHappyGain
    });
  }

  const stackedEnergy = currentEnergy;
  const peakHappy = currentHappy;

  // --- STAGE 4: Training Stacked Energy ---
  if (stackedEnergy > 0) {
    timeline.push({
      timeOffsetMins: prepTimeMins,
      action: `Train ${stackedEnergy} Energy`,
      drugCdAccumulated: totalDrugCd,
      boosterCdAccumulated: totalBoosterCd,
      energyChange: -stackedEnergy,
      happyChange: 0 // Will decrease, but we don't track dynamic happy drop here
    });
  }

  // --- STAGE 5: FHCs and Refills (Replenish and Train) ---
  const fhcCd = TORN_ITEMS.FHC.cooldown.base;
  
  for (let i = 0; i < config.items.fhc; i++) {
    totalBoosterCd += fhcCd;
    currentEnergy += config.maxEnergy; // FHC refills to max
    
    timeline.push({
      timeOffsetMins: prepTimeMins,
      action: 'Use 1x Feathery Hotel Coupon',
      drugCdAccumulated: totalDrugCd,
      boosterCdAccumulated: totalBoosterCd,
      energyChange: config.maxEnergy,
      happyChange: 0
    });

    timeline.push({
      timeOffsetMins: prepTimeMins,
      action: `Train ${config.maxEnergy} Energy`,
      drugCdAccumulated: totalDrugCd,
      boosterCdAccumulated: totalBoosterCd,
      energyChange: -config.maxEnergy,
      happyChange: 0
    });
  }

  if (config.items.refill > 0) {
    currentEnergy += config.maxEnergy;
    
    timeline.push({
      timeOffsetMins: prepTimeMins,
      action: 'Use Point Refill',
      drugCdAccumulated: totalDrugCd,
      boosterCdAccumulated: totalBoosterCd,
      energyChange: config.maxEnergy,
      happyChange: 0
    });

    timeline.push({
      timeOffsetMins: prepTimeMins,
      action: `Train ${config.maxEnergy} Energy`,
      drugCdAccumulated: totalDrugCd,
      boosterCdAccumulated: totalBoosterCd,
      energyChange: -config.maxEnergy,
      happyChange: 0
    });
  }

  // Assuming player trains immediately after Ecstasy/Refill.
  // The total time spent preparing the jump is primarily waiting for Xanax cooldowns.
  // We subtract the last Xanax cooldown from the prep time because you take Ecstasy immediately after the last Xanax CD clears.
  // Actually, the prepTimeMins already accumulated the last Xanax CD. That is the correct total elapsed time from the VERY FIRST Xanax.
  
  // Is Booster CD exceeded? 24 hours = 1440 mins
  const isBoosterCdExceeded = totalBoosterCd > 1440;

  return {
    totalEnergy: currentEnergy,
    stackedEnergy,
    fhcCount: config.items.fhc,
    refillCount: config.items.refill,
    peakHappy,
    totalDrugCdMins: totalDrugCd,
    totalBoosterCdMins: totalBoosterCd,
    isBoosterCdExceeded,
    timeline,
    prepTimeMins
  };
}
