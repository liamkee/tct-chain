import { TacticalCalculator } from '../src/services/calculator';

const mockMember = {
  energy: { current: 10, max: 150 },
  cooldowns: { drug: 360, booster: 0, medical: 0 },
  last_action: { status: 'Online', relative: '1m ago' },
  is_donator: true,
  refill_used: false
};

console.log('--- Tactical Prediction Test ---');

// 1. 测试即时战力 (Immediate Burst)
const current = TacticalCalculator.calculatePotential(mockMember as any);
console.log('Immediate Available Hits:', current.availableHits); 
// 预期：(10 + 150) / 25 = 6.4 -> 6 hits

// 2. 测试 2 小时推演 (Time-Aware Projection)
const projected2h = TacticalCalculator.predictPotentialOverTime(mockMember as any, 120);
console.log('Projected Hits in 2 hours:', projected2h.potentialHits);
// 预期逻辑：
// - Base: 10e + Refill: 150e = 160e
// - Regen (2h/120min): Donator 每 10m 回 5e -> 12 * 5 = 60e
// - Booster (2h后 CD 0->0): 还是可以吃 5 张 FHC? 
//   - 不，Booster CD 是 0，吃 4 张 -> 24h。过了 2h 还是只能吃那么多（因为还在 24h 限制内）。
// - Drug (Drug CD 360): 2 小时内 CD 没法归 0，吃不了 Xanax。
// 总能量: 160 + 60 + (4 * 150) = 820e -> 32 hits

// 3. 测试 7 小时推演 (Drug CD 归零)
const projected7h = TacticalCalculator.predictPotentialOverTime(mockMember as any, 420);
console.log('Projected Hits in 7 hours:', projected7h.potentialHits);
// 预期逻辑：Xanax 应该被计入。
