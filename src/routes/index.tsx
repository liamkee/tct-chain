import { useEffect, useState } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTctSocket } from '../hooks/useTctSocket'
import { useDashboardStore } from '../hooks/useDashboardStore'
import { useAuthStore } from '../hooks/useAuthStore'
import { MemberGrid } from '../components/MemberGrid'
import { LoginView } from '../components/LoginView'
import { toast } from 'react-hot-toast'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { isAuthenticated, user, isInitialized, checkAuth } = useAuthStore()

  useEffect(() => {
    checkAuth()
  }, [checkAuth])

  if (!isInitialized) return null;
  if (!isAuthenticated || user?.role === 'unverified') return <LoginView />;

  return <DashboardLayout />;
}

function DashboardLayout() {
  useTctSocket();

  const { logout, user } = useAuthStore();
  const chain = useDashboardStore(state => state.chain);
  const isConnected = useDashboardStore(state => state.isConnected);
  const hpm = useDashboardStore(state => state.hpm);
  const trend = useDashboardStore(state => state.trend);
  const masterSwitch = useDashboardStore(state => state.masterSwitch);
  const lastUpdatedAt = useDashboardStore(state => state.lastUpdatedAt);
  const members = useDashboardStore(state => state.members);
  const serverClockOffset = useDashboardStore(state => state.serverClockOffset);

  const [timer, setTimer] = useState('5:00');
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = setInterval(() => {
      const currentNow = Date.now();
      setNow(currentNow);

      if (chain.current === 0) {
        setTimer('5:00');
      } else {
        const adjustedNow = currentNow + serverClockOffset;
        const s = Math.max(0, (chain.deadline - adjustedNow) / 1000);
        const mins = Math.floor(s / 60);
        const secs = Math.floor(s % 60);
        setTimer(`${mins}:${secs.toString().padStart(2, '0')}`);
      }
    }, 1000);
    return () => clearInterval(interval);
  }, [chain.deadline, chain.current, serverClockOffset]);

  const isCritical = timer !== '5:00' && timer.startsWith('0:');
  const progress = Math.min(100, (chain.current / (chain.max || 10)) * 100);

  return (
    <div className="min-h-screen bg-black text-zinc-100 flex flex-col items-center p-4">
      <div className="w-full max-w-[1600px] bg-zinc-950 rounded-2xl border border-white/5 flex flex-col overflow-hidden relative shadow-2xl min-h-[calc(100vh-2rem)]">

        {/* CSS-only decorative background */}
        {/* Tactical Background Layer (Grid only) */}
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
          <div className="absolute top-10 left-10 w-20 h-20 border-l border-t border-white/10 opacity-20" />
          <div className="absolute bottom-10 right-10 w-20 h-20 border-r border-b border-white/10 opacity-20" />
        </div>

        <div className="relative z-10 flex flex-col flex-1">
          {/* Header */}
          <header className="border-b border-white/5 bg-zinc-900/40 backdrop-blur-md px-6 py-4 flex items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/logo.avif" alt="Logo" className="w-9 h-9 object-cover" />
              <div className="flex flex-col text-left">
                <span className="text-sm font-black uppercase leading-none text-zinc-100">TCT Chain</span>
                <span className="text-[10px] text-indigo-500 font-bold uppercase leading-none mt-1">Intelligence</span>
              </div>
            </div>

            <div className="flex-1 flex justify-center">
              <MasterSwitchControl masterSwitch={masterSwitch} />
            </div>

            <button onClick={logout} className="px-5 py-2 rounded-xl bg-zinc-900 border border-white/10 text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-100 hover:border-zinc-700 transition-all active:scale-95">
              Disconnect
            </button>
          </header>

          {/* Tactical Display: Stats Bar */}
          <div className="px-10 pt-8 grid grid-cols-3 gap-8 items-center">
            {/* Left Wing: Link & Speed */}
            <div className="flex flex-col gap-4">
              <StatCard label="Tool Status" value={isConnected ? 'Active' : 'Broken'} sub={`Last Update: ${lastUpdatedAt > 0 ? `${Math.round((now + serverClockOffset - lastUpdatedAt) / 1000)}s` : 'WAIT'}`} color={isConnected ? 'text-emerald-400' : 'text-rose-500'} />
              <StatCard label="Speed" value={hpm.toFixed(1)} sub={trend === 'UP' ? '↑ Increasing' : trend === 'DOWN' ? '↓ Decreasing' : '— Stable'} color="text-emerald-400" />
            </div>

            {/* Center Core: Progress & Timeout */}
            <div className="bg-zinc-900/40 border border-white/10 rounded-[3rem] p-8 flex flex-col items-center justify-center gap-4 shadow-[0_0_50px_rgba(79,70,229,0.1)] relative overflow-hidden group">
              <div className="absolute inset-0 bg-linear-to-b from-indigo-500/5 to-transparent opacity-50" />

              <div className="relative z-10 flex flex-col items-center">
                <span className="text-[11px] text-zinc-500 font-black uppercase tracking-[0.3em] mb-2">Current Progress</span>
                <span className="text-6xl font-black font-mono tracking-tighter text-white drop-shadow-2xl">
                  {chain.current}<span className="text-zinc-700 mx-2">/</span>{chain.max}
                </span>
                <div className="w-64 h-1.5 bg-zinc-800 rounded-full mt-4 overflow-hidden border border-white/5">
                  <div
                    className="h-full bg-linear-to-r from-indigo-600 to-cyan-400 transition-all duration-1000 shadow-[0_0_15px_rgba(99,102,241,0.5)]"
                    style={{ width: `${progress}%` }}
                  />
                </div>
              </div>

              <div className="h-px w-32 bg-white/5 my-2" />

              <div className="relative z-10 flex flex-col items-center">
                <span className={`text-4xl font-black font-mono tracking-widest ${isCritical ? 'text-rose-500 animate-pulse' : 'text-indigo-400'}`}>
                  {timer}
                </span>
                <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest mt-1">Remaining Window</span>
              </div>
            </div>

            {/* Right Wing: Tactical Hits & Reserves */}
            <div className="flex flex-col gap-4">
              <StatCard 
                label="Available Hits" 
                value={
                  Object.keys(members).length > 0 
                    ? Math.floor(Object.values(members).reduce((acc, m) => acc + (m.last_updated ? (m.energy || 0) : 0), 0) / 25).toString()
                    : 'NO DATA'
                } 
                sub="Current Total Energy / 25" 
                color="text-indigo-400" 
              />
              <StatCard 
                label="Strategic Reserves" 
                value={`+${Object.values(members).filter(m => m.status?.state === 'Okay' && m.last_updated).length * 16}`} 
                sub="Est. Xanax & FHC Potential" 
                color="text-cyan-400" 
              />
            </div>
          </div>

          {/* Member List */}
          <main className="flex-1 p-6">
            <MemberGrid />
          </main>

          <footer className="px-6 py-4 text-center border-t border-white/5 bg-zinc-900/60 mt-auto">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-black opacity-60">
              Torn Chain Tool v1.0 • Authorized Personnel Only
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

function MasterSwitchControl({ masterSwitch }: { masterSwitch: string }) {
  const handleToggle = async () => {
    const action = masterSwitch === 'ON' ? 'stop' : 'start';
    const toastId = toast.loading(`${action === 'start' ? 'Starting' : 'Stopping'} Tactical Engine...`);
    try {
      const res = await fetch(`/api/dashboard/${action}`);
      if (res.ok) toast.dismiss(toastId);
      else toast.error('Tactical Uplink Failed', { id: toastId });
    } catch (e) { toast.error('Network Error', { id: toastId }); }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={handleToggle}
        className={`px-12 py-4 rounded-3xl border transition-all duration-500 flex items-center gap-4 group hover:scale-[1.02] active:scale-95 ${masterSwitch === 'ON'
            ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.15)]'
            : 'bg-rose-500/10 border-rose-500/40 text-rose-400 shadow-[0_0_30px_rgba(244,63,94,0.15)]'
          }`}
      >
        <div className={`w-2.5 h-2.5 rounded-full animate-pulse shadow-[0_0_10px_currentColor] ${masterSwitch === 'ON' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
        <span className="text-sm font-black uppercase tracking-[0.2em] leading-none">Master Switch: {masterSwitch}</span>
      </button>

      {masterSwitch === 'ON' ? (
        <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-[0.2em] opacity-60 whitespace-nowrap">
          If you don't know what this button is, please <span className="text-rose-500/80">DO NOT</span> press it.
        </span>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <span className="text-[10px] text-zinc-500 font-bold tracking-wider uppercase">
            Tactical engine is currently inactive. Click the button above to initialize.
          </span>
          <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest opacity-60">
            If testing outside of chain sessions, remember to deactivate once finished.
          </span>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color }: { label: string, value: string, sub: string, color: string }) {
  return (
    <div className="bg-zinc-900/30 border border-white/5 rounded-2xl p-4 flex flex-col gap-0.5 text-left">
      <span className="text-[9px] text-zinc-500 font-black uppercase tracking-widest leading-none mb-1">{label}</span>
      <span className={`text-xl font-black font-mono tracking-tighter ${color} leading-tight`}>{value}</span>
      <span className="text-[8px] text-zinc-600 font-bold uppercase truncate leading-none">{sub}</span>
    </div>
  );
}
