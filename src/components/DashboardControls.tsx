import React from 'react'
import { useDashboardStore } from '../hooks/useDashboardStore'
import { toast } from 'react-hot-toast'

export const DashboardControls: React.FC = () => {
  const { filters, toggleFilter, chain, setTarget, viewMode, setViewMode, masterSwitch } = useDashboardStore();

  const handleToggle = async () => {
    const action = masterSwitch === 'ON' ? 'stop' : 'start';
    const toastId = toast.loading(`${action === 'start' ? 'Starting' : 'Stopping'} Tactical Engine...`);

    try {
      const res = await fetch(`/api/dashboard/${action}`);
      if (res.ok) {
        toast.success(`Engine ${action === 'start' ? 'Active' : 'Standby'}`, { id: toastId });
        // Use a slight delay before reload to let the user see the success message
        setTimeout(() => window.location.reload(), 500);
      } else {
        toast.error('Tactical Uplink Failed', { id: toastId });
      }
    } catch (e) {
      toast.error('Network Error', { id: toastId });
    }
  };

  const handleClear = async () => {
    if (confirm('WIPE ALL CACHED DATA? This clears personnel snapshots and logs.')) {
      const toastId = toast.loading('Wiping Cache...');
      await fetch('/api/dashboard/clear');
      toast.success('Cache Purged', { id: toastId });
      setTimeout(() => window.location.reload(), 500);
    }
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3 md:p-4 bg-zinc-950/30">
      {/* 引擎控制 */}
      <div className="flex flex-wrap items-center gap-2 md:gap-3">
        <button
          onClick={handleToggle}
          className={`group relative px-6 py-2 rounded-xl border transition-all active:scale-95 flex items-center gap-3 overflow-hidden ${masterSwitch === 'ON'
            ? 'bg-emerald-500/10 border-emerald-500/50 text-emerald-400 hover:bg-emerald-500/20 shadow-[0_0_20px_rgba(16,185,129,0.15)]'
            : 'bg-rose-500/10 border-rose-500/50 text-rose-400 hover:bg-rose-500/20 shadow-[0_0_20px_rgba(244,63,94,0.15)]'
            }`}
        >
          <div className={`w-2 h-2 rounded-full animate-pulse ${masterSwitch === 'ON' ? 'bg-emerald-400 shadow-[0_0_8px_rgba(52,211,153,0.8)]' : 'bg-rose-400 shadow-[0_0_8px_rgba(251,113,133,0.8)]'}`} />
          <span className="text-xs font-black tracking-widest uppercase">
            Master Switch: {masterSwitch}
          </span>
          {/* Subtle background glow */}
          <div className={`absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity blur-xl ${masterSwitch === 'ON' ? 'bg-emerald-500/10' : 'bg-rose-500/10'}`} />
        </button>

        <button
          onClick={handleClear}
          className="px-4 py-2 rounded-xl bg-zinc-900/50 border border-white/5 text-zinc-500 text-[10px] font-bold hover:bg-zinc-800 hover:text-zinc-300 transition-all active:scale-95 uppercase tracking-tighter"
        >
          Purge Cache
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
            onChange={(e) => setTarget(Math.max(0, parseInt(e.target.value) || 0))}
            min="0"
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
              const val = Math.max(0, parseInt(e.target.value) || 0);
              await fetch('/api/dashboard/offset', {
                method: 'POST',
                body: JSON.stringify({ offset: val })
              });
            }}
            className="w-20 bg-transparent text-sm font-black font-mono text-amber-400 focus:outline-none border-b border-amber-500/30 focus:border-amber-500 text-center"
          />
        </div>

      </div>
    </div>
  )
}
