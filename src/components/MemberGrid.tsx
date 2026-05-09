import React from 'react'
import { useDashboardStore } from '../hooks/useDashboardStore'

export const MemberGrid: React.FC = () => {
  const members = useDashboardStore((state) => state.members);
  const globalSelectedMembers = useDashboardStore((state) => state.globalSelectedMembers);
  const { filters, toggleFilter, viewMode, setViewMode } = useDashboardStore();

  const processedMembers = Object.values(members)
    .filter(m => {
      // Only filter based on explicit UI toggles (Offline/Hospital)
      
      if (filters.hideOffline && m.last_action?.status !== 'Online') return false;
      if (filters.hideHospital && m.status?.state === 'Hospital') return false;
      return true;
    })
    .sort((a, b) => {
      if (filters.sortByPower) {
        // Purely descend by energy/power
        const energyDiff = (b.energy || 0) - (a.energy || 0);
        if (energyDiff !== 0) return energyDiff;
        
        // Tie-breaker: Online status
        const getStatusWeight = (m: any) => {
          const s = m.last_action?.status;
          if (s === 'Online') return 0;
          if (s === 'Idle') return 1;
          return 2;
        };
        return getStatusWeight(a) - getStatusWeight(b);
      }
      if (a.last_action?.status === 'Online' && b.last_action?.status !== 'Online') return -1;
      if (a.last_action?.status !== 'Online' && b.last_action?.status === 'Online') return 1;
      return 0;
    });

  const controls = (
    <div className="flex items-center justify-end gap-2 mb-4 px-4 md:px-6">
      <FilterButton
        active={filters.hideOffline}
        onClick={() => toggleFilter('hideOffline')}
        label="HIDE OFFLINE"
      />
      <FilterButton
        active={filters.hideHospital}
        onClick={() => toggleFilter('hideHospital')}
        label="HIDE IN HOSP"
      />
      <div className="h-4 w-px bg-white/10 mx-2" />
      <FilterButton
        active={filters.sortByPower}
        onClick={() => toggleFilter('sortByPower')}
        label="ENERGY DESC"
      />

      <div className="flex items-center gap-1 p-1 bg-black/40 rounded-lg border border-white/5 ml-4">
        <button
          onClick={() => setViewMode('grid')}
          className={`p-1.5 rounded-md transition-all ${viewMode === 'grid' ? 'bg-indigo-500 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          title="Grid View"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect width="7" height="7" x="3" y="3" rx="1" /><rect width="7" height="7" x="14" y="3" rx="1" /><rect width="7" height="7" x="14" y="14" rx="1" /><rect width="7" height="7" x="3" y="14" rx="1" /></svg>
        </button>
        <button
          onClick={() => setViewMode('list')}
          className={`p-1.5 rounded-md transition-all ${viewMode === 'list' ? 'bg-indigo-500 text-white' : 'text-zinc-500 hover:text-zinc-300'}`}
          title="List View"
        >
          <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><line x1="3" x2="21" y1="6" y2="6" /><line x1="3" x2="21" y1="12" y2="12" /><line x1="3" x2="21" y1="18" y2="18" /></svg>
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col">
      {controls}
      {viewMode === 'list' ? (
        <div className="flex flex-col gap-1 p-2 md:p-4">
          {/* Table Header */}
          <div className="grid grid-cols-12 gap-4 px-4 py-2 text-[10px] font-black text-zinc-500 uppercase tracking-widest border-b border-white/5">
            <div className="col-span-3">Personnel</div>
            <div className="col-span-2">Life Status</div>
            <div className="col-span-2">Activity</div>
            <div className="col-span-3">Energy</div>
            <div className="col-span-2 text-right">Cooldowns</div>
          </div>
          {processedMembers.map((member) => (
            <MemberRow 
              key={member.id} 
              member={member} 
              isSelected={globalSelectedMembers.includes(member.id)}
            />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4 p-2 md:p-4">
          {processedMembers.map((member) => (
            <MemberCard 
              key={member.id} 
              member={member} 
              isSelected={globalSelectedMembers.includes(member.id)}
            />
          ))}
        </div>
      )}
    </div>
  );
};

const FilterButton: React.FC<{ active: boolean, onClick: () => void, label: string }> = ({ active, onClick, label }) => (
  <button
    onClick={onClick}
    className={`px-3 py-1.5 rounded-md text-[10px] font-black tracking-tighter transition-all border ${active
        ? 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.4)]'
        : 'bg-zinc-800/50 text-zinc-500 border-white/5 hover:border-white/20'
      }`}
  >
    {label}
  </button>
);

const MemberCard: React.FC<{ member: any, isSelected: boolean }> = ({ member, isSelected }) => {
  const statusColor = member.status?.state === 'Okay' ? 'bg-emerald-500' : 
                     member.status?.state === 'Hospital' ? 'bg-rose-500' : 'bg-amber-500';

  return (
    <div className={`relative group overflow-hidden rounded-xl border border-white/10 bg-zinc-900/50 p-4 transition-all hover:bg-zinc-800/80 ${isSelected ? 'ring-2 ring-indigo-500' : ''}`}>
      {/* 玻璃拟态装饰 */}
      <div className="absolute -right-4 -top-4 h-24 w-24 rounded-full bg-indigo-500/10 blur-3xl group-hover:bg-indigo-500/20 transition-colors" />
      
      <div className="flex items-center justify-between mb-3">
        <div className="flex flex-col">
          <div className="flex items-center gap-2">
            <div className={`h-2 w-2 rounded-full ${statusColor} shadow-[0_0_8px_rgba(0,0,0,0.5)] shadow-current`} />
            <span className="font-bold text-zinc-100 truncate max-w-[140px] text-base leading-none">
              {member.name || 'Unknown'}
            </span>
          </div>
          <span className="text-[10px] text-zinc-500 font-mono mt-1 ml-4">#{member.id}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-zinc-400 font-mono uppercase tracking-widest flex flex-col items-end leading-tight">
            <span>{member.last_action?.status}</span>
            {member.last_action?.status !== 'Online' && member.last_action?.seconds !== undefined && (
              <span className="text-zinc-600 text-[8px]">
                {member.last_action.seconds > 3600 
                  ? `${Math.floor(member.last_action.seconds / 3600)}h ago` 
                  : `${Math.floor(member.last_action.seconds / 60)}m ago`}
              </span>
            )}
          </span>
        </div>
      </div>

      {/* 能量条 */}
      <div className="space-y-1 mb-3">
        <div className="flex justify-between text-[10px] text-zinc-400">
          <span>ENERGY</span>
          <span>{member.energy || 0} / {member.energy_max || 100}</span>
        </div>
        <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-linear-to-r from-indigo-500 to-cyan-400 transition-all duration-1000 ease-out"
            style={{ width: `${((member.energy || 0) / (member.energy_max || 100)) * 100}%` }}
          />
        </div>
      </div>

      {/* 战术数据 - 扩展三项 CD */}
      <div className="grid grid-cols-3 gap-1.5 text-[10px] mb-3">
        <div className={`rounded bg-black/40 p-1 border transition-colors ${(member.cooldowns?.drug || 0) > 0 ? 'border-orange-500/30' : 'border-emerald-500/10'}`}>
          <div className="text-zinc-500 text-[8px] uppercase leading-none mb-1">DRUG</div>
          <div className={`font-mono font-bold leading-none ${(member.cooldowns?.drug || 0) > 0 ? 'text-orange-400' : 'text-emerald-500/50'}`}>
            {(member.cooldowns?.drug || 0) > 0 ? `${Math.floor(member.cooldowns.drug / 60)}m` : '0'}
          </div>
        </div>
        <div className={`rounded bg-black/40 p-1 border transition-colors ${(member.cooldowns?.medical || 0) > 0 ? 'border-rose-500/30' : 'border-emerald-500/10'}`}>
          <div className="text-zinc-500 text-[8px] uppercase leading-none mb-1">MED</div>
          <div className={`font-mono font-bold leading-none ${(member.cooldowns?.medical || 0) > 0 ? 'text-rose-400' : 'text-emerald-500/50'}`}>
            {(member.cooldowns?.medical || 0) > 0 ? `${Math.floor(member.cooldowns.medical / 60)}m` : '0'}
          </div>
        </div>
        <div className={`rounded bg-black/40 p-1 border transition-colors ${(member.cooldowns?.booster || 0) > 0 ? 'border-indigo-500/30' : 'border-emerald-500/10'}`}>
          <div className="text-zinc-500 text-[8px] uppercase leading-none mb-1">BOOST</div>
          <div className={`font-mono font-bold leading-none ${(member.cooldowns?.booster || 0) > 0 ? 'text-indigo-400' : 'text-emerald-500/50'}`}>
            {(member.cooldowns?.booster || 0) > 0 ? `${Math.floor(member.cooldowns.booster / 60)}m` : '0'}
          </div>
        </div>
      </div>

      {/* Refill 状态 */}
      <div className={`rounded bg-black/20 px-2 py-1 border transition-colors flex justify-between items-center ${member.refill_used ? 'border-rose-500/30' : 'border-emerald-500/20'}`}>
        <span className="text-[10px] text-zinc-500 uppercase font-bold">Refill</span>
        <span className={`text-[10px] font-black ${member.refill_used ? 'text-rose-400' : 'text-emerald-400'}`}>
          {member.refill_used ? 'USED' : 'READY'}
        </span>
      </div>
    </div>
  );
};

const MemberRow: React.FC<{ member: any, isSelected: boolean }> = ({ member, isSelected }) => {
  const statusColor = member.status?.state === 'Okay' ? 'text-emerald-400' : 
                     member.status?.state === 'Hospital' ? 'text-rose-400' : 'text-amber-400';
  
  const onlineColor = member.last_action?.status === 'Online' ? 'text-green-400' : 
                     member.last_action?.status === 'Idle' ? 'text-amber-400' : 'text-zinc-500';

  return (
    <div className={`grid grid-cols-12 gap-4 items-center px-4 py-2 rounded-lg border border-white/5 bg-zinc-900/30 hover:bg-zinc-800/50 transition-all ${isSelected ? 'ring-1 ring-indigo-500 bg-indigo-500/5' : ''}`}>
      {/* Personnel */}
      <div className="col-span-3 flex items-center gap-3">
        <span className="font-bold text-zinc-100 truncate text-sm">{member.name}</span>
        <span className="text-[10px] text-zinc-600 font-mono">#{member.id}</span>
      </div>

      {/* Life Status */}
      <div className="col-span-2 flex items-center gap-2">
        <div className={`h-1.5 w-1.5 rounded-full ${member.status?.state === 'Okay' ? 'bg-emerald-500' : 'bg-rose-500'}`} />
        <span className={`text-xs font-bold ${statusColor}`}>{member.status?.state}</span>
      </div>

      {/* Activity */}
      <div className="col-span-2">
        <span className={`text-[10px] font-black uppercase tracking-wider ${onlineColor}`}>{member.last_action?.status}</span>
        {member.last_action?.status !== 'Online' && (
          <span className="text-zinc-600 text-[9px] ml-2 font-mono">
            {member.last_action?.seconds && member.last_action.seconds > 3600 
              ? `${Math.floor(member.last_action.seconds / 3600)}h` 
              : `${Math.floor((member.last_action?.seconds || 0) / 60)}m`}
          </span>
        )}
      </div>

      {/* Energy */}
      <div className="col-span-3 flex items-center gap-3">
        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
          <div 
            className="h-full bg-linear-to-r from-indigo-500 to-cyan-400 transition-all duration-1000"
            style={{ width: `${((member.energy || 0) / (member.energy_max || 100)) * 100}%` }}
          />
        </div>
        <span className="text-[10px] font-mono text-zinc-400 min-w-[45px] text-right">
          {member.energy || 0}/{member.energy_max || 100}
        </span>
      </div>

      {/* Cooldowns */}
      <div className="col-span-2 flex justify-end gap-2">
        {(member.cooldowns?.drug || 0) > 0 && (
          <div className="w-6 h-6 rounded bg-orange-500/10 border border-orange-500/30 flex items-center justify-center text-[8px] font-bold text-orange-400" title="Drug CD">
            D
          </div>
        )}
        {(member.cooldowns?.medical || 0) > 0 && (
          <div className="w-6 h-6 rounded bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-[8px] font-bold text-rose-400" title="Med CD">
            M
          </div>
        )}
        {(member.cooldowns?.booster || 0) > 0 && (
          <div className="w-6 h-6 rounded bg-indigo-500/10 border border-indigo-500/30 flex items-center justify-center text-[8px] font-bold text-indigo-400" title="Boost CD">
            B
          </div>
        )}
        <div className={`w-6 h-6 rounded flex items-center justify-center text-[8px] font-bold border transition-all ${member.refill_used
            ? 'bg-zinc-800 border-white/5 text-zinc-600'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.1)]'
          }`} title={member.refill_used ? 'Refill Used' : 'Refill Ready'}>
          R
        </div>
      </div>
    </div>
  );
};
