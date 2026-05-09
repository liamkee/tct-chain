import { createRootRoute, Outlet } from '@tanstack/react-router'
import { Toaster } from 'react-hot-toast'

export const Route = createRootRoute({
  component: () => (
    <div className="min-h-screen bg-black text-zinc-100 font-sans selection:bg-indigo-500/30">
      <Outlet />
      <Toaster position="bottom-right" />
    </div>
  ),
})
