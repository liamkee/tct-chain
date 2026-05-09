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
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 bg-linear-to-br from-amber-400 to-amber-600 rounded-lg flex items-center justify-center shadow-lg shadow-amber-500/20">
              <span className="text-zinc-950 font-black text-lg">T</span>
            </div>
            <div className="flex flex-col">
              <span className="text-sm font-black tracking-tighter uppercase leading-none text-zinc-100">TCT Chain</span>
              <span className="text-[10px] text-amber-500/80 font-bold uppercase tracking-widest leading-none">Intelligence</span>
            </div>
          </div>

          <nav className="hidden md:flex items-center gap-1">
            <NavLink to="/">Overview</NavLink>
            <NavLink to="/dashboard">Tactical</NavLink>
            <NavLink to="/members">Personnel</NavLink>
            <NavLink to="/settings">Configs</NavLink>
          </nav>
        </div>

        <div className="flex items-center gap-4">
          <StatusIndicator />
          <div className="h-8 w-px bg-white/10 mx-2" />
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

      <TanStackRouterDevtools />
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
        className="text-[10px] font-black uppercase tracking-widest text-zinc-500 hover:text-rose-500 transition-colors"
      >
        Disconnect
      </button>
      <div className="w-8 h-8 rounded-full bg-linear-to-br from-indigo-500 to-indigo-700 border border-white/10 flex items-center justify-center shadow-lg shadow-indigo-500/20">
         <span className="text-xs text-white font-bold">{user?.username?.[0] || user?.torn_id?.[0] || '?'}</span>
      </div>
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
