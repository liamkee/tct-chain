import { create } from 'zustand'

interface MemberData {
  id: string;
  name: string;
  energy: number;
  energy_max: number;
  status: any;
  last_action: any;
  refill_used: boolean;

  cooldowns: any;
  last_updated?: number;
}

interface ChainStatus {
  current: number;
  max: number;
  timeout: number;
  deadline: number;
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

  isConnected: boolean;
  isStale: boolean;
  filters: {
    hideOffline: boolean;
    hideHospital: boolean;
    hideTraveling: boolean;
    sortBy: 'name' | 'status' | 'activity' | 'power' | 'refill' | 'none';
    sortOrder: 'asc' | 'desc';
  };
  
  // Actions
  setFullSnapshot: (snapshot: any) => void;
  updateMember: (id: string, updates: any) => void;
  updateChain: (updates: any) => void;
  setSquad: (members: string[]) => void;
  setConnection: (status: boolean) => void;
  setStale: (status: boolean) => void;
  setTarget: (val: number) => void;
  toggleFilter: (key: keyof DashboardState['filters']) => void;
  setSort: (key: DashboardState['filters']['sortBy']) => void;
  addLog: (log: { ts: number, msg: string }) => void;
  setHeartbeat: (payload: any) => void;
}

export const useDashboardStore = create<DashboardState>((set) => ({
  members: {},
  chain: { current: 0, max: 10, timeout: 300, deadline: 0 },
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
  filters: {
    hideOffline: false,
    hideHospital: false,
    hideTraveling: false,
    sortBy: 'activity',
    sortOrder: 'desc',
  },

  setFullSnapshot: (payload) => set((state) => {
    const data = payload.data || payload; 
    const members: Record<string, any> = {};
    const logs = data.microLogs || data.micro_logs || [];
    const doTime = data.do_server_time_ms || Date.now();
    const offset = doTime - Date.now();

    const chain = {
      current: Math.max(0, data.chain_current || 0),
      timeout: Math.max(0, data.chain_timeout || 0),
      deadline: data.chain_deadline_ms || (Date.now() + offset + (data.chain_timeout || 0) * 1000),
      max: Math.max(10, data.chain_max || 10)
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

        cooldowns: memberData.cooldowns || { drug: 0, medical: 0, booster: 0 },
        last_updated: memberData.last_updated,
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
      masterSwitch: data.master_switch || 'OFF',
      tacticalAggregate: data.aggregate || null
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
  setStale: (status) => set({ isStale: status }),
  setTarget: (val: number) => set((state) => ({ 
    chain: { ...state.chain, max: val } 
  })),
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
      max: data.chain_max || state.chain.max
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
