import { useEffect, useState, useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { calculate24hYield, calculateJumpStatGain } from '../services/jumpOptimizer'
import { calculateJump } from '../services/jumpCalculator'
import { JumpTimeline } from '../components/JumpTimeline'
import type { TrainResult, BatchTrainResult } from '../services/gymEngine'
import { calculateGymModifiersFromPerks } from '../utils/gymPerksParser'
import { ITEM_PRICES } from '../constants/items'
import { CustomSelect } from '../components/CustomSelect'
import { JumpBuilder } from '../components/JumpBuilder'
import gymData from '../../data/gym_data.json'

export const Route = createFileRoute('/profile')({
  component: ProfilePage,
})

function ProfilePage() {
  const [data, setData] = useState<any>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  // Simulator State
  const [selectedGymId, setSelectedGymId] = useState<string>(() => {
    return localStorage.getItem('tct_selected_gym') || 'premier_fitness';
  })
  const [selectedStat, setSelectedStat] = useState<'strength' | 'speed' | 'defense' | 'dexterity'>('strength')

  useEffect(() => {
    localStorage.setItem('tct_selected_gym', selectedGymId);
  }, [selectedGymId]);
  const [currentJump, setCurrentJump] = useState<any>(null)
  const [currentConfig, setCurrentConfig] = useState<any>(null)
  const [jumpCost, setJumpCost] = useState<number>(0)
  const [isStackedJump, setIsStackedJump] = useState<boolean>(false)
  const [jumpHasRefill, setJumpHasRefill] = useState<boolean>(false)

  const [baseEnergy, setBaseEnergy] = useState<number>(150)
  const [baseHappy, setBaseHappy] = useState<number>(4000)
  const [editableStats, setEditableStats] = useState<Record<string, number> | null>(null);

  // Live Cooldown States
  const [boosterCd, setBoosterCd] = useState<number>(0)
  const [drugCd, setDrugCd] = useState<number>(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setBoosterCd(prev => Math.max(0, prev - 1));
      setDrugCd(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    fetch('/api/profile/gym-data')
      .then(res => res.json())
      .then((res: any) => {
        if (res.error) throw new Error(res.error)
        setData(res.data)
        setBaseHappy(res.data.happy?.maximum || 4025)
        setBaseEnergy(res.data.energy?.current || 150)
        setBoosterCd(res.data.cooldowns?.booster || 0)
        setDrugCd(res.data.cooldowns?.drug || 0)
        setEditableStats({
          strength: Number(res.data.battlestats?.strength || 10),
          defense: Number(res.data.battlestats?.defense || 10),
          speed: Number(res.data.battlestats?.speed || 10),
          dexterity: Number(res.data.battlestats?.dexterity || 10),
        })
        setLoading(false)
      })
      .catch(err => {
        setError(err.message)
        setLoading(false)
      })
  }, [])

  const multipliers = useMemo(() => {
    if (!data) return null
    return calculateGymModifiersFromPerks(data.perks)
  }, [data])

  const perkCategories = useMemo(() => {
    if (!data?.perks) return { gym: [], passive: [], other: [] }
    const gym: { source: string, text: string }[] = []
    const passive: { source: string, text: string }[] = []
    const other: { source: string, text: string }[] = []

    Object.entries(data.perks).forEach(([source, perksList]) => {
      if (!Array.isArray(perksList)) return
      const sourceName = source.replace('_perks', '').replace('_', ' ').toUpperCase()

      perksList.forEach(perk => {
        const p = { source: sourceName, text: perk }
        const lower = perk.toLowerCase()
        if (lower.includes('gym')) {
          gym.push(p)
        } else if (lower.includes('passive') || lower.includes('damage') || lower.includes('accuracy') || lower.includes('armor') || lower.includes('critical') || lower.includes('life')) {
          passive.push(p)
        } else {
          other.push(p)
        }
      })
    })

    return { gym, passive, other }
  }, [data])

  const formatCd = (seconds: number) => {
    if (!seconds || seconds <= 0) return '00:00:00';
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    return `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  const simulationResult = useMemo(() => {
    if (!data || !multipliers || !currentJump) return null
    const gym = gymData.gyms.find((g: any) => g.id === String(selectedGymId) || g.id === Number(selectedGymId))
    if (!gym) return null

    const currentStatVal = editableStats ? editableStats[selectedStat] : ((data.battlestats?.[selectedStat] as number) || 10);
    const gymDots = gym.multipliers?.[selectedStat] || 0
    if (gymDots === 0) return null

    const perkMult = multipliers[selectedStat]
    const energyPerTrain = gym.energy_per_train || 5;

    const res = calculateJumpStatGain(
      currentJump,
      data.energy?.maximum || 150,
      selectedStat,
      currentStatVal,
      gymDots,
      energyPerTrain,
      perkMult,
      currentConfig,
      baseHappy
    );

    return {
      ...res,
      totalEnergySpent: currentJump.totalEnergy,
      totalHappyLost: currentJump.peakHappy - res.finalHappy
    };
  }, [data, multipliers, selectedGymId, selectedStat, currentJump, editableStats, currentConfig, baseHappy])

  const yield24h = useMemo(() => {
    if (!simulationResult || !data || !multipliers) return null;
    const activeGym = gymData.gyms.find((g: any) => g.id === String(selectedGymId) || g.id === Number(selectedGymId));
    if (!activeGym) return null;

    const currentStatVal = editableStats ? editableStats[selectedStat] : ((data.battlestats?.[selectedStat] as number) || 10);
    const gymDots = activeGym.multipliers?.[selectedStat] || 0;
    const perkMult = multipliers[selectedStat] || 1;
    const energyPerTrain = activeGym.energy_per_train || 10;
    const naturalEnergyPerDay = (data.donator === 1) ? 720 : 480;

    // Check if it's a daily routine preset (both extra and standard)
    const isDaily = currentConfig && currentConfig.xanax === 3 && currentConfig.refill === 1;
    if (isDaily) {
      return {
        gain24h: simulationResult.totalStatGained,
        cost24h: jumpCost
      };
    }

    const timeMins = currentJump.prepTimeMins + currentJump.totalDrugCdMins + currentJump.totalBoosterCdMins;

    return calculate24hYield(
      simulationResult.totalStatGained,
      jumpCost,
      timeMins,
      isStackedJump,
      jumpHasRefill,
      baseHappy,
      selectedStat,
      currentStatVal,
      gymDots,
      energyPerTrain,
      perkMult,
      naturalEnergyPerDay
    );
  }, [simulationResult, data, multipliers, selectedGymId, selectedStat, jumpCost, currentJump, isStackedJump, jumpHasRefill, baseHappy, editableStats, currentConfig]);


  if (loading) return <div className="min-h-screen bg-black text-white p-10">Loading Profile...</div>
  if (error) return <div className="min-h-screen bg-black text-red-500 p-10">Error: {error}</div>
  if (!data) return null

  const activeGym = gymData.gyms.find((g: any) => g.id === String(selectedGymId) || g.id === Number(selectedGymId));
  const currentStatVal = editableStats ? editableStats[selectedStat] : ((data.battlestats?.[selectedStat] as number) || 10);
  const gymDots = activeGym?.multipliers?.[selectedStat] || 0;
  const perkMult = multipliers?.[selectedStat] || 1;
  const energyPerTrain = activeGym?.energy_per_train || 10;

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col font-sans relative overflow-hidden">
      <main className="flex-1 p-4 md:p-10 flex justify-center w-full overflow-y-auto">
        <div className="w-full max-w-[1200px] flex flex-col gap-6">

        {/* Header */}
        <div className="flex items-center justify-between bg-zinc-900/40 p-6 rounded-2xl border border-white/5">
          <div className="flex items-center gap-4">
            <Link to="/" className="text-zinc-500 hover:text-white transition-colors">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
            </Link>
            <h1 className="text-2xl font-black uppercase tracking-widest text-indigo-400">Commander Profile</h1>
          </div>
          <div className="flex items-center gap-4">
            <div className="flex flex-col items-end">
              <span className="text-white font-bold text-lg">{data.name}</span>
              <span className="text-zinc-500 font-mono text-xs">[{data.player_id}]</span>
            </div>
          </div>
        </div>

        <div className="flex flex-col gap-6 w-full">
          {/* Tactical Overview */}
            <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-2xl flex flex-col gap-4">
              <h2 className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em]">Current Status</h2>

              <div className="flex justify-between items-center bg-zinc-950 p-4 rounded-xl border border-white/5">
                <span className="text-sm font-bold text-zinc-400">Energy</span>
                <span className="text-xl font-mono text-emerald-400">{data.energy?.current} / {data.energy?.maximum}</span>
              </div>
              <div className="flex justify-between items-center bg-zinc-950 p-4 rounded-xl border border-white/5">
                <span className="text-sm font-bold text-zinc-400">Happy</span>
                <span className="text-xl font-mono text-yellow-400">{data.happy?.current || baseHappy}</span>
              </div>

              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="bg-zinc-950 p-3 rounded-xl border border-white/5 flex flex-col">
                  <span className="text-[9px] text-zinc-600 font-bold uppercase">Booster CD</span>
                  <span className={`font-mono text-sm mt-1 ${boosterCd > 0 ? 'text-rose-400' : 'text-zinc-300'}`}>
                    {formatCd(boosterCd)}
                  </span>
                </div>
                <div className="bg-zinc-950 p-3 rounded-xl border border-white/5 flex flex-col">
                  <span className="text-[9px] text-zinc-600 font-bold uppercase">Drug CD</span>
                  <span className={`font-mono text-sm mt-1 ${drugCd > 0 ? 'text-rose-400' : 'text-zinc-300'}`}>
                    {formatCd(drugCd)}
                  </span>
                </div>
              </div>
            </div>

          {/* Happy Jump Simulator */}
          <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-2xl flex flex-col gap-6 w-full">
            <h2 className="text-[10px] text-indigo-500 font-black uppercase tracking-[0.2em]">Gym Simulator (Vladar Formula)</h2>

            {/* Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              
              <div className="flex flex-col gap-2 md:col-span-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase">Gym</label>
                <CustomSelect
                  value={selectedGymId}
                  onChange={setSelectedGymId}
                  groups={[
                    { label: '--- Lightweight Gyms ---', options: gymData.gyms.slice(0, 8).map((g: any) => ({ value: g.id, label: `${g.name} (${g.energy_per_train}E)` })) },
                    { label: '--- Middleweight Gyms ---', options: gymData.gyms.slice(8, 16).map((g: any) => ({ value: g.id, label: `${g.name} (${g.energy_per_train}E)` })) },
                    { label: '--- Heavyweight Gyms ---', options: gymData.gyms.slice(16, 24).map((g: any) => ({ value: g.id, label: `${g.name} (${g.energy_per_train}E)` })) },
                    { label: '--- Specialist Gyms ---', options: gymData.gyms.slice(24, 31).map((g: any) => ({ value: g.id, label: `${g.name} (${g.energy_per_train}E)` })) },
                    { label: '--- Other Gyms ---', options: gymData.gyms.slice(31).map((g: any) => ({ value: g.id, label: `${g.name} (${g.energy_per_train}E)` })) }
                  ]}
                />
              </div>
              
              {/* Target Stat - 4 Blocks */}
              <div className="flex flex-col gap-2 md:col-span-2">
                <div className="flex items-center justify-between">
                  <label className="text-[10px] text-zinc-400 font-bold uppercase">Target Stat</label>
                  <button 
                    onClick={() => {
                      if (data?.battlestats) {
                        setEditableStats({
                          strength: Number(data.battlestats.strength || 10),
                          defense: Number(data.battlestats.defense || 10),
                          speed: Number(data.battlestats.speed || 10),
                          dexterity: Number(data.battlestats.dexterity || 10),
                        });
                      }
                    }}
                    className="text-[9px] text-zinc-500 hover:text-indigo-400 font-bold uppercase tracking-widest transition-colors flex items-center gap-1"
                  >
                    <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                    </svg>
                    Reset to Actual
                  </button>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {[
                    { id: 'strength', label: 'Strength' },
                    { id: 'defense', label: 'Defense' },
                    { id: 'speed', label: 'Speed' },
                    { id: 'dexterity', label: 'Dexterity' }
                  ].map(stat => (
                    <div
                      key={stat.id}
                      className={`rounded-xl border transition-all duration-200 overflow-hidden flex flex-col ${
                        selectedStat === stat.id 
                          ? 'bg-indigo-500/10 border-indigo-500 shadow-[0_0_15px_rgba(99,102,241,0.1)]' 
                          : 'bg-zinc-950 border-white/5 hover:border-white/20'
                      }`}
                    >
                      <button
                        onClick={() => setSelectedStat(stat.id as any)}
                        className={`w-full py-2 flex justify-center items-center font-black text-[10px] tracking-widest uppercase transition-colors ${
                          selectedStat === stat.id ? 'bg-indigo-500/20 text-indigo-300' : 'text-zinc-500 hover:text-white'
                        }`}
                      >
                        {stat.label}
                      </button>
                      <div className="p-2 pt-0 flex items-center bg-transparent">
                        <input
                          type="number"
                          value={editableStats ? editableStats[stat.id] : (data.battlestats?.[stat.id] || 10)}
                          onChange={(e) => {
                            let val = Number(e.target.value);
                            if (val < 0) val = 0;
                            setEditableStats(prev => prev ? { ...prev, [stat.id]: val } : null);
                          }}
                          className={`w-full bg-black/40 rounded-lg p-2 text-center font-mono text-sm outline-none transition-colors ${
                            selectedStat === stat.id ? 'text-indigo-200 focus:bg-indigo-900/40 focus:ring-1 focus:ring-indigo-500' : 'text-zinc-400 focus:bg-zinc-900 focus:ring-1 focus:ring-zinc-600'
                          }`}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              <div className="flex gap-4 w-full min-w-0 md:col-span-2 mt-2">
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <label className="text-[10px] text-zinc-400 font-bold uppercase truncate">Base Energy</label>
                  <input type="number" step="5" className="w-full min-w-0 bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" value={baseEnergy} onChange={e => setBaseEnergy(Number(e.target.value))} />
                </div>
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <label className="text-[10px] text-zinc-400 font-bold uppercase truncate">Base Happy</label>
                  <input type="number" className="w-full min-w-0 bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" value={baseHappy} onChange={e => setBaseHappy(Number(e.target.value))} />
                </div>
              </div>

              <div className="flex flex-col gap-2 md:col-span-2">
                <JumpBuilder
                  baseEnergy={baseEnergy}
                  baseHappy={baseHappy}
                  maxEnergy={data?.energy?.maximum || 150}
                  currentStat={currentStatVal}
                  gymMultiplier={perkMult}
                  gymDots={gymDots}
                  energyPerTrain={energyPerTrain}
                  statType={selectedStat}
                  naturalEnergyPerDay={(data.donator === 1) ? 720 : 480}
                  onChange={(jump, cost, stacked, refill, config) => {
                    setCurrentJump(jump)
                    setCurrentConfig(config)
                    setJumpCost(cost)
                    setIsStackedJump(stacked)
                    setJumpHasRefill(refill)
                  }}
                />
              </div>

            {/* Results placeholder */}
            {!simulationResult && (
              <div className="mt-4 p-10 flex justify-center items-center bg-zinc-950 border border-white/5 rounded-2xl">
                <span className="text-sm font-bold text-zinc-600">Select a valid Gym and Stat to simulate</span>
              </div>
            )}
          </div>
        </div>

        {/* Timeline Container - Full Width */}
        {currentConfig && (
          <div className="mt-8">
            <JumpTimeline 
              config={currentConfig} 
              maxEnergy={data?.energy?.maximum || 150}
              naturalEnergyPerDay={(data.donator === 1) ? 720 : 480}
              totalGain={simulationResult?.totalStatGained}
              finalStat={simulationResult?.finalStat}
              totalCost={jumpCost}
              yield24h={yield24h}
              statType={selectedStat}
            />
          </div>
        )}

        {/* Perks Section */}
        <div className="mt-8 bg-zinc-900/40 border border-white/5 p-6 rounded-2xl flex flex-col gap-6 w-full">
          <h2 className="text-[10px] text-indigo-500 font-black uppercase tracking-[0.2em]">Active Perks & Modifiers</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">

            {/* Gym Perks */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-cyan-400"></div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Gym Training Phase</h3>
              </div>

              {/* Gym Summary Box */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                {['strength', 'speed', 'defense', 'dexterity'].map(stat => (
                  <div key={stat} className="bg-cyan-500/10 border border-cyan-500/20 p-2 rounded-lg flex justify-between items-center">
                    <span className="text-[9px] text-cyan-400 uppercase font-bold">{stat.substring(0, 3)}</span>
                    <span className="text-xs font-mono text-white">x{(multipliers?.[stat as 'strength' | 'speed' | 'defense' | 'dexterity'] || 1).toFixed(2)}</span>
                  </div>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                {perkCategories.gym.map((p: any, i: number) => (
                  <div key={i} className="bg-zinc-950 p-3 rounded-xl border border-white/5 flex flex-col">
                    <span className="text-[9px] text-cyan-500 font-bold mb-1">{p.source}</span>
                    <span className="text-xs text-zinc-300 font-medium">{p.text}</span>
                  </div>
                ))}
                {perkCategories.gym.length === 0 && <span className="text-xs text-zinc-600">No active gym perks.</span>}
              </div>
            </div>

            {/* Combat Perks */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-rose-500"></div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Combat Stats Phase</h3>
              </div>

              {/* Combat Summary Box */}
              <div className="grid grid-cols-2 gap-2 mb-2">
                {['strength', 'speed', 'defense', 'dexterity'].map(stat => {
                  const val = data?.battlestats?.[`${stat}_modifier`] || 0;
                  return (
                    <div key={stat} className="bg-rose-500/10 border border-rose-500/20 p-2 rounded-lg flex justify-between items-center">
                      <span className="text-[9px] text-rose-400 uppercase font-bold">{stat.substring(0, 3)}</span>
                      <span className="text-xs font-mono text-white">{val > 0 ? '+' : ''}{val}%</span>
                    </div>
                  );
                })}
              </div>

              <div className="flex flex-col gap-2">
                {perkCategories.passive.map((p: any, i: number) => (
                  <div key={i} className="bg-zinc-950 p-3 rounded-xl border border-white/5 flex flex-col">
                    <span className="text-[9px] text-rose-500 font-bold mb-1">{p.source}</span>
                    <span className="text-xs text-zinc-300 font-medium">{p.text}</span>
                  </div>
                ))}
                {perkCategories.passive.length === 0 && <span className="text-xs text-zinc-600">No active combat perks.</span>}
              </div>
            </div>

            {/* Utility Perks */}
            <div className="flex flex-col gap-3">
              <div className="flex items-center gap-2 mb-2">
                <div className="w-2 h-2 rounded-full bg-emerald-500"></div>
                <h3 className="text-xs font-bold text-white uppercase tracking-wider">Utility & Other</h3>
              </div>
              <div className="flex flex-col gap-2">
                {perkCategories.other.map((p: any, i: number) => (
                  <div key={i} className="bg-zinc-950 p-3 rounded-xl border border-white/5 flex flex-col">
                    <span className="text-[9px] text-emerald-500 font-bold mb-1">{p.source}</span>
                    <span className="text-xs text-zinc-300 font-medium">{p.text}</span>
                  </div>
                ))}
                {perkCategories.other.length === 0 && <span className="text-xs text-zinc-600">No other active perks.</span>}
              </div>
            </div>

          </div>
        </div>
        </div>
        </div>
      </main>
      
      <footer className="px-6 py-4 text-center border-t border-white/5 bg-zinc-900/60 mt-auto shrink-0 relative z-20">
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-black opacity-60">
          Torn Chain Tool v1.1 • Authorized Personnel Only
        </p>
      </footer>
    </div>
  )
}
