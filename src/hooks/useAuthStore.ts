import { create } from 'zustand'
import { toast } from 'react-hot-toast'

interface User {
  torn_id?: string;
  discord_id: string;
  faction_id?: string;
  role: 'admin' | 'member' | 'unverified';
  username?: string;
}

interface AuthState {
  user: User | null;
  isAuthenticated: boolean;
  isVerifying: boolean;
  isInitialized: boolean;
  
  checkAuth: () => Promise<void>;
  logout: () => void;
  setUser: (user: User | null) => void;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  isAuthenticated: false,
  isVerifying: false,
  isInitialized: false,

  checkAuth: async () => {
    try {
      const res = await fetch('/api/auth/me');
      if (res.ok) {
        const data = await res.json() as { user: User, authenticated: boolean };
        set({ 
          user: data.user, 
          isAuthenticated: data.authenticated, 
          isInitialized: true 
        });
      } else {
        const data = await res.json() as any;
        if (data.error) {
          toast.error(data.error);
        }
        set({ user: null, isAuthenticated: false, isInitialized: true });
      }
    } catch (e) {
      set({ user: null, isAuthenticated: false, isInitialized: true });
    }
  },

  logout: () => {
    window.location.href = '/api/auth/logout';
  },

  setUser: (user) => set({ user, isAuthenticated: !!user })
}));
