import { useEffect, useState, useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { calculateBatchTrain } from '../services/gymEngine'
import type { TrainResult, BatchTrainResult } from '../services/gymEngine'
import { calculateGymModifiersFromPerks } from '../utils/gymPerksParser'
import { ITEM_PRICES } from '../constants/items'
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
  const [trainEnergy, setTrainEnergy] = useState<number>(150)
  const [jumpHappy, setJumpHappy] = useState<number>(0)
  const [jumpType, setJumpType] = useState<string>('normal')

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
        setJumpHappy(res.data.happy?.maximum || 4025)
        setTrainEnergy(res.data.energy?.current || 150)
        setBoosterCd(res.data.cooldowns?.booster || 0)
        setDrugCd(res.data.cooldowns?.drug || 0)
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
    if (!data || !multipliers) return null
    const gym = gymData.gyms.find((g: any) => g.id === String(selectedGymId) || g.id === Number(selectedGymId))
    if (!gym) return null

    const currentStatVal = (data.battlestats?.[selectedStat] as number) || 10
    const gymDots = gym.multipliers?.[selectedStat] || 0
    if (gymDots === 0) return null

    const perkMult = multipliers[selectedStat]

    let initialHappy = jumpHappy;
    let energyToUse = trainEnergy;

    if (jumpType === 'choco') {
      initialHappy = (jumpHappy + 4900) * 2;
      energyToUse = 1000;
    } else if (jumpType === 'edvd') {
      initialHappy = (jumpHappy + 12500) * 2;
      energyToUse = 1000;
    }
    const energyPerTrain = gym.energy_per_train || 5;

    return calculateBatchTrain(
      selectedStat,
      currentStatVal,
      initialHappy,
      energyToUse,
      gymDots,
      energyPerTrain,
      perkMult
    )
  }, [data, multipliers, selectedGymId, selectedStat, jumpHappy, trainEnergy, jumpType])

  const roiAnalysis = useMemo(() => {
    if (!data || !multipliers) return null
    const gym = gymData.gyms.find((g: any) => g.id === String(selectedGymId) || g.id === Number(selectedGymId))
    if (!gym) return null

    const currentStatVal = (data.battlestats?.[selectedStat] as number) || 10
    const gymDots = gym.multipliers?.[selectedStat] || 0
    if (gymDots === 0) return null
    const perkMult = multipliers[selectedStat]

    const baseHappy = data.happy?.maximum || 4000;

    // 1. Standard Xanax Train
    // Cost: 1 Xanax
    // Action: 250 Energy, Base Happy
    const xanaxCost = ITEM_PRICES.XANAX;
    const xanaxResult = calculateBatchTrain(selectedStat, currentStatVal, baseHappy, 250, gymDots, gym.energy_per_train || 10, perkMult);
    const xanaxCostPerStat = xanaxCost / xanaxResult.totalStatGained;

    // 2. eDVD Jump (1000E)
    // Cost: 5 eDVD + 1 Ecstasy + 4 Xanax
    // Action: 1000 Energy, (Base + 12500) * 2 Happy
    const edvdCost = (5 * ITEM_PRICES.EDVD) + ITEM_PRICES.ECSTASY + (4 * ITEM_PRICES.XANAX);
    const edvdInitialHappy = (baseHappy + 12500) * 2;
    const edvdResult = calculateBatchTrain(selectedStat, currentStatVal, edvdInitialHappy, 1000, gymDots, gym.energy_per_train || 10, perkMult);
    const edvdCostPerStat = edvdCost / edvdResult.totalStatGained;

    // 3. Choco Jump (49 Truffles)
    // Cost: 49 Truffles + 1 Ecstasy + 4 Xanax
    // Action: 1000 Energy, (Base + 4900) * 2 Happy
    const chocoCost = (49 * ITEM_PRICES.TRUFFLES) + ITEM_PRICES.ECSTASY + (4 * ITEM_PRICES.XANAX);
    const chocoInitialHappy = (baseHappy + 4900) * 2;
    const chocoResult = calculateBatchTrain(selectedStat, currentStatVal, chocoInitialHappy, 1000, gymDots, gym.energy_per_train || 10, perkMult);
    const chocoCostPerStat = chocoCost / chocoResult.totalStatGained;

    const minCps = Math.min(xanaxCostPerStat, edvdCostPerStat, chocoCostPerStat);

    return {
      xanax: { cost: xanaxCost, gain: xanaxResult.totalStatGained, cps: xanaxCostPerStat, isBest: xanaxCostPerStat === minCps },
      edvd: { cost: edvdCost, gain: edvdResult.totalStatGained, cps: edvdCostPerStat, isBest: edvdCostPerStat === minCps },
      choco: { cost: chocoCost, gain: chocoResult.totalStatGained, cps: chocoCostPerStat, isBest: chocoCostPerStat === minCps }
    }
  }, [data, multipliers, selectedGymId, selectedStat])

  if (loading) return <div className="min-h-screen bg-black text-white p-10">Loading Profile...</div>
  if (error) return <div className="min-h-screen bg-black text-red-500 p-10">Error: {error}</div>
  if (!data) return null

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

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Tactical Overview */}
          <div className="flex flex-col gap-4">
            <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-2xl flex flex-col gap-4">
              <h2 className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em]">Current Status</h2>

              <div className="flex justify-between items-center bg-zinc-950 p-4 rounded-xl border border-white/5">
                <span className="text-sm font-bold text-zinc-400">Energy</span>
                <span className="text-xl font-mono text-emerald-400">{data.energy?.current} / {data.energy?.maximum}</span>
              </div>
              <div className="flex justify-between items-center bg-zinc-950 p-4 rounded-xl border border-white/5">
                <span className="text-sm font-bold text-zinc-400">Happy</span>
                <span className="text-xl font-mono text-yellow-400">{data.happy?.current || jumpHappy}</span>
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

            <div className="bg-zinc-900/40 border border-white/5 p-6 rounded-2xl flex flex-col gap-4">
              <h2 className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em]">Battle Stats</h2>
              <div className="grid grid-cols-2 gap-3">
                {['strength', 'speed', 'defense', 'dexterity'].map(stat => (
                  <div key={stat} className="bg-zinc-950 p-3 rounded-xl border border-white/5 flex flex-col items-center">
                    <span className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider">{stat}</span>
                    <span className="font-mono text-sm text-indigo-300 mt-1">
                      {Number(data.battlestats?.[stat] || 10).toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Happy Jump Simulator */}
          <div className="lg:col-span-2 bg-zinc-900/40 border border-white/5 p-6 rounded-2xl flex flex-col gap-6">
            <h2 className="text-[10px] text-indigo-500 font-black uppercase tracking-[0.2em]">Gym Simulator (Vladar Formula)</h2>

            {/* Controls */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase">Target Stat</label>
                <select
                  className="bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-mono focus:border-indigo-500 outline-none"
                  value={selectedStat}
                  onChange={e => setSelectedStat(e.target.value as any)}
                >
                  <option value="strength">Strength</option>
                  <option value="speed">Speed</option>
                  <option value="defense">Defense</option>
                  <option value="dexterity">Dexterity</option>
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase">Gym</label>
                <select
                  className="bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-mono focus:border-indigo-500 outline-none"
                  value={selectedGymId}
                  onChange={e => setSelectedGymId(e.target.value)}
                >
                  {gymData.gyms.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name} ({g.energy_per_train}E)</option>
                  ))}
                </select>
              </div>

              <div className="flex flex-col gap-2">
                <label className="text-[10px] text-zinc-400 font-bold uppercase">Jump Strategy</label>
                <select
                  className="bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-mono focus:border-indigo-500 outline-none"
                  value={jumpType}
                  onChange={e => {
                    const newType = e.target.value;
                    setJumpType(newType);

                    if (newType === 'edvd' || newType === 'choco') {
                       setTrainEnergy(1000);
                       setJumpHappy(data?.happy?.maximum || 4025);
                    } else {
                       setTrainEnergy(data?.energy?.current || 0);
                       setJumpHappy(data?.happy?.current || 0);
                    }
                  }}
                >
                  <option value="normal">Normal Train (Current Happy/Energy)</option>
                  <option value="choco">Choco Jump (49x Choco + 4x Xanax)</option>
                  <option value="edvd">5 eDVD Jump (5x eDVD + Ecstasy + 4x Xanax)</option>
                </select>
              </div>

              <div className="flex gap-4 w-full min-w-0">
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <label className="text-[10px] text-zinc-400 font-bold uppercase truncate">Energy</label>
                  <input type="number" className="w-full min-w-0 bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" value={trainEnergy} onChange={e => setTrainEnergy(Number(e.target.value))} />
                </div>
                <div className="flex flex-col gap-2 flex-1 min-w-0">
                  <label className="text-[10px] text-zinc-400 font-bold uppercase truncate">Base Happy</label>
                  <input type="number" className="w-full min-w-0 bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-mono outline-none focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500" value={jumpHappy} onChange={e => setJumpHappy(Number(e.target.value))} />
                </div>
              </div>
            </div>

            {/* Results */}
            {simulationResult ? (
              <div className="mt-4 p-6 bg-indigo-500/5 border border-indigo-500/20 rounded-2xl flex flex-col gap-6 relative overflow-hidden">
                <div className="absolute top-0 right-0 w-32 h-32 bg-indigo-500/10 blur-3xl rounded-full mix-blend-screen" />

                <div className="flex flex-col md:flex-row justify-between items-center gap-6 relative z-10">
                  <div className="flex flex-col items-center flex-1 w-full bg-black/40 p-6 rounded-xl border border-white/5">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase mb-2">Total Gain</span>
                    <span className="text-4xl font-black font-mono text-emerald-400">
                      +{Math.floor(simulationResult.totalStatGained).toLocaleString()}
                    </span>
                  </div>
                  <div className="flex flex-col items-center flex-1 w-full bg-black/40 p-6 rounded-xl border border-white/5">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase mb-2">Final Stat</span>
                    <span className="text-4xl font-black font-mono text-indigo-300">
                      {Math.floor(simulationResult.finalStat).toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-4 border-t border-white/5 pt-6 relative z-10">
                  <div className="flex flex-col items-center">
                    <span className="text-[9px] text-zinc-500 font-bold uppercase">Energy Spent</span>
                    <span className="text-sm font-mono text-white mt-1">{simulationResult.totalEnergySpent}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[9px] text-zinc-500 font-bold uppercase">Happy Lost</span>
                    <span className="text-sm font-mono text-yellow-400 mt-1">{simulationResult.totalHappyLost}</span>
                  </div>
                  <div className="flex flex-col items-center">
                    <span className="text-[9px] text-zinc-500 font-bold uppercase">Multiplier</span>
                    <span className="text-sm font-mono text-cyan-400 mt-1">x{(multipliers?.[selectedStat] || 1).toFixed(2)}</span>
                  </div>
                </div>

                {/* ROI Analyzer Section */}
                {roiAnalysis && (
                  <div className="mt-2 border-t border-white/5 pt-6 relative z-10">
                    <h3 className="text-[10px] text-zinc-500 font-bold uppercase mb-4 flex items-center gap-2">
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" /></svg>
                      Happy Jump ROI Analyzer
                    </h3>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">

                      {/* Normal Train */}
                      <div className={`p-4 rounded-xl border flex flex-col gap-2 ${roiAnalysis.xanax.isBest ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-black/40 border-white/5'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold uppercase text-zinc-400">Normal (250E)</span>
                          {roiAnalysis.xanax.isBest && <span className="text-[9px] bg-emerald-500 text-black px-1.5 py-0.5 rounded font-black">BEST ROI</span>}
                        </div>
                        <div className="flex flex-col mt-1">
                          <span className="text-[10px] text-zinc-500 font-mono">Cost: ${(roiAnalysis.xanax.cost / 1000000).toFixed(1)}M</span>
                          <span className="text-[10px] text-zinc-500 font-mono">Gain: +{Math.floor(roiAnalysis.xanax.gain).toLocaleString()}</span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-white/5 flex justify-between items-end">
                          <span className="text-[9px] text-zinc-500 font-bold">COST / STAT</span>
                          <span className={`text-sm font-black font-mono ${roiAnalysis.xanax.isBest ? 'text-emerald-400' : 'text-white'}`}>
                            ${Math.floor(roiAnalysis.xanax.cps).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {/* Choco Jump */}
                      <div className={`p-4 rounded-xl border flex flex-col gap-2 ${roiAnalysis.choco.isBest ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-black/40 border-white/5'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold uppercase text-zinc-400">49 Choco (1000E)</span>
                          {roiAnalysis.choco.isBest && <span className="text-[9px] bg-emerald-500 text-black px-1.5 py-0.5 rounded font-black">BEST ROI</span>}
                        </div>
                        <div className="flex flex-col mt-1">
                          <span className="text-[10px] text-zinc-500 font-mono">Cost: ${(roiAnalysis.choco.cost / 1000000).toFixed(1)}M</span>
                          <span className="text-[10px] text-zinc-500 font-mono">Gain: +{Math.floor(roiAnalysis.choco.gain).toLocaleString()}</span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-white/5 flex justify-between items-end">
                          <span className="text-[9px] text-zinc-500 font-bold">COST / STAT</span>
                          <span className={`text-sm font-black font-mono ${roiAnalysis.choco.isBest ? 'text-emerald-400' : 'text-white'}`}>
                            ${Math.floor(roiAnalysis.choco.cps).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      {/* eDVD Jump */}
                      <div className={`p-4 rounded-xl border flex flex-col gap-2 ${roiAnalysis.edvd.isBest ? 'bg-emerald-500/10 border-emerald-500/30 shadow-[0_0_15px_rgba(16,185,129,0.1)]' : 'bg-black/40 border-white/5'}`}>
                        <div className="flex justify-between items-center">
                          <span className="text-[10px] font-bold uppercase text-zinc-400">5 eDVD (1000E)</span>
                          {roiAnalysis.edvd.isBest && <span className="text-[9px] bg-emerald-500 text-black px-1.5 py-0.5 rounded font-black">BEST ROI</span>}
                        </div>
                        <div className="flex flex-col mt-1">
                          <span className="text-[10px] text-zinc-500 font-mono">Cost: ${(roiAnalysis.edvd.cost / 1000000).toFixed(1)}M</span>
                          <span className="text-[10px] text-zinc-500 font-mono">Gain: +{Math.floor(roiAnalysis.edvd.gain).toLocaleString()}</span>
                        </div>
                        <div className="mt-2 pt-2 border-t border-white/5 flex justify-between items-end">
                          <span className="text-[9px] text-zinc-500 font-bold">COST / STAT</span>
                          <span className={`text-sm font-black font-mono ${roiAnalysis.edvd.isBest ? 'text-emerald-400' : 'text-white'}`}>
                            ${Math.floor(roiAnalysis.edvd.cps).toLocaleString()}
                          </span>
                        </div>
                      </div>

                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="mt-4 p-10 flex justify-center items-center bg-zinc-950 border border-white/5 rounded-2xl">
                <span className="text-sm font-bold text-zinc-600">Select a valid Gym and Stat to simulate</span>
              </div>
            )}
          </div>
        </div>

        {/* Perks Section */}
        <div className="mt-8 bg-zinc-900/40 border border-white/5 p-6 rounded-2xl flex flex-col gap-6">
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
      </main>
      
      <footer className="px-6 py-4 text-center border-t border-white/5 bg-zinc-900/60 mt-auto shrink-0 relative z-20">
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-black opacity-60">
          Torn Chain Tool v1.1 • Authorized Personnel Only
        </p>
      </footer>
    </div>
  )
}
