import { create } from 'zustand'

interface MemberData {
  id: string;
  name: string;
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
  deadline: number; // 🚀 目标过期时间戳 (ms)
  target: number; // 🚀 目标连锁
}

interface DashboardState {
  // 核心数据
  members: Record<string, MemberData>;
  chain: ChainStatus;
  globalSelectedMembers: string[];
  microLogs: Array<{ ts: number, msg: string }>;
  lastUpdatedAt: number;
  serverClockOffset: number; // DO Time - Local Time
  masterSwitch: 'ON' | 'OFF';
  
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
  viewMode: 'grid' | 'list';
  filters: {
    hideOffline: boolean;
    hideHospital: boolean;
    hideTraveling: boolean;
    sortBy: 'name' | 'status' | 'activity' | 'power' | 'none';
    sortOrder: 'asc' | 'desc';
  };
  
  // Actions
  setFullSnapshot: (snapshot: any) => void;
  updateMember: (id: string, updates: any) => void;
  updateChain: (updates: any) => void;
  setSquad: (members: string[]) => void;
  setConnection: (status: boolean) => void;
  setTarget: (val: number) => void;
  setViewMode: (mode: 'grid' | 'list') => void;
  toggleFilter: (key: keyof DashboardState['filters']) => void;
  setSort: (key: DashboardState['filters']['sortBy']) => void;
  addLog: (log: { ts: number, msg: string }) => void;
  setHeartbeat: (payload: any) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  members: {},
  chain: { current: 0, max: 0, timeout: 0, deadline: 0, target: 100 },
  globalSelectedMembers: [],
  microLogs: [],
  lastUpdatedAt: 0,
  serverClockOffset: 0,
  masterSwitch: 'OFF',
  hpm: 0,
  recentHPM: 0,
  trend: 'STABLE',
  eta: -1,
  tacticalAggregate: null,
  isConnected: false,
  isStale: false,
  viewMode: 'list',
  filters: {
    hideOffline: false,
    hideHospital: false,
    hideTraveling: false,
    sortBy: 'none',
    sortOrder: 'asc',
  },

  setFullSnapshot: (payload) => set((state) => {
    const data = payload.data || payload; 
    const members: Record<string, any> = {};
    const logs = data.microLogs || data.micro_logs || [];
    const doTime = data.do_server_time_ms || Date.now();
    const offset = doTime - Date.now();

    const chain = {
      current: data.chain_current || 0,
      timeout: data.chain_timeout || 0,
      deadline: data.chain_deadline_ms || (Date.now() + offset + (data.chain_timeout || 0) * 1000),
      max: data.chain_max || 10,
      target: data.chain_target || 100
    };

    const memberSource = data.members || {};
    Object.entries(memberSource).forEach(([id, memberData]: [string, any]) => {
      members[id] = {
        id,
        name: memberData.name || 'Unknown',
        status: memberData.status,
        last_action: memberData.last_action,
        energy: memberData.energy || 0,
        energy_max: memberData.energy_max || 100,
        refill_used: memberData.refill_used || false,
        is_donator: memberData.is_donator || false,
        cooldowns: memberData.cooldowns || { drug: 0, medical: 0, booster: 0 },
      };
    });

    console.log(`[Store] Snapshot: Received ${Object.keys(members).length} members. Switch: ${data.master_switch}`);

    return { 
      members, 
      chain, 
      microLogs: logs,
      globalSelectedMembers: data.global_selected_members || [],
      lastUpdatedAt: data.lastUpdatedAt || Date.now(),
      serverClockOffset: offset,
      masterSwitch: data.master_switch || 'OFF'
    };
  }),

  updateMember: (id, updates) => set((state) => ({
    members: {
      ...state.members,
      [id]: { ...state.members[id], ...updates }
    }
  })),

  updateChain: (updates) => set((state) => {
    const doTime = updates.do_server_time_ms || Date.now();
    const offset = updates.do_server_time_ms ? doTime - Date.now() : state.serverClockOffset;
    
    return {
      chain: { 
        ...state.chain, 
        ...updates,
        deadline: updates.chain_deadline_ms || 
                  (updates.timeout !== undefined ? Date.now() + offset + updates.timeout * 1000 : state.chain.deadline)
      },
      serverClockOffset: offset
    };
  }),

  setSquad: (members) => set({ globalSelectedMembers: members }),
  setConnection: (status) => set({ isConnected: status }),
  setTarget: (val: number) => set((state) => ({ 
    chain: { ...state.chain, target: val } 
  })),
  setViewMode: (mode) => set({ viewMode: mode }),
  toggleFilter: (key) => set((state) => ({
    filters: { ...state.filters, [key]: !state.filters[key] }
  })),
  setSort: (key) => set((state) => {
    const isSameKey = state.filters.sortBy === key;
    const nextOrder = isSameKey && state.filters.sortOrder === 'desc' ? 'asc' : 'desc';
    return {
      filters: {
        ...state.filters,
        sortBy: key,
        sortOrder: nextOrder
      }
    };
  }),
  addLog: (log) => set((state) => {
    const newLogs = [log, ...state.microLogs].slice(0, 20);
    return { microLogs: newLogs };
  }),

  setHeartbeat: (payload) => set((state) => {
    const data = payload.data || payload; 
    const doTime = data.do_server_time_ms || Date.now();
    const offset = data.do_server_time_ms ? doTime - Date.now() : state.serverClockOffset;
    
    // 🚀 NEW: Also update members if present in heartbeat
    const members = { ...state.members };
    if (data.members) {
      Object.entries(data.members).forEach(([id, m]: [string, any]) => {
        members[id] = { ...members[id], ...m, id };
      });
    }

    const chain = data.chain_current !== undefined ? {
      current: data.chain_current,
      timeout: data.chain_timeout || state.chain.timeout,
      deadline: data.chain_deadline_ms || state.chain.deadline,
      max: data.chain_max || state.chain.max,
      target: data.chain_target || state.chain.target
    } : state.chain;

    console.log(`[Store] Heartbeat: Synced ${Object.keys(data.members || {}).length} members.`);

    return {
      members,
      chain,
      lastUpdatedAt: data.lastUpdatedAt || state.lastUpdatedAt,
      hpm: data.hpm || state.hpm,
      recentHPM: data.recentHPM || state.recentHPM,
      trend: data.trend || state.trend,
      eta: data.eta || state.eta,
      tacticalAggregate: data.aggregate || state.tacticalAggregate,
      microLogs: data.microLogs || state.microLogs,
      serverClockOffset: offset,
      masterSwitch: data.master_switch || state.masterSwitch
    };
  })
}));
