import { createFileRoute } from '@tanstack/react-router'
import { useTctSocket } from '../hooks/useTctSocket'
import { useDashboardStore } from '../hooks/useDashboardStore'
import { MemberGrid } from '../components/MemberGrid'
import { DashboardControls } from '../components/DashboardControls'

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  useTctSocket();
  const isConnected = useDashboardStore((state) => state.isConnected);
  const masterSwitch = useDashboardStore((state) => state.masterSwitch);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-black text-zinc-100 uppercase tracking-tight">Tactical Operations</h1>
          <p className="text-sm text-zinc-500">Real-time faction member deployment and readiness.</p>
        </div>
        <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-zinc-900 border border-white/5">
          <div className={`h-2 w-2 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-rose-500'}`} />
          <span className="text-[10px] font-bold uppercase text-zinc-400">{isConnected ? 'Uplink Stable' : 'Offline'}</span>
        </div>
      </div>
      <DashboardControls />
      
      <div className="relative">
        {masterSwitch === 'OFF' && (
          <div className="absolute inset-0 z-50 flex items-center justify-center backdrop-blur-sm bg-black/60 rounded-3xl border border-white/5 mx-3 md:mx-4 my-6">
            <div className="text-center p-12">
              <div className="w-16 h-16 bg-rose-500/10 rounded-full flex items-center justify-center mx-auto mb-4 border border-rose-500/20">
                <div className="w-3 h-3 bg-rose-500 rounded-full animate-pulse" />
              </div>
              <h2 className="text-2xl font-black text-white uppercase tracking-tighter mb-1">Engine Standby</h2>
              <p className="text-zinc-500 max-w-xs mx-auto text-xs font-medium leading-relaxed">
                Tactical engine is offline. Monitoring and simulations are paused.
              </p>
            </div>
          </div>
        )}
        
        <div className={masterSwitch === 'OFF' ? 'opacity-20 grayscale pointer-events-none transition-all duration-700' : 'transition-all duration-700'}>
          <MemberGrid />
        </div>
      </div>
    </div>
  )
}
