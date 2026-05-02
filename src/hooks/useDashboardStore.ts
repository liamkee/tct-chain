import { create } from 'zustand'

interface MemberData {
  id: string;
  energy: number;
  energy_max: number;
  status: any;
  last_action: any;
  refill_used: boolean;
  is_donator: boolean;
  cooldowns: any;
}

interface ChainStatus {
  current: number;
  max: number;
  timeout: number;
  target: number; // 🚀 目标连锁
}

interface DashboardState {
  // 核心数据
  members: Record<string, MemberData>;
  chain: ChainStatus;
  globalSelectedMembers: string[];
  microLogs: Array<{ ts: number, msg: string }>;
  lastUpdatedAt: number;
  
  // Phase 3 推演数据
  hpm: number;
  recentHPM: number;
  trend: 'UP' | 'DOWN' | 'STABLE';
  eta: number;
  tacticalAggregate: {
    totalAvailableHits: number;
    totalMaxPotentialHits: number;
    totalProjectedHits1h: number;
    memberCount: number;
  } | null;

  // UI 状态
  isConnected: boolean;
  isStale: boolean;
  filters: {
    hideOffline: boolean;
    hideHospital: boolean;
    sortByPower: boolean;
  };
  
  // Actions
  setFullSnapshot: (snapshot: any) => void;
  updateMember: (id: string, updates: any) => void;
  updateChain: (updates: any) => void;
  setSquad: (members: string[]) => void;
  setConnection: (status: boolean) => void;
  setTarget: (val: number) => void;
  toggleFilter: (key: keyof DashboardState['filters']) => void;
  addLog: (log: { ts: number, msg: string }) => void;
  setHeartbeat: (payload: any) => void; // 🚀 新增心跳处理
}

export const useDashboardStore = create<DashboardState>((set) => ({
  members: {},
  chain: { current: 0, max: 0, timeout: 0, target: 100 },
  globalSelectedMembers: [],
  microLogs: [],
  lastUpdatedAt: 0,
  hpm: 0,
  recentHPM: 0,
  trend: 'STABLE',
  eta: -1,
  tacticalAggregate: null,
  isConnected: false,
  isStale: false,
  filters: {
    hideOffline: false,
    hideHospital: false,
    sortByPower: true,
  },

  setFullSnapshot: (payload) => {
    const data = payload.data || payload; 
    const members: Record<string, any> = {};
    const logs = data.microLogs || data.micro_logs || [];
    const chain = {
      current: data.chain_current || data.status?.chainCurrent || 0,
      timeout: data.chain_timeout || data.status?.chainTimeout || 0,
      max: data.chain_max || 10,
      target: data.chain_target || 0
    };

    const memberSource = data.members || data;
    Object.entries(memberSource).forEach(([key, value]) => {
      if (key.startsWith('member_') && key.endsWith('_status')) {
        const id = key.split('_')[1];
        members[id] = {
          ...members[id],
          id,
          name: memberSource[`member_${id}_name`], 
          status: value,
          last_action: memberSource[`member_${id}_last_action`],
          energy: memberSource[`member_${id}_energy`],
          energy_max: memberSource[`member_${id}_energy_max`],
          refill_used: memberSource[`member_${id}_refill_used`],
          cooldowns: memberSource[`member_${id}_cooldowns`],
        };
      }
    });

    set({ 
      members, 
      chain, 
      microLogs: logs,
      globalSelectedMembers: data.global_selected_members || [],
      lastUpdatedAt: data.lastUpdatedAt || Date.now()
    });
  },

  updateMember: (id, updates) => set((state) => ({
    members: {
      ...state.members,
      [id]: { ...state.members[id], ...updates }
    }
  })),

  updateChain: (updates) => set((state) => ({
    chain: { ...state.chain, ...updates }
  })),

  setSquad: (members) => set({ globalSelectedMembers: members }),
  
  setConnection: (status) => set({ isConnected: status }),

  setTarget: (val: number) => set((state) => ({ 
    chain: { ...state.chain, target: val } 
  })),

  toggleFilter: (key) => set((state) => ({
    filters: { ...state.filters, [key]: !state.filters[key] }
  })),

  addLog: (log) => set((state) => {
    const newLogs = [log, ...state.microLogs].slice(0, 20);
    return { microLogs: newLogs };
  }),

  setHeartbeat: (payload) => set((state) => ({
    lastUpdatedAt: payload.lastUpdatedAt,
    hpm: payload.hpm,
    recentHPM: payload.recentHPM,
    trend: payload.trend,
    eta: payload.eta,
    tacticalAggregate: payload.aggregate || state.tacticalAggregate,
    microLogs: payload.microLogs || state.microLogs
  }))
}));
