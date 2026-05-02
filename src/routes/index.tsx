import { useEffect, useState, useRef } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { useTctSocket } from '../hooks/useTctSocket'
import { useDashboardStore } from '../hooks/useDashboardStore'
import { MemberGrid } from '../components/MemberGrid'
import { DashboardControls } from '../components/DashboardControls'

export const Route = createFileRoute('/')({
  component: Index,
})

function Index() {
  // 启动 WebSocket 引擎
  useTctSocket();
  
  const chain = useDashboardStore((state) => state.chain);
  const isConnected = useDashboardStore((state) => state.isConnected);
  const microLogs = useDashboardStore((state) => state.microLogs);
  const hpm = useDashboardStore((state) => state.hpm);
  const trend = useDashboardStore((state) => state.trend);
  const eta = useDashboardStore((state) => state.eta);
  const tacticalAggregate = useDashboardStore((state) => state.tacticalAggregate);

  // 🚀 本地平滑倒计时状态
  const [localTimeout, setLocalTimeout] = useState(chain.timeout);
  const requestRef = useRef<number>(0);

  useEffect(() => {
    const animate = () => {
      const now = Date.now();
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
    const ms = Math.floor((s % 1) * 100); // 增加毫秒显示增强紧迫感
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
  const isBroken = localTimeout <= 0 && chain.current > 0; // 这里的逻辑可以根据实际情况微调
  const progress = Math.min(100, (chain.current / (chain.target || 1)) * 100);

  return (
    <div className={`min-h-screen bg-black text-zinc-100 selection:bg-indigo-500/30 transition-colors duration-500 ${isCritical ? 'shadow-[inset_0_0_100px_rgba(239,68,68,0.2)]' : ''} ${isBroken ? 'shadow-[inset_0_0_100px_rgba(239,68,68,0.5)]' : ''}`}>
      {/* 🚨 紧急警报：全屏闪红灯 */}
      {(isCritical || isBroken) && (
        <div className={`fixed inset-0 pointer-events-none z-100 animate-[pulse_1s_infinite] border-10 ${isBroken ? 'border-rose-600' : 'border-rose-500/20'}`} />
      )}

      {/* 顶部作战指挥栏 (War Room Header) */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-4 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-6">
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Link</span>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span className="text-sm font-semibold uppercase tracking-tight">
                  {isConnected ? 'Active' : 'Broken'}
                </span>
              </div>
            </div>

            <div className="h-8 w-px bg-white/10 hidden md:block" />

            {/* HPM Display */}
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">Speed (HPM)</span>
              <div className="flex items-center gap-2">
                <span className="text-lg font-mono font-black text-emerald-400">{hpm.toFixed(1)}</span>
                <span className={`text-xs font-bold ${
                  trend === 'UP' ? 'text-emerald-500' : trend === 'DOWN' ? 'text-rose-500' : 'text-zinc-500'
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
            <div className="h-8 overflow-hidden text-[10px] font-mono text-zinc-400 text-right">
              {microLogs.length > 0 ? (
                <div className="animate-in slide-in-from-bottom duration-500">
                  <span className="text-indigo-400">[{new Date(microLogs[0].ts).toLocaleTimeString()}]</span> {microLogs[0].msg}
                </div>
              ) : 'Link standby...'}
            </div>
          </div>
        </div>
      </header>

      <DashboardControls />

      <main className="max-w-[1600px] mx-auto pt-4 px-2 md:px-0">
        {/* 聚合战力推演概览 (Phase 3 Deployment) */}
        <div className="px-4 md:px-6 mb-6">
           <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-5 flex flex-wrap gap-8 items-center justify-between">
              <div className="flex gap-6 items-center">
                <div className="h-12 w-12 rounded-xl bg-indigo-500/10 flex items-center justify-center text-2xl border border-indigo-500/20">
                   🔥
                </div>
                <div>
                   <h4 className="text-sm font-bold text-zinc-200 uppercase tracking-widest">Tactical Projection</h4>
                   <p className="text-xs text-zinc-500 mt-0.5">Real-time resource simulation for Phase 3 deployment</p>
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

        {/* 成员矩阵 */}
        <MemberGrid />
      </main>

      {/* 全局动效背景 */}
      <div className="fixed inset-0 pointer-events-none z-[-1] opacity-50">
        <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-indigo-500/10 blur-[120px]" />
        <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] rounded-full bg-cyan-500/5 blur-[120px]" />
      </div>
    </div>
  )
}
