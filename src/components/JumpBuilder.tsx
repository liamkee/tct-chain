import { useState, useEffect, useMemo } from 'react';
import { calculateJump, type JumpConfig, type JumpCalculationResult } from '../services/jumpCalculator';
import { generateOptimalPresets } from '../services/jumpOptimizer';
import { ITEM_PRICES } from '../constants/items';

import { CustomSelect } from './CustomSelect';

interface JumpBuilderProps {
  baseEnergy: number;
  baseHappy: number;
  maxEnergy: number;
  currentStat: number;
  gymMultiplier: number;
  gymDots: number;
  energyPerTrain: number;
  statType: 'strength' | 'speed' | 'defense' | 'dexterity';
  naturalEnergyPerDay: number;
  onChange: (jump: JumpCalculationResult, cost: number, isStackedJump: boolean, hasRefill: boolean) => void;
}

export function JumpBuilder({ baseEnergy, baseHappy, maxEnergy, currentStat, gymMultiplier, gymDots, energyPerTrain, statType, naturalEnergyPerDay, onChange }: JumpBuilderProps) {
  const [presetMode, setPresetMode] = useState<string>('normal');
  const [config, setConfig] = useState<JumpConfig['items']>({
    xanax: 0,
    refill: 0,
    fhc: 0,
    edvd: 0,
    truffles: 0,
    tootsie: 0,
    lollipop: 0,
    ecstasy: 0
  });

  const result = useMemo(() => {
    return calculateJump({
      baseEnergy,
      baseHappy,
      maxEnergy,
      items: config
    });
  }, [baseEnergy, baseHappy, maxEnergy, config]);

  const totalCost = 
    (config.xanax * ITEM_PRICES.XANAX) +
    (config.edvd * ITEM_PRICES.EDVD) +
    (config.truffles * ITEM_PRICES.TRUFFLES) +
    (config.tootsie * ITEM_PRICES.TOOTSIE) +
    (config.lollipop * ITEM_PRICES.LOLLIPOP) +
    (config.fhc * ITEM_PRICES.FHC) +
    (config.ecstasy * ITEM_PRICES.ECSTASY) +
    (config.refill * ITEM_PRICES.POINT * 25); // Refill = 25 points

  // Sync to parent
  useEffect(() => {
    const isStackedJump = config.xanax > 1;
    const hasRefill = config.refill > 0;

    onChange(result, totalCost, isStackedJump, hasRefill);
  }, [result, config, onChange]);

  const updateItem = (key: keyof JumpConfig['items'], delta: number) => {
    setConfig(prev => ({
      ...prev,
      [key]: Math.max(0, prev[key] + delta)
    }));
    setPresetMode('custom');
  };

  const optimalPresets = useMemo(() => {
    return generateOptimalPresets({
      baseEnergy,
      baseHappy,
      maxEnergy,
      currentStat,
      gymDots,
      energyPerTrain,
      perkMultiplier: gymMultiplier,
      statType,
      naturalEnergyPerDay
    });
  }, [baseEnergy, baseHappy, maxEnergy, currentStat, gymDots, energyPerTrain, gymMultiplier, statType, naturalEnergyPerDay]);

  const setPreset = (type: string) => {
    if (type === 'normal') {
      setConfig({ xanax: 0, refill: 0, fhc: 0, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, ecstasy: 0 });
    } else if (type === 'daily') {
      setConfig({ xanax: 1, refill: 0, fhc: 0, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, ecstasy: 0 });
    } else {
      const p = optimalPresets.find(o => o.id === type);
      if (p) setConfig(p.config);
    }
  };

  const formatMins = (mins: number) => {
    if (mins === 0) return '0h';
    const h = Math.floor(mins / 60);
    const m = mins % 60;
    return `${h}h ${m}m`;
  };

  const isBoosterItem = (key: keyof JumpConfig['items']) => {
    return ['fhc', 'edvd', 'truffles', 'tootsie', 'lollipop'].includes(key);
  };

  const formatPrice = (price: number) => {
    if (price >= 1000000) {
      return `$${(price / 1000000).toFixed(1).replace(/\.0$/, '')}m`;
    }
    return `$${(price / 1000).toFixed(0)}k`;
  };

  const renderCounter = (label: string, price: number, key: keyof JumpConfig['items'], max?: number) => {
    const isAtBoosterLimit = isBoosterItem(key) && result.totalBoosterCdMins > 1440;
    const isXanaxLimitReached = key === 'xanax' && (baseEnergy + (config.xanax * 250) >= 1000);
    const isDisabled = (max !== undefined && config[key] >= max) || isAtBoosterLimit || isXanaxLimitReached;

    return (
      <div className="flex justify-between items-center bg-zinc-950 p-2 rounded-xl border border-white/5">
        <div className="flex flex-col pl-2">
          <span className="text-[10px] font-bold uppercase text-zinc-400">{label}</span>
          <span className="text-[9px] font-mono text-zinc-600">{formatPrice(price)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button 
            onClick={() => updateItem(key, -1)}
            className="w-6 h-6 flex justify-center items-center rounded-md bg-white/5 hover:bg-white/10 text-white transition-colors"
          >-</button>
          <span className="font-mono text-sm w-4 text-center">{config[key]}</span>
          <button 
            onClick={() => updateItem(key, 1)}
            disabled={isDisabled}
            className={`w-6 h-6 flex justify-center items-center rounded-md transition-colors ${
              isDisabled 
                ? 'bg-red-500/10 text-red-500/50 cursor-not-allowed' 
                : 'bg-white/5 hover:bg-white/10 text-white'
            }`}
          >+</button>
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Presets */}
      <div className="flex flex-col gap-2">
        <label className="text-[10px] text-zinc-400 font-bold uppercase">Load Preset Configuration</label>
        <CustomSelect
          value={presetMode}
          onChange={(val) => {
            setPresetMode(val);
            setPreset(val);
          }}
          options={[
            { value: 'normal', label: 'Normal Train (0 Items)' },
            { value: 'daily', label: 'Daily Routine (1x Xanax)' },
            ...optimalPresets.map(p => ({ value: p.id, label: p.label })),
            { value: 'custom', label: 'Custom Configuration' }
          ]}
        />
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Item Selectors */}
        <div className="flex flex-col gap-2">
          <h3 className="text-[9px] text-indigo-500 font-bold uppercase tracking-widest mb-1">Energy & Multipliers</h3>
          {renderCounter('Xanax (+250 Energy)', ITEM_PRICES.XANAX, 'xanax')}
          {renderCounter('Ecstasy (x2 Happy)', ITEM_PRICES.ECSTASY, 'ecstasy', 1)}
          {renderCounter('Point Refill', ITEM_PRICES.POINT * 25, 'refill', 1)}
          {renderCounter('FHC (Refill +500 Happy)', ITEM_PRICES.FHC, 'fhc')}
          
          <h3 className="text-[9px] text-indigo-500 font-bold uppercase tracking-widest mb-1 mt-2">Happy Boosters</h3>
          {renderCounter('eDVD (+2500 Happy)', ITEM_PRICES.EDVD, 'edvd')}
          {renderCounter('Truffles (+100 Happy)', ITEM_PRICES.TRUFFLES, 'truffles')}
          {renderCounter('Tootsie (+75 Happy)', ITEM_PRICES.TOOTSIE, 'tootsie')}
          {renderCounter('Lollipop (+25 Happy)', ITEM_PRICES.LOLLIPOP, 'lollipop')}
        </div>

        {/* Results Panel */}
        <div className="bg-zinc-950 rounded-2xl border border-white/5 p-4 flex flex-col gap-4">
          <div className="flex justify-between items-center pb-3 border-b border-white/5">
            <span className="text-[10px] font-bold uppercase text-zinc-500">Total Cost</span>
            <span className="font-mono text-sm text-yellow-500">${(totalCost / 1000000).toFixed(2)}M</span>
          </div>
          
          <div className="grid grid-cols-2 gap-4">
            <div className="flex flex-col">
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Final Energy</span>
              <span className="font-mono text-lg text-emerald-400">{result.totalEnergy}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Peak Happy</span>
              <span className="font-mono text-lg text-yellow-400">{result.peakHappy.toLocaleString()}</span>
            </div>
            
            <div className="flex flex-col">
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Drug CD Incurred</span>
              <span className="font-mono text-sm text-rose-400">{formatMins(result.totalDrugCdMins)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-[9px] text-zinc-500 font-bold uppercase">Booster CD Incurred</span>
              <span className="font-mono text-sm text-rose-400">
                {formatMins(result.totalBoosterCdMins)}
              </span>
            </div>
          </div>

          <div className="mt-2 pt-3 border-t border-white/5 flex flex-col gap-2">
            <div className="flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase text-indigo-400">Est. Prep Time</span>
              <span className="font-mono text-sm text-indigo-300">≈ {formatMins(result.prepTimeMins)}</span>
            </div>
            <div className="text-[9px] text-zinc-500 leading-relaxed">
              Based on median drug cooldowns. Time spent waiting for drug cooldowns to clear before the jump can be executed.
            </div>
          </div>
        </div>
      </div>
      
      {/* Timeline */}
      {result.timeline.length > 0 && (
        <div className="bg-zinc-950 p-4 rounded-xl border border-white/5 mt-2">
          <h3 className="text-[10px] text-zinc-400 font-bold uppercase mb-3">Jump Execution Timeline</h3>
          <div className="flex flex-col gap-2 max-h-40 overflow-y-auto custom-scrollbar pr-2">
            {result.timeline.map((evt, idx) => (
              <div key={idx} className="flex items-center gap-3 text-[10px] font-mono border-l-2 border-indigo-500/30 pl-3 py-1 relative">
                <div className="absolute w-2 h-2 rounded-full bg-indigo-500/50 -left-[5px]"></div>
                <span className="text-zinc-500 w-12 shrink-0">T+{formatMins(evt.timeOffsetMins)}</span>
                <span className="text-white flex-1">{evt.action}</span>
                {evt.energyChange > 0 && <span className="text-emerald-400 shrink-0">+{evt.energyChange}E</span>}
                {evt.happyChange > 0 && <span className="text-yellow-400 shrink-0">+{evt.happyChange}H</span>}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
