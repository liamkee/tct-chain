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
  const serverClockOffset = useDashboardStore(state => state.serverClockOffset);

  const [timer, setTimer] = useState('5:00');

  useEffect(() => {
    const interval = setInterval(() => {
      if (chain.current === 0) {
        setTimer('5:00');
      } else {
        const now = Date.now() + serverClockOffset;
        const s = Math.max(0, (chain.deadline - now) / 1000);
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
      <div className="w-full max-w-[1600px] bg-zinc-950 rounded-[2.5rem] border border-white/5 flex flex-col overflow-hidden relative shadow-2xl min-h-[calc(100vh-2rem)]">
        
        {/* CSS-only decorative background */}
        <div className="absolute inset-0 pointer-events-none z-0 opacity-20 bg-[radial-gradient(circle_at_top_left,rgba(79,70,229,0.15),transparent_50%),radial-gradient(circle_at_bottom_right,rgba(6,182,212,0.1),transparent_50%)]" />

        <div className="relative z-10 flex flex-col flex-1">
          {/* Header */}
          <header className="border-b border-white/5 bg-zinc-900/40 backdrop-blur-md px-6 py-4 flex items-center justify-between gap-6">
            <div className="flex items-center gap-3">
              <img src="/logo.avif" alt="Logo" className="w-9 h-9 rounded-xl object-cover border border-white/10" />
              <div className="flex flex-col text-left">
                <span className="text-sm font-black uppercase leading-none text-zinc-100">TCT Chain</span>
                <span className="text-[10px] text-indigo-500 font-bold uppercase leading-none mt-1">Intelligence</span>
              </div>
            </div>

            <div className="flex-1 flex justify-center">
              <MasterSwitchControl masterSwitch={masterSwitch} />
            </div>

            <button onClick={logout} className="px-5 py-2 rounded-2xl bg-zinc-900 border border-white/10 text-[9px] font-black uppercase tracking-widest text-zinc-400 hover:text-zinc-100 transition-all">
              Disconnect
            </button>
          </header>

          {/* Stats Bar */}
          <div className="px-6 pt-6 grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Link" value={isConnected ? 'Active' : 'Broken'} sub={`Update: ${lastUpdatedAt > 0 ? `${Math.round((Date.now() + serverClockOffset - lastUpdatedAt) / 1000)}s` : 'WAIT'}`} color={isConnected ? 'text-emerald-400' : 'text-rose-500'} />
            <StatCard label="Speed" value={hpm.toFixed(1)} sub={trend === 'UP' ? '↑ Increasing' : trend === 'DOWN' ? '↓ Decreasing' : '— Stable'} color="text-emerald-400" />
            <StatCard label="Progress" value={`${chain.current}/${chain.max}`} sub={`${progress.toFixed(1)}%`} color="text-white" />
            <StatCard label="Timeout" value={timer} sub="Remaining" color={isCritical ? 'text-rose-500 animate-pulse' : 'text-white'} />
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
      if (res.ok) toast.success(`Engine ${action === 'start' ? 'Active' : 'Standby'}`, { id: toastId });
      else toast.error('Tactical Uplink Failed', { id: toastId });
    } catch (e) { toast.error('Network Error', { id: toastId }); }
  };

  return (
    <button onClick={handleToggle} className={`px-6 py-2 rounded-2xl border transition-all flex items-center gap-3 ${masterSwitch === 'ON' ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_20px_rgba(16,185,129,0.1)]' : 'bg-rose-500/10 border-rose-500/40 text-rose-400 shadow-[0_0_20px_rgba(244,63,94,0.1)]'}`}>
      <div className={`w-1.5 h-1.5 rounded-full animate-pulse ${masterSwitch === 'ON' ? 'bg-emerald-400' : 'bg-rose-400'}`} />
      <span className="text-[10px] font-black uppercase tracking-widest leading-none">Master Switch</span>
    </button>
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
