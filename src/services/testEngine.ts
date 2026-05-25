import { calculateBatchTrain } from './gymEngine';

// Test case using typical stats
const result = calculateBatchTrain(
  'strength', // statType
  50000,      // initialStat
  45000,      // initialHappy (A Happy Jump scenario)
  570,        // totalEnergy
  7,          // gymDots (e.g. Apollo Gym Strength 7 dots... wait, Apollo is 6 dots? Let's use 6)
  10,         // energyPerTrain
  1.08        // perkMultiplier
);

console.log(`Total Gain: ${result.totalStatGained}`);
console.log(`Final Happy: ${result.finalHappy}`);
console.log(`Trains computed: ${result.trains.length}`);
console.log(`First Train Gain: ${result.trains[0].statGained}`);
console.log(`Last Train Gain: ${result.trains[result.trains.length - 1].statGained}`);
