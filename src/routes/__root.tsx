import { createRootRoute, Outlet, Link } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'
import { StatusIndicator } from '../components/StatusIndicator'
import { Toaster } from 'react-hot-toast'
import { useAuthStore } from '../hooks/useAuthStore'

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen flex flex-col font-sans selection:bg-amber-500/30">
      {/* Header / Navigation */}
      <header className="sticky top-0 z-50 glass-panel border-b border-white/5 px-6 py-4 flex justify-between items-center">
        <div className="flex items-center gap-8">
          <div className="flex items-center gap-3">
            <img 
              src="/logo.avif" 
              alt="Logo" 
              className="w-9 h-9 rounded-lg object-cover border border-white/10"
            />
            <div className="flex flex-col">
              <span className="text-sm font-black tracking-tighter uppercase leading-none text-zinc-100">TCT Chain</span>
              <span className="text-[10px] text-amber-500/80 font-bold uppercase tracking-widest leading-none mt-1">Intelligence</span>
            </div>
          </div>


        </div>

        <div className="flex items-center gap-4">
          <AuthHeaderActions />
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl mx-auto w-full p-6">
        <Outlet />
      </main>

      {/* Footer / Footer Bar */}
      <footer className="px-6 py-4 text-center border-t border-white/5 bg-zinc-950">
        <p className="text-[10px] text-zinc-600 uppercase tracking-widest font-medium">
          TCT-Chain Protocol v1.3 • Authorized Personnel Only
        </p>
      </footer>


      <Toaster 
        position="bottom-right"
        toastOptions={{
          duration: 4000,
          style: {
            background: '#18181b',
            color: '#fff',
            border: '1px border rgba(255,255,255,0.05)',
            borderRadius: '12px',
            fontSize: '14px',
          },
        }}
      />
    </div>
  ),
})

function AuthHeaderActions() {
  const { isAuthenticated, user, logout } = useAuthStore()

  if (!isAuthenticated || user?.role === 'unverified') {
    return (
      <div className="w-8 h-8 rounded-full bg-zinc-900 border border-white/5 flex items-center justify-center grayscale opacity-30">
        <span className="text-[10px] text-zinc-500 font-bold">OFF</span>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-4">
      <button
        onClick={logout}
        className="min-w-[120px] flex items-center justify-center px-5 py-2.5 rounded-xl bg-zinc-900 border border-white/10 hover:border-zinc-100/30 hover:bg-zinc-800 transition-all duration-300"
      >
        <span className="text-[10px] font-black uppercase tracking-[0.15em] text-zinc-400 hover:text-zinc-100 transition-colors leading-none">
          Disconnect
        </span>
      </button>
    </div>
  )
}

function NavLink({ to, children }: { to: string; children: React.ReactNode }) {
  return (
    <Link 
      to={to} 
      activeProps={{ className: 'bg-amber-500/10 text-amber-500 border-amber-500/20' }}
      className="px-4 py-1.5 rounded-lg text-sm font-medium text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800/50 transition-all border border-transparent"
    >
      {children}
    </Link>
  )
}
