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

  // 格式化倒计时
  const formatTimeout = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const isCritical = chain.timeout > 0 && chain.timeout < 60;
  const progress = Math.min(100, (chain.current / (chain.target || 1)) * 100);

  return (
    <div className={`min-h-screen bg-black text-zinc-100 selection:bg-indigo-500/30 transition-colors duration-500 ${isCritical ? 'shadow-[inset_0_0_100px_rgba(239,68,68,0.2)]' : ''}`}>
      {/* 🚨 紧急警报：全屏闪红灯 */}
      {isCritical && (
        <div className="fixed inset-0 pointer-events-none z-100 animate-[pulse_1.5s_infinite] border-10 border-rose-500/20" />
      )}

      {/* 顶部作战指挥栏 (War Room Header) */}
      <header className="sticky top-0 z-50 border-b border-white/5 bg-zinc-950/80 backdrop-blur-xl">
        <div className="max-w-[1600px] mx-auto px-4 md:px-6 py-4 flex flex-wrap items-center justify-between gap-6">
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-widest">System Status</span>
              <div className="flex items-center gap-2">
                <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500 animate-pulse' : 'bg-rose-500'}`} />
                <span className="text-sm font-semibold uppercase tracking-tight">
                  {isConnected ? 'Link Active' : 'Link Broken'}
                </span>
              </div>
            </div>
          </div>

          {/* 核心连锁数据 */}
          <div className="flex items-center gap-8 md:gap-12">
            <div className="text-center">
              <span className="block text-[10px] text-zinc-500 font-bold mb-1 uppercase">Chain Progress</span>
              <div className="flex items-baseline gap-1">
                <span className="text-3xl font-black font-mono tracking-tighter text-transparent bg-clip-text bg-linear-to-b from-white to-zinc-500">
                  {chain.current}
                </span>
                <span className="text-zinc-600 text-sm font-bold">/ {chain.target}</span>
              </div>
              {/* 进度条 */}
              <div className="w-full h-1 bg-zinc-800 rounded-full mt-1 overflow-hidden">
                <div 
                  className="h-full bg-indigo-500 transition-all duration-1000" 
                  style={{ width: `${progress}%` }}
                />
              </div>
            </div>

            <div className="text-center">
              <span className="block text-[10px] text-zinc-500 font-bold mb-1 uppercase">Remaining</span>
              <span className={`text-4xl font-black font-mono tracking-tighter transition-colors ${isCritical ? 'text-rose-500 animate-pulse' : 'text-white'}`}>
                {formatTimeout(chain.timeout)}
              </span>
            </div>
          </div>

          <div className="hidden lg:flex flex-col items-end">
            <span className="text-[10px] text-zinc-500 font-bold uppercase mb-1 text-right">Latest Logs</span>
            <div className="h-8 overflow-hidden text-[10px] font-mono text-zinc-400">
              {microLogs.length > 0 ? (
                <div className="animate-in slide-in-from-bottom duration-500">
                  <span className="text-indigo-400">[{new Date(microLogs[0].ts).toLocaleTimeString()}]</span> {microLogs[0].msg}
                </div>
              ) : 'Awaiting data stream...'}
            </div>
          </div>
        </div>
      </header>

      <DashboardControls />

      <main className="max-w-[1600px] mx-auto pt-4 px-2 md:px-0">
        {/* 聚合战力概览 */}
        <div className="px-4 md:px-6 mb-6">
           <div className="rounded-2xl border border-indigo-500/20 bg-indigo-500/5 p-4 flex gap-8 items-center">
              <div className="h-10 w-10 rounded-xl bg-indigo-500/20 flex items-center justify-center">
                 <span className="text-xl">🔥</span>
              </div>
              <div>
                 <h4 className="text-sm font-bold text-zinc-200 uppercase">Tactical Readiness</h4>
                 <p className="text-xs text-zinc-500">Strategic deployment data active. Target: {chain.target}</p>
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
