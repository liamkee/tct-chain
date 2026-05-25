export interface ApiMerits {
  Brawn?: number;
  Protection?: number;
  Sharpness?: number;
  Evasion?: number;
  // 其他與 Gym 無關的 merits 可以忽略
  [key: string]: number | undefined;
}

export interface BaseStatMultipliers {
  strength: number;
  defense: number;
  speed: number;
  dexterity: number;
}

/**
 * 處理 API 傳回的 merits 資料，計算四維基礎屬性的被動乘數 (Passive Bonus)
 *
 * 每個屬性專屬 Merit (最高 10 點) 每一點提供 +3% 基礎數值。
 * 例如：Brawn 10 點 -> 力量乘數 1.30
 * 
 * @param merits API 回傳的 merits JSON 物件
 * @returns 四維屬性的基礎乘數
 */
export function calculateBaseStatMultipliers(merits: ApiMerits): BaseStatMultipliers {
  // 每一點增加 3% (0.03)，最高 10 點
  const getMultiplier = (points: number | undefined) => {
    // 確保點數落在 0~10 之間 (防呆機制)
    const validPoints = Math.min(Math.max(0, points || 0), 10);
    return 1 + (validPoints * 0.03);
  };

  return {
    strength: getMultiplier(merits.Brawn),
    defense: getMultiplier(merits.Protection),
    speed: getMultiplier(merits.Sharpness),
    dexterity: getMultiplier(merits.Evasion)
  };
}

/**
 * 根據真實的面板屬性與 Merit 點數，還原/推算基礎屬性 (Base Stat)。
 * 
 * 備註：Vladar Gym 公式中使用的 "S" (Stat) 是包含 Merit 加成後的數值，
 * 還是加成前的數值？
 * 實際上 Torn 遊戲中的面板戰鬥屬性 (Viewable Stats) 是**已經包含** Merit 的。
 * 因此在帶入 Gym 公式前，通常直接帶入面板屬性即可，不需重複乘 Merit。
 * 但這個函式保留給未來需要從 Base 推算 Effective，或反推的場景。
 */
export function applyMeritMultipliers(
  baseStats: { strength: number; defense: number; speed: number; dexterity: number },
  merits: ApiMerits
): { strength: number; defense: number; speed: number; dexterity: number } {
  const multipliers = calculateBaseStatMultipliers(merits);

  return {
    strength: baseStats.strength * multipliers.strength,
    defense: baseStats.defense * multipliers.defense,
    speed: baseStats.speed * multipliers.speed,
    dexterity: baseStats.dexterity * multipliers.dexterity
  };
}
