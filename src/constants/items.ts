/**
 * Torn City Item Constants
 * 
 * All cooldowns are in MINUTES.
 * All energy values are base values.
 */

export const TORN_RULES = {
  ENERGY_PER_HIT: 25,
  BASE_ENERGY_DONATOR: 150,
  BASE_ENERGY_NORMAL: 100,
  BOOSTER_MAX_MINUTES: 1440, // 24h
  REGEN_INTERVAL_DONATOR: 10, // 10 mins for 5e
  REGEN_INTERVAL_NORMAL: 15,  // 15 mins for 5e
  REGEN_AMOUNT: 5,

  // Cooldown prediction thresholds (seconds)
  // When CD is ABOVE these values, prediction is reliable.
  // When CD drops BELOW, online members need re-polling.
  MEDICAL_CD_THRESHOLD: 21600,  // 6 hours
  BOOSTER_CD_THRESHOLD: 86400,  // 24 hours
};

export type CooldownType = 'drug' | 'booster' | 'medical';

export interface ItemDefinition {
  id: string;
  name: string;
  type: CooldownType;
  // 'full_refill' means 100 or 150 depending on donator status
  energy: number | 'full_refill';
  cooldown: {
    base: number;        // For fixed items (e.g. FHC) or min for random items
    max?: number;        // For random items (e.g. Xanax)
  };
}

export const TORN_ITEMS: Record<string, ItemDefinition> = {
  // --- DRUGS ---
  XANAX: {
    id: 'xanax',
    name: 'Xanax',
    type: 'drug',
    energy: 250,
    cooldown: {
      base: 360, // 6 hours
      max: 480   // 8 hours
    }
  },

  // --- BOOSTERS ---
  FHC: {
    id: 'fhc',
    name: 'Feathery Hotel Coupon',
    type: 'booster',
    energy: 'full_refill', // Changed to dynamic
    cooldown: {
      base: 360 // Fixed 6 hours
    }
  },
  REFILL: {
    id: 'refill',
    name: 'Daily Energy Refill',
    type: 'special' as any,
    energy: 'full_refill',
    cooldown: { base: 0 } // No cooldown, but limited by 'refill_used' flag
  }
};

/**
 * Get effective energy based on user status.
 */
export const getItemEnergy = (item: ItemDefinition, maxEnergy?: number): number => {
  if (item.energy === 'full_refill') {
    return maxEnergy || TORN_RULES.BASE_ENERGY_NORMAL;
  }
  return item.energy;
};

/**
 * Helper to get the simulation cooldown.
 * For random items, we usually default to 'max' for a safe/conservative estimate.
 */
export const getEffectiveCooldown = (item: ItemDefinition, strategy: 'min' | 'max' | 'avg' = 'max'): number => {
  if (!item.cooldown.max) return item.cooldown.base;

  switch (strategy) {
    case 'min': return item.cooldown.base;
    case 'max': return item.cooldown.max;
    case 'avg': return (item.cooldown.base + item.cooldown.max) / 2;
  }
};
