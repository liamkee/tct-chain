import { useState } from 'react';
import { createPortal } from 'react-dom';
import { toast } from 'react-hot-toast';

export function UpdateApiKeyModal() {
  const [isOpen, setIsOpen] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (apiKey.length !== 16) {
      toast.error('API Key must be 16 characters');
      return;
    }

    setIsVerifying(true);
    const toastId = toast.loading('Updating API Key...');
    try {
      const res = await fetch('/api/auth/bind', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey }),
      });
      const data = await res.json() as any;
      if (res.ok) {
        toast.success('API Key Updated Successfully', { id: toastId });
        setIsOpen(false);
        setApiKey('');
      } else {
        toast.error(data.error || 'Update failed', { id: toastId });
      }
    } catch (e) {
      toast.error('Network Error', { id: toastId });
    } finally {
      setIsVerifying(false);
    }
  };

  return (
    <>
      <button 
        onClick={() => setIsOpen(true)}
        className="px-5 py-2 rounded-xl bg-indigo-500/10 border border-indigo-500/20 text-[9px] font-black uppercase tracking-widest text-indigo-400 hover:bg-indigo-500/20 hover:border-indigo-500/40 transition-all active:scale-95"
      >
        API Key Update
      </button>

      {isOpen && createPortal(
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm">
          <div className="bg-zinc-950 border border-white/10 rounded-3xl p-8 shadow-2xl w-full max-w-md animate-in zoom-in-95 duration-200">
            <h2 className="text-xl font-black text-white uppercase tracking-tight mb-2">Update API Key</h2>
            <p className="text-xs text-zinc-500 font-bold mb-6 uppercase tracking-widest">Provide a new Limited Access key.</p>
            
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <input 
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Enter 16-char key..."
                  className="w-full bg-black border border-white/10 rounded-xl px-4 py-3 text-white font-mono focus:outline-none focus:border-indigo-500 transition-colors"
                />
              </div>
              
              <div className="flex gap-3">
                <button 
                  type="button"
                  onClick={() => setIsOpen(false)}
                  className="flex-1 py-3 rounded-xl border border-white/10 text-xs font-black uppercase tracking-widest text-zinc-500 hover:text-white hover:bg-zinc-900 transition-colors"
                >
                  Cancel
                </button>
                <button 
                  type="submit"
                  disabled={isVerifying || apiKey.length !== 16}
                  className="flex-1 py-3 rounded-xl bg-indigo-600 text-white text-xs font-black uppercase tracking-widest hover:bg-indigo-500 disabled:opacity-50 transition-colors"
                >
                  {isVerifying ? 'Verifying...' : 'Update'}
                </button>
              </div>
            </form>
          </div>
        </div>,
        document.body
      )}
    </>
  );
}
