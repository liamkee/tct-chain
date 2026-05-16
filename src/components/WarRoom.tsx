import { useDashboardStore } from '../hooks/useDashboardStore'
import { useMemo, useState, useEffect } from 'react'

export function WarRoom() {
  const rankedWar = useDashboardStore(state => state.rankedWar)
  const factionId = useDashboardStore(state => state.factionId)

  // To calculate PPM, we need historical snapshots. We can keep a local state of snapshots
  const [history, setHistory] = useState<{ ts: number, score: number }[]>([]);

  const warData = useMemo(() => {
    if (!rankedWar || !factionId || !rankedWar.factions || !rankedWar.war) return null;

    const target = rankedWar.war.target;
    const factions = rankedWar.factions;

    let ourScore = 0;
    let theirScore = 0;
    let ourName = '';
    let theirName = '';

    Object.entries(factions).forEach(([id, data]: [string, any]) => {
      if (id === factionId) {
        ourScore = data.score;
        ourName = data.name;
      } else {
        theirScore = data.score;
        theirName = data.name;
      }
    });

    const lead = ourScore - theirScore;
    const pointsToWin = target - ourScore;
    const progress = Math.min(100, Math.max(0, (ourScore / target) * 100));

    return {
      target, ourScore, theirScore, ourName, theirName, lead, pointsToWin, progress
    }
  }, [rankedWar, factionId])

  useEffect(() => {
    if (warData) {
      setHistory(prev => {
        const now = Date.now();
        // Prevent duplicate consecutive values
        if (prev.length > 0 && prev[prev.length - 1].score === warData.ourScore) {
          // If score hasn't changed, just keep history (PPM will naturally drop)
          return prev;
        }
        const newHistory = [...prev, { ts: now, score: warData.ourScore }];
        // Keep last 15 minutes of history
        return newHistory.filter(h => now - h.ts <= 15 * 60 * 1000);
      });
    }
  }, [warData?.ourScore]);

  const ppm = useMemo(() => {
    if (history.length < 2) return 0;
    const oldest = history[0];
    const newest = history[history.length - 1];
    const minutes = (newest.ts - oldest.ts) / 60000;
    if (minutes <= 0.1) return 0; // Not enough time passed
    return (newest.score - oldest.score) / minutes;
  }, [history]);

  if (!warData) return null;

  const etaMinutes = ppm > 0 ? warData.pointsToWin / ppm : -1;
  const etaStr = etaMinutes > 0 
    ? `${Math.floor(etaMinutes / 60) > 0 ? `${Math.floor(etaMinutes / 60)}h ` : ''}${Math.floor(etaMinutes % 60)}m` 
    : '—';

  return (
    <div className="bg-zinc-900/40 border border-white/10 rounded-2xl p-6 relative overflow-hidden group shadow-[0_0_50px_rgba(244,63,94,0.03)] w-full flex flex-col">
      <div className="absolute inset-0 bg-linear-to-r from-emerald-500/5 via-transparent to-rose-500/5 opacity-50" />
      
      <div className="relative z-10 flex flex-col gap-4 w-full">
        {/* Faction Headers & Center Target */}
        <div className="flex flex-col md:flex-row justify-between items-center md:items-end px-2 md:px-4 gap-6 md:gap-0">
          
          <div className="flex justify-between items-end w-full md:w-auto md:contents">
            {/* Our Side */}
            <div className="flex flex-col gap-1 text-left">
              <span className="text-xs md:text-sm font-black text-emerald-400 flex items-center gap-2 tracking-widest uppercase truncate max-w-[130px] md:max-w-none">
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 shrink-0 bg-emerald-400 rounded-sm shadow-[0_0_10px_currentColor]" />
                <span className="truncate">{warData.ourName || 'Our Faction'}</span>
              </span>
              <span className="text-4xl md:text-5xl font-mono font-black text-white tracking-tighter drop-shadow-xl">
                {warData.ourScore.toLocaleString()}
              </span>
            </div>

            {/* Their Side */}
            <div className="flex flex-col gap-1 text-right md:order-3">
              <span className="text-xs md:text-sm font-black text-rose-400 flex items-center justify-end gap-2 tracking-widest uppercase truncate max-w-[130px] md:max-w-none">
                <span className="truncate">{warData.theirName || 'Enemy Faction'}</span>
                <div className="w-1.5 h-1.5 md:w-2 md:h-2 shrink-0 bg-rose-400 rounded-sm shadow-[0_0_10px_currentColor]" />
              </span>
              <span className="text-4xl md:text-5xl font-mono font-black text-white tracking-tighter drop-shadow-xl">
                {warData.theirScore.toLocaleString()}
              </span>
            </div>
          </div>
          
          {/* Center Target & ETA */}
          <div className="flex flex-col items-center justify-end pb-0 md:pb-1 w-full md:w-auto order-last md:order-2 border-t border-white/5 md:border-t-0 pt-4 md:pt-0">
            <span className="text-[9px] md:text-[10px] text-zinc-500 font-bold uppercase tracking-[0.3em] mb-1.5">Target Score</span>
            <div className="flex items-center gap-4">
              <span className="text-3xl md:text-4xl font-black font-mono text-white tracking-widest bg-zinc-900/80 px-4 md:px-5 py-1 md:py-1.5 rounded-xl md:rounded-2xl border border-indigo-500/30 shadow-[0_0_20px_rgba(99,102,241,0.15)]">
                {warData.target.toLocaleString()}
              </span>
            </div>
            <span className="text-[10px] md:text-[11px] text-indigo-400 font-bold uppercase tracking-widest mt-2 md:mt-3 flex items-center gap-2">
              Estimated Finish: <span className="text-xs md:text-sm text-white">{etaStr}</span>
            </span>
          </div>
        </div>

        {/* Unified Bar */}
        <div className="w-full h-6 bg-zinc-950 rounded-full overflow-hidden border border-white/10 relative shadow-[inset_0_2px_15px_rgba(0,0,0,0.8)] mt-2">
          {/* Center Line Marker */}
          <div className="absolute top-0 bottom-0 left-1/2 w-px bg-white/30 z-20 shadow-[0_0_10px_rgba(255,255,255,0.8)]" />
          
          {/* Midline 25% / 75% markers */}
          <div className="absolute top-0 bottom-0 left-1/4 w-px bg-white/10 z-20" />
          <div className="absolute top-0 bottom-0 right-1/4 w-px bg-white/10 z-20" />
          
          {/* Our Faction Fill (Left) */}
          <div 
            className="absolute top-0 bottom-0 left-0 bg-emerald-500/90 z-10 transition-all duration-1000 shadow-[5px_0_25px_rgba(16,185,129,0.8)] border-r-2 border-emerald-300"
            style={{ width: `${Math.min(100, (warData.ourScore / warData.target) * 100)}%` }}
          >
            <div className="absolute inset-0 bg-linear-to-r from-transparent to-white/20" />
          </div>
          
          {/* Their Faction Fill (Right) */}
          <div 
            className="absolute top-0 bottom-0 right-0 bg-rose-500/90 z-10 transition-all duration-1000 shadow-[-5px_0_25px_rgba(244,63,94,0.8)] border-l-2 border-rose-300"
            style={{ width: `${Math.min(100, (warData.theirScore / warData.target) * 100)}%` }}
          >
            <div className="absolute inset-0 bg-linear-to-l from-transparent to-white/20" />
          </div>
        </div>
      </div>
    </div>
  )
}
