export const STAT_CONSTANTS = {
  strength: { A: 1600, B: 1700, C: 700 },
  speed: { A: 1600, B: 2000, C: 1350 },
  defense: { A: 2100, B: -600, C: 1500 },
  dexterity: { A: 1800, B: 1500, C: 1000 }
};

export interface TrainResult {
  statGained: number;
  happyLost: number;
  energySpent: number;
  newStat: number;
  newHappy: number;
}

export interface BatchTrainResult {
  totalStatGained: number;
  totalHappyLost: number;
  totalEnergySpent: number;
  finalStat: number;
  finalHappy: number;
  trains: TrainResult[];
}

/**
 * 基於 Modern Vladar Formula 模擬【單次】 Gym 訓練
 */
export function calculateSingleTrain(
  statType: 'strength' | 'speed' | 'defense' | 'dexterity',
  currentStat: number,
  currentHappy: number,
  gymDots: number,
  energyPerTrain: number,
  perkMultiplier: number
): TrainResult {
  const { A, B, C } = STAT_CONSTANTS[statType];
  
  // 1. 處理 50M 屬性以上的對數衰減 (Stat Cap Log-decay)
  let sEffective = currentStat;
  if (currentStat > 50_000_000) {
    sEffective = 50_000_000 + (currentStat - 50_000_000) / (8.77635 * Math.log(currentStat));
  }

  // 2. 幸福度對數乘數 f(H)
  const f_H = 1 + 0.07 * Math.log(1 + currentHappy / 250);

  // 3. 幸福度非線性效應
  const nonLinearHappy = 8 * Math.pow(currentHappy, 1.05);

  // 4. Flat offset term: (1 - (H / 99999)^2) * A + B
  // Note: C is for RANDBETWEEN(-C, C) which averages to 0, so we omit it for expected value.
  const flatTerm = (1 - Math.pow(currentHappy / 99999, 2)) * A + B;

  // 5. 核心括號加總
  const bracket = (sEffective * f_H) + nonLinearHappy + flatTerm;

  // 6. 計算最終收益
  const gain = bracket * (1 / 200000) * gymDots * energyPerTrain * perkMultiplier;

  // 7. 計算 Happy 消耗 (期望值算法)
  // 使用精確的浮點數來計算期望值，避免 Math.round 導致批量計算時 Happy 下降過快
  const happyLoss = energyPerTrain / 2;
  const newHappy = Math.max(0, currentHappy - happyLoss);

  return {
    statGained: gain,
    happyLost: happyLoss,
    energySpent: energyPerTrain,
    newStat: currentStat + gain,
    newHappy: newHappy
  };
}

/**
 * 批量訓練迭代器 (Batch Training Iterator)
 * 模擬連續點擊多次訓練，精準還原因為 Happy 遞減與 Stat 遞增造成的非線性總收益
 */
export function calculateBatchTrain(
  statType: 'strength' | 'speed' | 'defense' | 'dexterity',
  initialStat: number,
  initialHappy: number,
  totalEnergy: number,
  gymDots: number,
  energyPerTrain: number, // 5, 10, 或 25
  perkMultiplier: number
): BatchTrainResult {
  
  let currentStat = initialStat;
  let currentHappy = initialHappy;
  let totalStatGained = 0;
  let totalHappyLost = 0;
  let totalEnergySpent = 0;
  
  const trains: TrainResult[] = [];
  const numberOfTrains = Math.floor(totalEnergy / energyPerTrain);

  for (let i = 0; i < numberOfTrains; i++) {
    const result = calculateSingleTrain(
      statType, 
      currentStat, 
      currentHappy, 
      gymDots, 
      energyPerTrain, 
      perkMultiplier
    );
    
    trains.push(result);
    currentStat = result.newStat;
    currentHappy = result.newHappy;
    totalStatGained += result.statGained;
    totalHappyLost += result.happyLost;
    totalEnergySpent += energyPerTrain;
  }

  return {
    totalStatGained,
    totalHappyLost,
    totalEnergySpent,
    finalStat: currentStat,
    finalHappy: currentHappy,
    trains
  };
}
