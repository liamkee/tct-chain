import { useQuery } from '@tanstack/react-query'

export function StatusIndicator() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['system-status'],
    queryFn: async () => {
      const res = await fetch('/api/health')
      if (!res.ok && res.status !== 503) throw new Error('Network response was not ok')
      return res.json() as Promise<{ status: string; error?: string }>
    },
    refetchInterval: 30000, // Sync every 30s
  })

  // 503 means Master Switch is OFF
  const isOff = data?.status === 'stopped' || error?.message?.includes('503')
  const isOn = data?.status === 'ok'

  return (
    <div className="flex items-center gap-3 px-3 py-1.5 rounded-full bg-zinc-900/80 border border-white/5 backdrop-blur-sm">
      <div className="relative flex items-center justify-center">
        {/* Outer Glow */}
        <div className={`absolute inset-0 rounded-full blur-sm opacity-50 ${
          isLoading ? 'bg-amber-500 animate-pulse' : 
          isOn ? 'bg-green-500 status-glow-on' : 
          'bg-red-500 status-glow-off'
        }`} />
        
        {/* Core Dot */}
        <div className={`relative w-2.5 h-2.5 rounded-full transition-colors duration-500 ${
          isLoading ? 'bg-amber-400' : 
          isOn ? 'bg-green-400' : 
          'bg-red-500'
        }`} />
      </div>
      
      <div className="flex flex-col leading-none">
        <span className="text-[10px] uppercase tracking-wider text-zinc-500 font-bold">System Status</span>
        <span className={`text-xs font-medium ${
          isLoading ? 'text-amber-200' : 
          isOn ? 'text-green-400' : 
          'text-red-400'
        }`}>
          {isLoading ? 'Verifying...' : isOn ? 'Operational' : 'Restricted'}
        </span>
      </div>
    </div>
  )
}
