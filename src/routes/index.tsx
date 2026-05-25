import { useEffect, useState, useMemo } from 'react'
import { createFileRoute, Link } from '@tanstack/react-router'
import { TacticalCalculator } from '../services/calculator'
import { useTctSocket } from '../hooks/useTctSocket'
import { useDashboardStore } from '../hooks/useDashboardStore'
import { useAuthStore } from '../hooks/useAuthStore'
import { MemberListView } from '../components/MemberListView'
import { LoginView } from '../components/LoginView'
import { UpdateApiKeyModal } from '../components/UpdateApiKeyModal'
import { WarRoom } from '../components/WarRoom'
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
  const eta = useDashboardStore(state => state.eta);
  const masterSwitch = useDashboardStore(state => state.masterSwitch);
  const lastUpdatedAt = useDashboardStore(state => state.lastUpdatedAt);
  const members = useDashboardStore(state => state.members);
  const microLogs = useDashboardStore(state => state.microLogs);
  const serverClockOffset = useDashboardStore(state => state.serverClockOffset);
  const { filters, toggleCalcSetting } = useDashboardStore();
  const globalSelectedMembers = useDashboardStore(state => state.globalSelectedMembers);
  const { sendCommand } = useTctSocket();

  const tacticalAggregate = useMemo(() => {
    return TacticalCalculator.aggregate(members, globalSelectedMembers, filters);
  }, [members, globalSelectedMembers, filters]);


  const [timer, setTimer] = useState('5:00');
  const [now, setNow] = useState(Date.now());
  const [resetTimer, setResetTimer] = useState('00:00:00');

  useEffect(() => {
    const interval = setInterval(() => {
      const currentNow = Date.now();
      setNow(currentNow);

      // Torn Reset Countdown (UTC 00:00)
      const nowUtc = new Date(currentNow);
      const nextReset = new Date(Date.UTC(nowUtc.getUTCFullYear(), nowUtc.getUTCMonth(), nowUtc.getUTCDate() + 1));
      const diff = nextReset.getTime() - nowUtc.getTime();
      const h = Math.floor(diff / 3600000).toString().padStart(2, '0');
      const m = Math.floor((diff % 3600000) / 60000).toString().padStart(2, '0');
      const s = Math.floor((diff % 60000) / 1000).toString().padStart(2, '0');
      setResetTimer(`${h}:${m}:${s}`);

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
        {/* Tactical Background Layer */}
        <div className="absolute inset-0 pointer-events-none z-0 overflow-hidden">
          <div className="absolute inset-0 opacity-[0.03]" style={{ backgroundImage: 'radial-gradient(circle, white 1px, transparent 1px)', backgroundSize: '32px 32px' }} />
          <div className="absolute top-10 left-10 w-20 h-20 border-l border-t border-white/10 opacity-20" />
          <div className="absolute bottom-10 right-10 w-20 h-20 border-r border-b border-white/10 opacity-20" />
        </div>

        <div className="relative z-10 flex flex-col flex-1">
          {/* Header */}
          <header className="border-b border-white/5 bg-zinc-900/40 backdrop-blur-md px-4 md:px-6 py-4 flex flex-col md:flex-row items-center justify-between gap-4 md:gap-6">
            <div className="flex-1 flex items-center gap-3 w-full justify-between md:justify-start">
              <div className="flex items-center gap-3">
                <img src="/logo.avif" alt="Logo" className="w-9 h-9 object-cover" />
                <div className="flex flex-col text-left">
                  <span className="text-sm font-black uppercase leading-none text-zinc-100">TCT Chain</span>
                  <span className="text-[10px] text-indigo-500 font-bold uppercase leading-none mt-1">Intelligence</span>
                </div>
              </div>
              {/* Mobile disconnect button can go here or keep it below */}
              <button onClick={logout} className="md:hidden px-4 py-1.5 rounded-xl bg-zinc-900 border border-white/10 text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-100 hover:border-zinc-700 transition-all active:scale-95">
                Logout
              </button>
            </div>

            <div className="flex-none flex justify-center items-center gap-4 w-full md:w-auto">
              <MasterSwitchControl masterSwitch={masterSwitch} />
            </div>

            <div className="flex-1 hidden md:flex items-center justify-end gap-3">
              <Link to="/profile" className="px-5 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-black uppercase tracking-widest text-indigo-400 hover:text-indigo-300 hover:border-indigo-500/50 transition-all active:scale-95">
                Personal Profile
              </Link>
              <UpdateApiKeyModal />
              <button onClick={logout} className="px-5 py-2 rounded-xl bg-zinc-900 border border-white/10 text-[9px] font-black uppercase tracking-widest text-zinc-500 hover:text-zinc-100 hover:border-zinc-700 transition-all active:scale-95">
                Disconnect
              </button>
            </div>
            
            {/* Mobile API Key Update */}
            <div className="md:hidden w-full flex justify-center">
              <UpdateApiKeyModal />
            </div>
          </header>

          {/* Tactical Display: Stats Bar */}
          <div className="px-4 md:px-10 pt-6 md:pt-8 grid grid-cols-1 md:grid-cols-3 gap-4 md:gap-8 items-stretch">
            {/* Left Wing: Link & Speed */}
            <div className="hidden md:flex flex-col gap-4 h-full">
              <StatCard
                label="Tool Status"
                value={
                  <div className="flex flex-col md:flex-row items-start md:items-center gap-4 md:gap-6 w-full">
                    <div className="flex flex-col">
                      <span className="text-3xl font-black tracking-tighter">{isConnected ? 'Active' : 'Broken'}</span>
                      <div className="flex items-center gap-3 mt-1.5">
                        <span className="text-[10px] text-zinc-600 font-bold uppercase tracking-widest">
                          {lastUpdatedAt > 0 ? `${Math.round((now + serverClockOffset - lastUpdatedAt) / 1000)}s ago` : 'WAIT'}
                        </span>
                        <button
                          onClick={() => {
                            sendCommand('REQ_SYNC', {});
                            toast.success('Sync Request Dispatched');
                          }}
                          className="p-1.5 rounded-lg bg-zinc-900 border border-white/5 text-zinc-500 hover:text-indigo-400 hover:border-indigo-500/30 transition-all active:scale-90"
                          title="Force API Sync"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                          </svg>
                        </button>
                      </div>
                    </div>

                    <div className="flex-1 border-t md:border-t-0 md:border-l border-white/5 pt-3 md:pt-0 pl-0 md:pl-4 flex flex-col gap-1.5 h-[50px] overflow-hidden w-full md:w-auto">
                      {microLogs && microLogs.slice(-3).reverse().map((log, i) => (
                        <div key={i} className="flex items-center gap-2 opacity-80 animate-in fade-in slide-in-from-right-2 duration-300">
                          <div className={`w-1 h-1 rounded-full shrink-0 ${i === 0 ? 'bg-indigo-500 animate-pulse' : 'bg-zinc-700'}`} />
                          <span className="text-[9px] text-zinc-500 font-mono truncate leading-none">
                            <span className="text-zinc-700 mr-1.5">[{new Date((log as any).ts || Date.now()).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}]</span>
                            {typeof log === 'string' ? log : (log as any).msg}
                          </span>
                        </div>
                      ))}
                      {(!microLogs || microLogs.length === 0) && (
                        <span className="text-[9px] text-zinc-700 font-mono italic">Awaiting tactical data...</span>
                      )}
                    </div>
                  </div>
                }
                sub="System Monitoring & Live Activity"
                color={isConnected ? 'text-emerald-400' : 'text-rose-500'}
              />
              <StatCard
                label="Speed & ETA"
                value={<span className="text-3xl font-black tracking-tighter">{hpm.toFixed(1)}<span className="text-sm font-bold text-zinc-500 ml-2">/ min</span></span>}
                sub={trend === 'UP' ? '↑ Increasing' : trend === 'DOWN' ? '↓ Decreasing' : '— Stable'}
                color="text-emerald-400"
                extra={
                  <div className="flex items-center gap-2 mt-1">
                    <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">ETA to {chain.max}</span>
                    <span className="text-xs font-mono font-bold text-indigo-400 bg-indigo-500/10 px-2 py-0.5 rounded-md border border-indigo-500/20">
                      {eta > 0 ? (
                        eta < 1 ? '< 1m' : `${Math.floor(eta / 60) > 0 ? `${Math.floor(eta / 60)}h ` : ''}${Math.floor(eta % 60)}m`
                      ) : '—'}
                    </span>
                  </div>
                }
              />
            </div>

            {/* Center Core: Progress & Timeout */}
            <div className="bg-zinc-900/40 border border-white/10 rounded-2xl p-6 md:p-8 flex flex-col items-center justify-center gap-4 shadow-[0_0_50px_rgba(79,70,229,0.1)] relative overflow-hidden group h-full">
              <div className="absolute inset-0 bg-linear-to-b from-indigo-500/5 to-transparent opacity-50" />

              <div className="relative z-10 flex flex-col items-center">
                <span className="text-[11px] text-zinc-500 font-black uppercase tracking-[0.3em] mb-2">Current Progress</span>
                <span className="text-6xl font-black font-mono tracking-tighter text-white drop-shadow-2xl">
                  {chain.current}<span className="text-zinc-700 mx-2">/</span>{chain.max}
                </span>
                <div className="w-full max-w-[16rem] h-1.5 bg-zinc-800 rounded-full mt-4 overflow-hidden border border-white/5">
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
            <div className="flex flex-col gap-4 h-full">
              <StatCard
                label="Available Hits"
                value={
                  <span className="text-3xl font-black tracking-tighter">
                    {Object.keys(members).length > 0
                      ? Math.floor(Object.values(members)
                        .filter(m => {
                          if (filters.hideOffline && m.last_action?.status === 'Offline') return false;
                          if (filters.hideHospital && m.status?.state === 'Hospital') return false;
                          if (filters.hideTraveling && m.status?.state === 'Traveling') return false;
                          return true;
                        })
                        .reduce((acc, m) => acc + (m.last_updated ? (m.energy || 0) : 0), 0) / 25).toString()
                      : 'NO DATA'}
                  </span>
                }
                sub="Visible Total Energy / 25"
                color="text-indigo-400"
              />
              <StatCard
                label="Strategic Reserves"
                value={
                  <div className="flex flex-col gap-2">
                    <span className="text-3xl font-black tracking-tighter">
                      {tacticalAggregate ? `+${tacticalAggregate.totalReserveHits}` : 'NO DATA'}
                    </span>
                    <div className="flex gap-1.5 p-1 bg-zinc-800/40 rounded-xl border border-white/10 self-start">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCalcSetting('excludeXanax');
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[9px] font-black border transition-all ${!filters.excludeXanax ? 'bg-orange-500/20 border-orange-500/30 text-orange-400' : 'bg-zinc-900/50 border-transparent text-zinc-600'}`}
                      >
                        XAN
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCalcSetting('excludeFHC');
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[9px] font-black border transition-all ${!filters.excludeFHC ? 'bg-blue-500/20 border-blue-500/30 text-blue-400' : 'bg-zinc-900/50 border-transparent text-zinc-600'}`}
                      >
                        FHC
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleCalcSetting('excludeRefill');
                        }}
                        className={`px-2 py-0.5 rounded-lg text-[9px] font-black border transition-all ${!filters.excludeRefill ? 'bg-emerald-500/20 border-emerald-500/30 text-emerald-400' : 'bg-zinc-900/50 border-transparent text-zinc-600'}`}
                      >
                        REF
                      </button>
                    </div>
                  </div>
                }
                sub="Strategic Potential Resources"
                color="text-cyan-400"
              />
            </div>
          </div>

          {/* War Room Section */}
          <div className="px-4 md:px-10 mt-4">
            <WarRoom />
          </div>

          {/* Member List Section */}
          <main className="flex-1 p-2 md:p-6">
            <MemberListView resetTimer={resetTimer} />
          </main>

          <footer className="px-6 py-4 text-center border-t border-white/5 bg-zinc-900/60 mt-auto">
            <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-black opacity-60">
              Torn Chain Tool v1.1 • Authorized Personnel Only
            </p>
          </footer>
        </div>
      </div>
    </div>
  );
}

function MasterSwitchControl({ masterSwitch }: { masterSwitch: string }) {
  const [isConfirming, setIsConfirming] = useState(false);

  const executeToggle = async () => {
    setIsConfirming(false);
    const action = masterSwitch === 'ON' ? 'stop' : 'start';
    const toastId = toast.loading(`${action === 'start' ? 'Starting' : 'Stopping'} Tactical Engine...`);
    try {
      const res = await fetch(`/api/dashboard/${action}`);
      if (res.ok) toast.dismiss(toastId);
      else toast.error('Tactical Uplink Failed', { id: toastId });
    } catch (e) { toast.error('Network Error', { id: toastId }); }
  };

  const handleToggle = () => {
    if (isConfirming) {
      executeToggle();
    } else {
      setIsConfirming(true);
      // Automatically cancel confirmation after 3 seconds
      setTimeout(() => setIsConfirming(false), 3000);
    }
  };

  return (
    <div className="flex flex-col items-center gap-3">
      <button
        onClick={handleToggle}
        className={`px-6 md:px-12 py-3 md:py-4 rounded-3xl border transition-all duration-300 flex items-center justify-center gap-3 md:gap-4 group hover:scale-[1.02] active:scale-95 w-full md:w-auto ${
          isConfirming
            ? 'bg-amber-500/20 border-amber-500/50 text-amber-400 shadow-[0_0_30px_rgba(245,158,11,0.2)]'
            : masterSwitch === 'ON'
              ? 'bg-emerald-500/10 border-emerald-500/40 text-emerald-400 shadow-[0_0_30px_rgba(16,185,129,0.15)]'
              : 'bg-rose-500/10 border-rose-500/40 text-rose-400 shadow-[0_0_30px_rgba(244,63,94,0.15)]'
        }`}
      >
        <div className={`w-2.5 h-2.5 rounded-full shadow-[0_0_10px_currentColor] ${isConfirming ? 'bg-amber-400 animate-pulse' : masterSwitch === 'ON' ? 'bg-emerald-400 animate-pulse' : 'bg-rose-400 animate-pulse'}`} />
        <span className="text-sm font-black uppercase tracking-[0.2em] leading-none">
          {isConfirming ? 'CONFIRM TOGGLE?' : `Master Switch: ${masterSwitch}`}
        </span>
      </button>

      {masterSwitch === 'ON' ? (
        <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-[0.2em] opacity-60 text-center whitespace-normal md:whitespace-nowrap max-w-[250px] md:max-w-none">
          If you don't know what this button is, please <span className="text-rose-500/80">DO NOT</span> press it.
        </span>
      ) : (
        <div className="flex flex-col items-center gap-1">
          <span className="text-[10px] text-zinc-500 font-bold tracking-wider uppercase text-center">
            Tactical engine is currently inactive. Click the button above to initialize.
          </span>
          <span className="text-[9px] text-zinc-600 font-bold uppercase tracking-widest opacity-60 text-center">
            If testing outside of chain sessions, remember to deactivate once finished.
          </span>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value, sub, color, extra }: { label: string, value: React.ReactNode, sub: string, color: string, extra?: React.ReactNode }) {
  return (
    <div className="bg-zinc-900/40 border border-white/10 rounded-2xl p-4 flex flex-col text-left min-h-[120px] relative overflow-hidden group transition-all hover:border-white/20 flex-1">
      <span className="text-[9px] text-zinc-500 font-black uppercase tracking-widest leading-none mb-3">{label}</span>
      <div className={`font-mono tracking-tighter ${color} leading-none flex-1`}>
        {value}
      </div>
      {extra && <div className="mt-2">{extra}</div>}
      <span className="text-[8px] text-zinc-500 font-bold uppercase truncate leading-none mt-auto pt-3 border-t border-white/5">{sub}</span>
    </div>
  );
}
