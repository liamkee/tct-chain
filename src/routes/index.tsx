import { useEffect, useState, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTctSocket } from '../hooks/useTctSocket'
import { useDashboardStore } from '../hooks/useDashboardStore'
import { useAuthStore } from '../hooks/useAuthStore'
import { MemberGrid } from '../components/MemberGrid'
import { DashboardControls } from '../components/DashboardControls'
import { LoginView } from '../components/LoginView'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  const { isAuthenticated, user, isInitialized, checkAuth } = useAuthStore()

  useEffect(() => {
    checkAuth()
  }, [])

  if (!isInitialized) {
    return (
      <div className="min-h-screen bg-black flex items-center justify-center">
        <div className="w-12 h-12 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
      </div>
    )
  }

  // If not authenticated or unverified, show LoginView
  if (!isAuthenticated || user?.role === 'unverified') {
    return <LoginView />
  }

  return <DashboardContent />
}

function DashboardContent() {
  // 启动 WebSocket 引擎
  useTctSocket();

  const chain = useDashboardStore((state) => state.chain);
  const isConnected = useDashboardStore((state) => state.isConnected);
  const microLogs = useDashboardStore((state) => state.microLogs);
  const hpm = useDashboardStore((state) => state.hpm);
  const trend = useDashboardStore((state) => state.trend);
  const eta = useDashboardStore((state) => state.eta);
  const tacticalAggregate = useDashboardStore((state) => state.tacticalAggregate);
  const serverClockOffset = useDashboardStore((state) => state.serverClockOffset);
  const masterSwitch = useDashboardStore((state) => state.masterSwitch);
  const lastUpdatedAt = useDashboardStore((state) => state.lastUpdatedAt);
  const [localTimeout, setLocalTimeout] = useState(chain.timeout);
  const requestRef = useRef<number>(0);

  const [tick, setTick] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setTick(t => t + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const animate = () => {
      const now = Date.now() + serverClockOffset;
      const diff = Math.max(0, (chain.deadline - now) / 1000);
      setLocalTimeout(diff);
      requestRef.current = requestAnimationFrame(animate);
    };

    requestRef.current = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(requestRef.current);
  }, [chain.deadline]);

  // 格式化倒计时
  const formatTimeout = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = Math.floor(s % 60);
    const ms = Math.floor((s % 1) * 100);
    return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const formatETA = (minutes: number) => {
    if (minutes < 0) return '∞';
    if (minutes < 1) return '< 1m';
    const h = Math.floor(minutes / 60);
    const m = Math.floor(minutes % 60);
    return h > 0 ? `${h}h ${m}m` : `${m}m`;
  };

  const isCritical = localTimeout > 0 && localTimeout < 60;
  const isBroken = localTimeout <= 0 && chain.current > 0;
  const progress = Math.min(100, (chain.current / (chain.target || 1)) * 100);

  return (
    <div className={`min-h-screen bg-black text-zinc-100 selection:bg-indigo-500/30 transition-colors duration-500 ${isCritical ? 'shadow-[inset_0_0_100px_rgba(239,68,68,0.2)]' : ''} ${isBroken ? 'shadow-[inset_0_0_100px_rgba(239,68,68,0.5)]' : ''}`}>
      {/* 🚨 紧急警报：全屏闪红灯 */}
      {(isCritical || isBroken) && (
        <div className={`fixed inset-0 pointer-events-none z-100 animate-[pulse_1s_infinite] border-10 ${isBroken ? 'border-rose-600' : 'border-rose-500/20'}`} />
      )}

      {/* 顶部作战指挥栏 (War Room Header) */}
      <header className="border-b border-white/5 bg-zinc-950/80">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-4 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Link</span>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span className="text-sm font-semibold uppercase tracking-tight">
                  {isConnected ? 'Active' : 'Broken'}
                </span>
                <span className="text-[10px] text-zinc-600 font-mono ml-2 border-l border-white/10 pl-2">
                  SCAN: {lastUpdatedAt > 0 ? `${Math.round((Date.now() + serverClockOffset - lastUpdatedAt) / 1000)}s` : 'WAIT'}
                </span>
              </div>
            </div>

            <div className="h-8 w-px bg-white/10 hidden md:block" />

            {/* HPM Display */}
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Speed (HPM)</span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-mono font-black text-emerald-400">{hpm.toFixed(1)}</span>
                <span className={`text-xs font-bold ${trend === 'UP' ? 'text-emerald-500' : trend === 'DOWN' ? 'text-rose-500' : 'text-zinc-500'
                  }`}>
                  {trend === 'UP' ? '↑' : trend === 'DOWN' ? '↓' : '→'}
                </span>
              </div>
            </div>

            {/* ETA Display */}
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Est. Finish</span>
              <span className="text-lg font-mono font-black text-sky-400">{formatETA(eta)}</span>
            </div>
          </div>

          {/* 核心连锁数据 */}
          <div className="flex items-center gap-8 md:gap-12">
            <div className="text-center min-w-[120px]">
              <span className="block text-[10px] text-zinc-500 font-bold mb-1 uppercase tracking-wider">Progress</span>
              <div className="flex items-baseline justify-center gap-1">
                <span className="text-3xl font-black font-mono tracking-tighter text-transparent bg-clip-text bg-linear-to-b from-white to-zinc-500">
                  {chain.current}
                </span>
                <span className="text-zinc-600 text-sm font-bold">/ {chain.target}</span>
              </div>
              <div className="w-full h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                <div
                  className="h-full bg-indigo-500 transition-all duration-1000"
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="text-center">
              <span className="block text-[10px] text-zinc-500 font-bold mb-1 uppercase tracking-wider">Remaining</span>
              <span className={`text-4xl font-black font-mono tracking-tighter transition-colors ${isCritical || isBroken ? 'text-rose-500 animate-pulse' : 'text-white'}`}>
                {formatTimeout(localTimeout)}
              </span>
            </div>
          </div>

          <div className="hidden xl:flex flex-col items-end">
            <span className="text-[10px] text-zinc-500 font-bold uppercase mb-1 text-right">Ops Stream</span>
            <div className="h-12 overflow-hidden text-[10px] font-mono text-zinc-400 text-right flex flex-col justify-end">
              {microLogs.length > 0 ? (
                microLogs.slice(-3).map((log, i) => (
                  <div key={log.ts + i} className="animate-in slide-in-from-bottom-1 duration-300">
                    <span className="text-indigo-400/80">[{new Date(log.ts).toLocaleTimeString([], { hour12: false })}]</span> {log.msg}
                  </div>
                ))
              ) : (
                <div className="text-zinc-600 italic">Link standby...</div>
              )}
            </div>
          </div>
        </div>
      </header>

      <DashboardControls />

      <main className="max-w-[1600px] mx-auto pt-4 px-2 md:px-0 relative">
        {/* Engine Standby Overlay (Only show if definitely OFF and connected) */}
        {isConnected && masterSwitch === 'OFF' && (
          <div className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/60 rounded-3xl border border-white/5 mx-3 md:mx-4 my-6">
            <div className="text-center p-12">
              <div className="w-20 h-20 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-6 border border-rose-500/20">
                <div className="w-4 h-4 bg-rose-500 rounded-full animate-pulse shadow-[0_0_15px_rgba(244,63,94,0.6)]" />
              </div>
              <h2 className="text-3xl font-black text-white uppercase tracking-tighter mb-2">Tactical Engine Standby</h2>
              <p className="text-zinc-400 max-w-md mx-auto text-sm font-medium">
                The polling engine is currently offline. Turn on the Master Switch to resume real-time tactical monitoring.
              </p>
            </div>
          </div>
        )}

        {/* Connecting State */}
        {!isConnected && (
          <div className="absolute inset-0 z-60 flex items-center justify-center bg-black/40 backdrop-blur-sm mx-3 md:mx-4 my-6 rounded-3xl">
             <div className="flex flex-col items-center gap-4">
                <div className="w-12 h-12 border-4 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin" />
                <span className="text-indigo-400 text-[10px] font-black uppercase tracking-[0.3em] animate-pulse">Establishing Uplink...</span>
             </div>
          </div>
        )}
        
        <div className={masterSwitch === 'OFF' ? 'opacity-20 grayscale pointer-events-none transition-all duration-700' : 'transition-all duration-700'}>
          <div className="px-3 md:px-4 mb-6">
            <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 flex flex-wrap gap-8 items-center justify-between">
              <div className="flex gap-6 items-center">
                <div>
                  <h4 className="text-sm font-bold text-zinc-200 uppercase tracking-widest">Tactical Projection</h4>
                  <p className="text-xs text-zinc-500 mt-0.5">Real-time resource simulation</p>
                </div>
              </div>

              <div className="flex gap-12">
                <div className="text-center">
                  <span className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Instant Capacity</span>
                  <span className="text-xl font-mono font-black text-emerald-400">{tacticalAggregate?.totalAvailableHits || 0}</span>
                  <span className="text-[10px] text-zinc-600 font-bold ml-1">HITS</span>
                </div>
                <div className="text-center">
                  <span className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">1h Predicted Output</span>
                  <span className="text-xl font-mono font-black text-indigo-400">{tacticalAggregate?.totalProjectedHits1h || 0}</span>
                  <span className="text-[10px] text-zinc-600 font-bold ml-1">HITS</span>
                </div>
                <div className="text-center">
                  <span className="block text-[10px] text-zinc-500 font-bold uppercase mb-1">Theoretical Max</span>
                  <span className="text-xl font-mono font-black text-zinc-300">{tacticalAggregate?.totalMaxPotentialHits || 0}</span>
                  <span className="text-[10px] text-zinc-600 font-bold ml-1">HITS</span>
                </div>

                <div className="h-10 w-px bg-white/5 mx-2 hidden lg:block" />

                <div className="text-center relative">
                  <span className="block text-[10px] text-indigo-500 font-bold uppercase mb-1">Target Gap</span>
                  <div className="flex items-center gap-2">
                    <span className={`text-xl font-mono font-black ${(chain.target - chain.current) <= (tacticalAggregate?.totalAvailableHits || 0) ? 'text-emerald-400' :
                      (chain.target - chain.current) <= (tacticalAggregate?.totalProjectedHits1h || 0) ? 'text-sky-400' :
                        (chain.target - chain.current) <= (tacticalAggregate?.totalMaxPotentialHits || 0) ? 'text-amber-400' : 'text-rose-500'
                      }`}>
                      {Math.max(0, chain.target - chain.current)}
                    </span>
                    <div className="flex flex-col items-start leading-none">
                      <span className="text-[8px] text-zinc-600 font-bold">REMAINING</span>
                      <span className={`text-[9px] font-black uppercase ${(chain.target - chain.current) <= (tacticalAggregate?.totalAvailableHits || 0) ? 'text-emerald-500' :
                        (chain.target - chain.current) <= (tacticalAggregate?.totalProjectedHits1h || 0) ? 'text-sky-500' :
                          (chain.target - chain.current) <= (tacticalAggregate?.totalMaxPotentialHits || 0) ? 'text-amber-500' : 'text-rose-600'
                        }`}>
                        {(chain.target - chain.current) <= (tacticalAggregate?.totalAvailableHits || 0) ? 'Overkill' :
                          (chain.target - chain.current) <= (tacticalAggregate?.totalProjectedHits1h || 0) ? 'Secured' :
                            (chain.target - chain.current) <= (tacticalAggregate?.totalMaxPotentialHits || 0) ? 'Possible' : 'Shortfall'}
                      </span>
                    </div>
                  </div>
                </div>

                <div className="h-10 w-px bg-white/5 mx-2 hidden lg:block" />

                <div className="text-center">
                  <span className="block text-[10px] text-rose-500/80 font-bold uppercase mb-1">Buffer Safety</span>
                  <span className={`text-xl font-mono font-black ${localTimeout < 60 ? 'text-rose-500' : 'text-zinc-100'}`}>
                    {Math.floor(hpm * (localTimeout / 60))}
                  </span>
                  <span className="text-[10px] text-zinc-600 font-bold ml-1">HITS</span>
                </div>
              </div>
            </div>
          </div>

          <MemberGrid />
        </div>
      </main>

      <div className="fixed inset-0 pointer-events-none z-[-1] opacity-50">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-cyan-500/5 blur-[120px]" />
      </div>
    </div>
  )
}
