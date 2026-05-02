import { createFileRoute } from '@tanstack/react-router'
import { useTctSocket } from '../hooks/useTctSocket'
import { useDashboardStore } from '../hooks/useDashboardStore'
import { MemberGrid } from '../components/MemberGrid'

export const Route = createFileRoute('/dashboard')({
  component: Dashboard,
})

function Dashboard() {
  useTctSocket();
  const isConnected = useDashboardStore((state) => state.isConnected);

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
      
      <MemberGrid />
    </div>
  )
}
