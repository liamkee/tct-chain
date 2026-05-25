export interface GymPerkModifiers {
  strength: number;
  speed: number;
  defense: number;
  dexterity: number;
}

export interface ApiPerks {
  property_perks?: string[];
  education_perks?: string[];
  company_perks?: string[];
  book_perks?: string[];
  faction_perks?: string[];
}

/**
 * 解析單一個加成字串，提取屬性目標與加成比例
 * 例如: "10% dexterity gym gains" -> { target: 'dexterity', multiplier: 1.10 }
 */
export function parseSingleGymPerk(perkStr: string): { target: 'strength'|'speed'|'defense'|'dexterity'|'all', percent: number } | null {
  const lower = perkStr.toLowerCase();
  
  // 必須包含 gym gains 關鍵字
  if (!lower.includes('gym gains')) {
    return null;
  }

  let percent = 0;
  // 匹配數字 (例如 10%, 2.5%, 3%)
  const match = lower.match(/(\d+(?:\.\d+)?)%/);
  
  if (match) {
    percent = parseFloat(match[1]);
  } else {
    // 特殊例外處理 (假設某些 API 字串沒有帶 %, 像是書籍加成)
    if (lower.includes('all gym gains')) {
      percent = 20; // Ignorance Is Bliss book
    } else if (lower.includes('strength gym gains') || lower.includes('speed gym gains') || 
               lower.includes('defense gym gains') || lower.includes('dexterity gym gains')) {
      percent = 30; // Stat specific books
    } else {
      percent = 1; // 預設 1%
    }
  }

  // 判斷加成目標屬性
  let target: 'strength'|'speed'|'defense'|'dexterity'|'all' = 'all';
  if (lower.includes('strength')) target = 'strength';
  else if (lower.includes('speed')) target = 'speed';
  else if (lower.includes('defense')) target = 'defense';
  else if (lower.includes('dexterity')) target = 'dexterity';

  return { target, percent };
}

/**
 * 傳入完整的 API Perks 物件，回傳對應四個屬性的最終加成乘數
 */
export function calculateGymModifiersFromPerks(perks: ApiPerks | undefined | null): GymPerkModifiers {
  let percentAll = 0;
  const percents = {
    strength: 0,
    speed: 0,
    defense: 0,
    dexterity: 0
  };

  if (!perks) {
    return { strength: 1, speed: 1, defense: 1, dexterity: 1 };
  }

  // 將所有 perks 來源合併
  const allPerkStrings = [
    ...(perks.property_perks || []),
    ...(perks.education_perks || []),
    ...(perks.company_perks || []),
    ...(perks.book_perks || []),
    ...(perks.faction_perks || [])
  ];

  for (const perkStr of allPerkStrings) {
    const parsed = parseSingleGymPerk(perkStr);
    if (parsed) {
      if (parsed.target === 'all') {
        percentAll += parsed.percent;
      } else {
        percents[parsed.target] += parsed.percent;
      }
    }
  }

  // 結算：單項屬性乘數 = 1 + (各項加成百分比總和 / 100)
  // 根據 Torn Wiki，所有 Gym Perks 加成都是加法疊加 (Additive)
  return {
    strength: 1 + (percents.strength + percentAll) / 100,
    speed: 1 + (percents.speed + percentAll) / 100,
    defense: 1 + (percents.defense + percentAll) / 100,
    dexterity: 1 + (percents.dexterity + percentAll) / 100
  };
}
