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
  onChange: (jump: JumpCalculationResult, cost: number, isStackedJump: boolean, hasRefill: boolean, config: JumpConfig['items']) => void;
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
    ecstasy: 0,
    sleepHours: 0
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

    onChange(result, totalCost, isStackedJump, hasRefill, config);
  }, [result, config, onChange]);

  useEffect(() => {
    const handleUpdateSleep = (e: any) => {
      setConfig(prev => ({ ...prev, sleepHours: e.detail }));
      setPresetMode('custom');
    };
    window.addEventListener('updateSleep', handleUpdateSleep);
    return () => window.removeEventListener('updateSleep', handleUpdateSleep);
  }, []);

  const updateItem = (key: keyof JumpConfig['items'], delta: number) => {
    setConfig(prev => ({
      ...prev,
      [key]: Math.max(0, (prev[key] || 0) + delta)
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
      setConfig(prev => ({ xanax: 0, refill: 0, fhc: 0, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, ecstasy: 0, sleepHours: prev.sleepHours }));
    } else if (type === 'daily') {
      setConfig(prev => ({ xanax: 3, refill: 1, fhc: 0, edvd: 0, truffles: 0, tootsie: 0, lollipop: 0, ecstasy: 0, sleepHours: prev.sleepHours }));
    } else {
      const p = optimalPresets.find(o => o.id === type);
      if (p) {
        setConfig(prev => ({ 
          ...p.config, 
          sleepHours: p.config.sleepHours !== undefined ? p.config.sleepHours : prev.sleepHours 
        }));
      }
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
    const isXanaxLimitReached = key === 'xanax' && (baseEnergy + ((config.xanax || 0) * 250) >= 1000);
    const isDisabled = (max !== undefined && (config[key] || 0) >= max) || isAtBoosterLimit || isXanaxLimitReached;

    // Dot color based on item type
    const dotColor =
      key === 'xanax' || key === 'ecstasy' ? 'bg-rose-500' :
        key === 'refill' ? 'bg-yellow-500' :
          key === 'fhc' ? 'bg-amber-500' : 'bg-cyan-500';

    const cleanName = label.includes('(') ? label.split('(')[0].trim() : label;

    return (
      <div className="flex justify-between items-center bg-zinc-900/60 p-1.5 px-3 rounded-xl border border-white/10 shadow-lg hover:border-white/20 hover:bg-zinc-900/80 transition-all duration-200">
        <div className="flex items-center gap-2 overflow-hidden">
          <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColor} opacity-60`} />
          <span className="text-[9px] font-bold uppercase text-zinc-400 truncate" title={label}>
            <span className="inline sm:hidden">{cleanName}</span>
            <span className="hidden sm:inline">{label}</span>
          </span>
        </div>
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => updateItem(key, -1)}
            className="w-5 h-5 flex justify-center items-center rounded bg-white/5 hover:bg-white/10 text-white transition-colors text-xs"
          >-</button>
          <span className="font-mono text-xs w-4 text-center">{config[key]}</span>
          <button
            onClick={() => updateItem(key, 1)}
            disabled={isDisabled}
            className={`w-5 h-5 flex justify-center items-center rounded transition-colors text-xs ${isDisabled
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
        <label className="text-[10px] text-zinc-400 font-bold uppercase">Load Preset</label>
        <CustomSelect
          value={presetMode}
          onChange={(val) => {
            setPresetMode(val);
            setPreset(val);
          }}
          options={[
            { value: 'normal', label: 'Natural Train' },
            { value: 'daily', label: 'Daily Routine (3x Xanax + 1x Refill)' },
            ...optimalPresets.map(p => ({ value: p.id, label: p.label })),
            { value: 'custom', label: 'Custom Configuration' }
          ]}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Item Selectors (Dynamic 2-column grid layout) */}
        <div className="flex flex-col gap-4">
          <div>
            <h3 className="text-[9px] text-indigo-500 font-bold uppercase tracking-widest mb-2">Energy & Multipliers</h3>
            <div className="grid grid-cols-2 gap-2">
              {renderCounter('Xanax (+250 Energy)', ITEM_PRICES.XANAX, 'xanax')}
              {renderCounter('Ecstasy (x2 Happy)', ITEM_PRICES.ECSTASY, 'ecstasy', 1)}
              {renderCounter('Point Refill', ITEM_PRICES.POINT * 25, 'refill', 1)}
              {renderCounter('FHC (+500 Happy)', ITEM_PRICES.FHC, 'fhc')}
            </div>
          </div>

          <div>
            <h3 className="text-[9px] text-indigo-500 font-bold uppercase tracking-widest mb-2">Happy Boosters</h3>
            <div className="grid grid-cols-2 gap-2">
              {renderCounter('eDVD (+2500 Happy)', ITEM_PRICES.EDVD, 'edvd')}
              {renderCounter('Truffles (+100 Happy)', ITEM_PRICES.TRUFFLES, 'truffles')}
              {renderCounter('Tootsie (+75 Happy)', ITEM_PRICES.TOOTSIE, 'tootsie')}
              {renderCounter('Lollipop (+25 Happy)', ITEM_PRICES.LOLLIPOP, 'lollipop')}
            </div>
          </div>
        </div>

        {/* Results Panel */}
        <div className="bg-zinc-900 rounded-2xl border border-white/10 p-4 flex flex-col gap-4 shadow-xl">
          <div className="flex justify-between items-center pb-3 border-b border-white/10">
            <span className="text-[10px] font-black uppercase text-zinc-200 tracking-wider">Total Cost</span>
            <span className="font-mono text-base font-black text-amber-200 drop-shadow-[0_0_10px_rgba(252,211,77,0.4)]">${(totalCost / 1000000).toFixed(2)}M</span>
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

    </div>
  );
}
