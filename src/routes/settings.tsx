import { createFileRoute } from '@tanstack/react-router'
import { DashboardControls } from '../components/DashboardControls'

export const Route = createFileRoute('/settings')({
  component: Settings,
})

function Settings() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-black text-zinc-100 uppercase tracking-tight">System Configuration</h1>
        <p className="text-sm text-zinc-500">Manage tactical engine parameters and security settings.</p>
      </div>

      <section className="space-y-4">
        <h2 className="text-xs font-black text-amber-500 uppercase tracking-[0.2em]">Engine Control</h2>
        <DashboardControls />
      </section>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="glass-panel p-6 rounded-2xl border border-white/5 bg-zinc-900/50">
          <h3 className="text-sm font-bold text-zinc-100 mb-4 uppercase tracking-wider">API Configuration</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-zinc-400">Master Switch</span>
              <span className="text-xs font-mono text-emerald-500 font-bold">ONLINE</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-zinc-400">Polling Interval</span>
              <span className="text-xs font-mono text-zinc-200">10s</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-zinc-400">Durable Object State</span>
              <span className="text-xs font-mono text-indigo-400 font-bold">ACTIVE</span>
            </div>
          </div>
        </div>

        <div className="glass-panel p-6 rounded-2xl border border-white/5 bg-zinc-900/50">
          <h3 className="text-sm font-bold text-zinc-100 mb-4 uppercase tracking-wider">Security</h3>
          <div className="space-y-4">
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-zinc-400">Encryption Layer</span>
              <span className="text-xs font-mono text-zinc-200">AES-256-GCM</span>
            </div>
            <div className="flex justify-between items-center py-2 border-b border-white/5">
              <span className="text-xs text-zinc-400">Session Context</span>
              <span className="text-xs font-mono text-zinc-200">JWT / RS256</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
