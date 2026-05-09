import { useState } from 'react'
import { useAuthStore } from '../hooks/useAuthStore'
import { toast } from 'react-hot-toast'

export function LoginView() {
  const [apiKey, setApiKey] = useState('')
  const [isVerifying, setIsVerifying] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [preview, setPreview] = useState<any>(null)
  const user = useAuthStore((state) => state.user)
  const setUser = useAuthStore((state) => state.setUser)

  const handleVerify = async () => {
    if (apiKey.length !== 16) {
      setError('API Key must be 16 characters')
      return
    }

    setIsVerifying(true)
    setError(null)
    const toastId = toast.loading('Verifying Uplink...')
    try {
      const res = await fetch('/api/auth/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })
      const data = await res.json() as any
      if (res.ok) {
        setPreview(data.profile)
        toast.success(`Welcome, ${data.profile.name}`, { id: toastId })
      } else {
        const msg = data.error || 'Verification failed'
        setError(msg)
        toast.error(msg, { id: toastId })
      }
    } catch (e) {
      setError('Network error')
      toast.error('Uplink failed: Network error', { id: toastId })
    } finally {
      setIsVerifying(false)
    }
  }

  const handleBind = async () => {
    setIsVerifying(true)
    const toastId = toast.loading('Establishing Permanent Link...')
    try {
      const res = await fetch('/api/auth/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey })
      })
      const data = await res.json() as any
      if (res.ok) {
        toast.success('Link Secured. Redirecting...', { id: toastId })
        // Reload to get fresh session
        setTimeout(() => window.location.reload(), 1000)
      } else {
        const msg = data.error || 'Binding failed'
        setError(msg)
        toast.error(msg, { id: toastId })
      }
    } catch (e) {
      setError('Network error')
      toast.error('Permanent Link failed', { id: toastId })
    } finally {
      setIsVerifying(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-black p-4 relative overflow-hidden">
      {/* Dynamic Background */}
      <div className="absolute inset-0 z-0">
        <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-indigo-600/20 blur-[120px] rounded-full animate-pulse" />
        <div className="absolute bottom-1/4 right-1/4 w-96 h-96 bg-amber-600/10 blur-[120px] rounded-full animate-pulse delay-700" />
      </div>

      <div className="w-full max-w-md relative z-10">
        <div className="glass-panel border border-white/10 rounded-3xl p-8 shadow-2xl backdrop-blur-2xl">
          <div className="text-center mb-8">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl bg-linear-to-br from-indigo-500 to-indigo-700 shadow-lg shadow-indigo-500/20 mb-4">
              <span className="text-white font-black text-2xl">T</span>
            </div>
            <h1 className="text-2xl font-black text-white uppercase tracking-tighter">Tactical Link Protocol</h1>
            <p className="text-zinc-500 text-sm mt-1 uppercase tracking-widest font-bold">Authorized Personnel Only</p>
          </div>

          <div className="space-y-6">
            {!preview ? (
              <form 
                onSubmit={(e) => { e.preventDefault(); handleVerify(); }}
                className="space-y-4"
              >
                <div>
                  <label className="block text-[10px] text-zinc-500 font-black uppercase tracking-widest mb-2 ml-1">Secure API Key</label>
                  <input 
                    type="password"
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="Enter 16-char key..."
                    autoComplete="current-password"
                    className="w-full bg-black/50 border border-white/10 rounded-2xl px-5 py-4 text-white font-mono focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all placeholder:text-zinc-700"
                  />
                </div>
                
                {error && (
                  <div className="p-3 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-500 text-xs font-bold text-center animate-in zoom-in duration-300">
                    {error}
                  </div>
                )}

                <button 
                  type="submit"
                  disabled={isVerifying || apiKey.length !== 16}
                  className="w-full py-4 bg-white text-black font-black rounded-2xl hover:bg-zinc-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed active:scale-[0.98]"
                >
                  {isVerifying ? 'VERIFYING...' : 'INITIALIZE LINK'}
                </button>
              </form>
            ) : (
              <div className="space-y-6 animate-in zoom-in duration-500">
                <div className="p-6 rounded-3xl bg-linear-to-br from-indigo-500/20 to-indigo-700/5 border border-indigo-500/30 text-center">
                  <p className="text-[10px] text-indigo-400 font-black uppercase tracking-widest mb-4">Uplink Target Acquired</p>
                  <h3 className="text-2xl font-black text-white tracking-tighter mb-1">{preview.name}</h3>
                  <p className="text-zinc-400 text-sm font-bold uppercase tracking-tight">[{preview.faction_name || 'No Faction'}]</p>
                </div>

                <div className="flex flex-col gap-3">
                  <button 
                    onClick={handleBind}
                    disabled={isVerifying}
                    className="w-full py-4 bg-indigo-600 hover:bg-indigo-500 text-white font-black rounded-2xl transition-all shadow-lg shadow-indigo-600/20 active:scale-[0.98]"
                  >
                    {isVerifying ? 'ESTABLISHING...' : 'CONFIRM LINK'}
                  </button>
                  <button 
                    onClick={() => setPreview(null)}
                    className="w-full py-3 text-zinc-500 hover:text-zinc-300 text-xs font-bold uppercase tracking-widest transition-colors"
                  >
                    Cancel & Reset
                  </button>
                </div>
              </div>
            )}
          </div>

          <div className="mt-8 pt-6 border-t border-white/5 flex flex-col items-center">
             <div className="flex gap-4 opacity-30 grayscale hover:grayscale-0 hover:opacity-100 transition-all duration-700 cursor-default">
                <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Drizzle</span>
                <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Cloudflare</span>
                <span className="text-[10px] font-black text-white uppercase tracking-[0.2em]">Torn</span>
             </div>
             <p className="text-[8px] text-zinc-700 mt-4 uppercase tracking-[0.3em] font-medium">Protocol Version 1.3.4 // Security Level 4</p>
          </div>
        </div>
      </div>
    </div>
  )
}
