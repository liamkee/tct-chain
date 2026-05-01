import { createRootRoute, Outlet } from '@tanstack/react-router'
import { TanStackRouterDevtools } from '@tanstack/router-devtools'

export const Route = createRootRoute({
  component: () => (
    <>
      <div className="p-4 bg-zinc-900 border-b border-zinc-800 flex justify-between items-center">
        <h1 className="text-xl font-bold text-amber-500">TCT Chain Dashboard</h1>
        <div className="flex gap-4">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
            <span className="text-sm text-zinc-400">System Online</span>
          </div>
        </div>
      </div>
      <div className="p-4">
        <Outlet />
      </div>
      <TanStackRouterDevtools />
    </>
  ),
})
