import React from 'react'
import { useDashboardStore } from '../hooks/useDashboardStore'

export const DashboardControls: React.FC = () => {
  const { filters, toggleFilter, chain, setTarget } = useDashboardStore();

  const handleStart = async () => {
    await fetch('/api/dashboard/start');
    window.location.reload(); 
  };

  const handleClear = async () => {
    if (confirm('Are you sure to clear all cached data?')) {
      await fetch('/api/dashboard/clear');
      window.location.reload();
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 md:p-4 border-b border-white/5 bg-zinc-950/30 backdrop-blur-md sticky top-0 z-50">
      {/* 引擎控制 */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <button 
          onClick={handleStart}
          className="px-4 py-1.5 rounded-lg bg-emerald-500/20 border border-emerald-500 text-emerald-400 text-xs font-black tracking-widest hover:bg-emerald-500/30 transition-all shadow-[0_0_20px_rgba(16,185,129,0.2)] active:scale-95"
        >
          MASTER SWITCH: ON
        </button>
        <button 
          onClick={async () => { await fetch('/api/dashboard/stop'); window.location.reload(); }}
          className="px-4 py-1.5 rounded-lg bg-zinc-800 border border-zinc-600 text-zinc-400 text-xs font-black tracking-widest hover:bg-zinc-700 transition-all active:scale-95"
        >
          STOP ENGINE
        </button>
        <button 
          onClick={handleClear}
          className="px-4 py-1.5 rounded-lg bg-rose-500/10 border border-rose-500/50 text-rose-400 text-xs font-bold hover:bg-rose-500/20 transition-all active:scale-95"
        >
          WIPE CACHE
        </button>
      </div>

      {/* 战术配置 */}
      <div className="flex items-center gap-6">
        {/* Chain Target */}
        <div className="flex items-center gap-3 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Target</span>
          <input 
            type="number" 
            value={chain.target}
            onChange={(e) => setTarget(parseInt(e.target.value) || 0)}
            className="w-16 bg-transparent text-sm font-black font-mono text-indigo-400 focus:outline-none border-b border-indigo-500/30 focus:border-indigo-500 text-center"
          />
        </div>

        {/* Sync Offset */}
        <div className="flex items-center gap-3 bg-black/40 px-3 py-1.5 rounded-lg border border-white/5">
          <span className="text-[10px] font-bold text-zinc-500 uppercase tracking-widest">Offset (ms)</span>
          <input 
            type="number" 
            placeholder="0"
            step="100"
            onBlur={async (e) => {
              const val = parseInt(e.target.value) || 0;
              await fetch('/api/dashboard/offset', {
                method: 'POST',
                body: JSON.stringify({ offset: val })
              });
            }}
            className="w-20 bg-transparent text-sm font-black font-mono text-amber-400 focus:outline-none border-b border-amber-500/30 focus:border-amber-500 text-center"
          />
        </div>

        <div className="flex items-center gap-2">
          <FilterButton 
            active={filters.hideOffline} 
            onClick={() => toggleFilter('hideOffline')}
            label="HIDE OFFLINE" 
          />
          <FilterButton 
            active={filters.hideHospital} 
            onClick={() => toggleFilter('hideHospital')}
            label="HIDE IN HOSP" 
          />
          <div className="h-4 w-px bg-white/10 mx-2" />
          <FilterButton 
            active={filters.sortByPower} 
            onClick={() => toggleFilter('sortByPower')}
            label="POWER FIRST" 
          />
        </div>
      </div>
    </div>
  )
}

const FilterButton: React.FC<{ active: boolean, onClick: () => void, label: string }> = ({ active, onClick, label }) => (
  <button 
    onClick={onClick}
    className={`px-3 py-1.5 rounded-md text-[10px] font-black tracking-tighter transition-all border ${
      active 
        ? 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.4)]' 
        : 'bg-zinc-800/50 text-zinc-500 border-white/5 hover:border-white/20'
    }`}
  >
    {label}
  </button>
)
