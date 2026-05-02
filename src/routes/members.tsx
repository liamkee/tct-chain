import { createFileRoute } from '@tanstack/react-router'

export const Route = createFileRoute('/members')({
  component: Members,
})

function Members() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-zinc-100 uppercase tracking-tight">Personnel Directory</h1>
        <p className="text-sm text-zinc-500">Member profiles, stats, and historical performance.</p>
      </div>
      
      <div className="glass-panel p-12 flex flex-col items-center justify-center text-center border-dashed border-2 border-white/5 rounded-3xl">
        <div className="w-16 h-16 bg-zinc-900 rounded-2xl flex items-center justify-center mb-4 text-2xl">
          👥
        </div>
        <h3 className="text-lg font-bold text-zinc-200">Personnel Database Under Construction</h3>
        <p className="max-w-md text-zinc-500 text-sm mt-2">
          We are currently synchronizing detailed member history and individual tactical stats. Full personnel management will be available in Phase 3.
        </p>
      </div>
    </div>
  )
}
