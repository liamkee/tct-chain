import React from 'react'
import { useDashboardStore } from '../hooks/useDashboardStore'

export const MemberGrid: React.FC = () => {
  const masterSwitch = useDashboardStore((state) => state.masterSwitch);
  const members = useDashboardStore((state) => state.members);
  const globalSelectedMembers = useDashboardStore((state) => state.globalSelectedMembers);
  const { filters, toggleFilter, setSort } = useDashboardStore();

  if (masterSwitch === 'OFF') return null;

  const processedMembers = Object.values(members)
    .filter(m => {
      if (filters.hideOffline && m.last_action?.status !== 'Online') return false;
      if (filters.hideHospital && m.status?.state === 'Hospital') return false;
      if (filters.hideTraveling && m.status?.state === 'Traveling') return false;
      return true;
    })
    .sort((a, b) => {
      const isAsc = filters.sortOrder === 'asc';

      if (filters.sortBy === 'status') {
        const getLifeWeight = (m: any) => {
          if (m.status?.state === 'Okay') return 0;
          if (m.status?.state === 'Hospital') return 1;
          if (m.status?.state === 'Traveling') return 2;
          if (m.status?.state === 'Jail') return 3;
          return 4;
        };
        const diff = getLifeWeight(a) - getLifeWeight(b);
        return isAsc ? -diff : diff; 
      }

      if (filters.sortBy === 'name') {
        const diff = (a.name || '').localeCompare(b.name || '');
        return isAsc ? -diff : diff; 
      }

      if (filters.sortBy === 'activity') {
        const getStatusWeight = (m: any) => {
          const s = m.last_action?.status;
          if (s === 'Online') return 0;
          if (s === 'Idle') return 1;
          if (s === 'Traveling') return 2;
          return 3;
        };
        const statusDiff = getStatusWeight(a) - getStatusWeight(b);
        const diff = statusDiff !== 0 ? statusDiff : (a.last_action?.seconds || 0) - (b.last_action?.seconds || 0);
        return isAsc ? -diff : diff; 
      }

      if (filters.sortBy === 'power') {
        const diff = (b.energy || 0) - (a.energy || 0);
        return isAsc ? -diff : diff; 
      }

      if (filters.sortBy === 'refill') {
        const aVal = a.refill_used ? 1 : 0;
        const bVal = b.refill_used ? 1 : 0;
        const diff = aVal - bVal;
        return isAsc ? -diff : diff;
      }

      if (a.last_action?.status === 'Online' && b.last_action?.status !== 'Online') return -1;
      if (a.last_action?.status !== 'Online' && b.last_action?.status === 'Online') return 1;
      return (b.energy || 0) - (a.energy || 0);
    });

  const getSortIcon = (key: string) => {
    if (filters.sortBy !== key) return null;
    return (
      <span className="inline-flex flex-col items-center justify-center ml-2 w-3 h-3 relative">
        <span className={`absolute top-0 text-[7px] transition-all duration-300 ${
          filters.sortOrder === 'asc' 
            ? 'text-indigo-400 opacity-100 scale-110' 
            : 'text-zinc-600 opacity-20'
        }`}>▲</span>
        <span className={`absolute bottom-0 text-[7px] transition-all duration-300 ${
          filters.sortOrder === 'desc' 
            ? 'text-indigo-400 opacity-100 scale-110' 
            : 'text-zinc-600 opacity-20'
        }`}>▼</span>
      </span>
    );
  };

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
      <FilterButton
        active={filters.hideTraveling}
        onClick={() => toggleFilter('hideTraveling')}
        label="HIDE TRAVELING"
      />
    </div>
  );

  return (
    <div className="flex flex-col">
      {controls}
      <div className="flex flex-col gap-1 p-2 md:p-4">
        {/* Interactive Header Row */}
        <div className="grid grid-cols-12 gap-4 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-zinc-500 border-b border-white/5 mb-1">
          <button 
            onClick={() => setSort('name')}
            className={`col-span-3 text-left hover:text-zinc-300 transition-colors flex items-center gap-1 ${filters.sortBy === 'name' ? 'text-indigo-400' : ''}`}
          >
            Personnel {getSortIcon('name')}
          </button>
          <button 
            onClick={() => setSort('status')}
            className={`col-span-1 text-left hover:text-zinc-300 transition-colors flex items-center gap-1 ${filters.sortBy === 'status' ? 'text-indigo-400' : ''}`}
          >
            Status {getSortIcon('status')}
          </button>
          <button 
            onClick={() => setSort('activity')}
            className={`col-span-1 text-left hover:text-zinc-300 transition-colors flex items-center gap-1 ${filters.sortBy === 'activity' ? 'text-indigo-400' : ''}`}
          >
            Activity {getSortIcon('activity')}
          </button>
          <button 
            onClick={() => setSort('power')}
            className={`col-span-3 text-center hover:text-zinc-300 transition-colors flex items-center justify-center gap-1 ${filters.sortBy === 'power' ? 'text-indigo-400' : ''}`}
          >
            Energy {getSortIcon('power')}
          </button>
          <div className="col-span-3 text-center opacity-50 cursor-default">Cooldowns</div>
          <button 
            onClick={() => setSort('refill' as any)}
            className={`col-span-1 text-right hover:text-zinc-300 transition-colors flex items-center justify-end gap-1 ${filters.sortBy === 'refill' ? 'text-indigo-400' : ''}`}
          >
            Refill {getSortIcon('refill' as any)}
          </button>
        </div>

        {processedMembers.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isSelected={globalSelectedMembers.includes(member.id)}
          />
        ))}
      </div>
    </div>
  );
};

const FilterButton: React.FC<{ active: boolean, onClick: () => void, label: string }> = ({ active, onClick, label }) => {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-xl text-[10px] font-black tracking-tighter transition-all border ${active
        ? 'bg-indigo-500 text-white border-indigo-400 shadow-[0_0_15px_rgba(99,102,241,0.4)]'
        : 'bg-zinc-800/50 text-zinc-500 border-white/5 hover:border-white/20'
        }`}
    >
      {label}
    </button>
  );
};

const MemberRow: React.FC<{ member: any, isSelected: boolean }> = ({ member, isSelected }) => {
  const statusColor = member.status?.state === 'Okay' ? 'text-emerald-400' :
    member.status?.state === 'Hospital' ? 'text-rose-400' : 
    member.status?.state === 'Traveling' ? 'text-blue-400' : 'text-amber-400';

  const onlineColor = member.last_action?.status === 'Online' ? 'text-green-400' :
    member.last_action?.status === 'Idle' ? 'text-amber-400' : 
    member.last_action?.status === 'Traveling' ? 'text-blue-400' : 'text-zinc-500';

  return (
    <div className={`grid grid-cols-12 gap-4 items-center px-4 py-2 rounded-xl border border-white/5 bg-zinc-900/30 hover:bg-zinc-800/50 transition-all ${isSelected ? 'ring-1 ring-indigo-500 bg-indigo-500/5' : ''}`}>
      {/* Personnel */}
      <div className="col-span-3 flex items-center gap-3">
        <span className="font-bold text-zinc-100 truncate text-sm">{member.name}</span>
        <span className="text-[10px] text-zinc-600 font-mono">#{member.id}</span>
      </div>

      {/* Life Status */}
      <div className="col-span-1 flex items-center gap-2">
        <div className={`h-1.5 w-1.5 rounded-full ${
          member.status?.state === 'Okay' ? 'bg-emerald-500' : 
          member.status?.state === 'Hospital' ? 'bg-rose-500' : 
          member.status?.state === 'Traveling' ? 'bg-blue-500' : 'bg-amber-500'
        }`} />
        <span className={`text-[10px] font-bold truncate ${statusColor}`}>{member.status?.state}</span>
      </div>

      {/* Activity */}
      <div className="col-span-1 flex items-center">
        <span className={`text-[9px] font-black uppercase tracking-wider ${onlineColor} -mt-0.5`}>{member.last_action?.status}</span>
      </div>

      {/* Energy Column */}
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
      
      {/* Cooldowns Column with Timers */}
      <div className="col-span-3 flex flex-wrap justify-center gap-1.5">
        {(member.cooldowns?.drug || 0) > 0 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-orange-500/10 border border-orange-500/30" title="Drug CD">
            <span className="text-[8px] font-black text-orange-400">D</span>
            <span className="text-[9px] font-mono font-bold text-orange-300">
              {member.cooldowns.drug >= 3600 ? `${Math.floor(member.cooldowns.drug / 3600)}h ` : ''}
              {Math.floor((member.cooldowns.drug % 3600) / 60)}m
            </span>
          </div>
        )}
        {(member.cooldowns?.medical || 0) > 0 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-rose-500/10 border border-rose-500/30" title="Med CD">
            <span className="text-[8px] font-black text-rose-400">M</span>
            <span className="text-[9px] font-mono font-bold text-rose-300">
              {member.cooldowns.medical >= 3600 ? `${Math.floor(member.cooldowns.medical / 3600)}h ` : ''}
              {Math.floor((member.cooldowns.medical % 3600) / 60)}m
            </span>
          </div>
        )}
        {(member.cooldowns?.booster || 0) > 0 && (
          <div className="flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-500/10 border border-indigo-500/30" title="Boost CD">
            <span className="text-[8px] font-black text-indigo-400">B</span>
            <span className="text-[9px] font-mono font-bold text-indigo-300">
              {member.cooldowns.booster >= 3600 ? `${Math.floor(member.cooldowns.booster / 3600)}h ` : ''}
              {Math.floor((member.cooldowns.booster % 3600) / 60)}m
            </span>
          </div>
        )}
        {!(member.cooldowns?.drug > 0 || member.cooldowns?.medical > 0 || member.cooldowns?.booster > 0) && (
          <span className="text-[10px] text-zinc-700 tracking-tighter uppercase font-black">No Data</span>
        )}
      </div>

      {/* Refill Column */}
      <div className="col-span-1 flex justify-end">
        <div className={`w-5 h-5 rounded-md flex items-center justify-center text-[8px] font-bold border transition-all ${member.refill_used
          ? 'bg-zinc-800 border-white/5 text-zinc-600'
          : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.1)]'
          }`} title={member.refill_used ? 'Refill Used' : 'Refill Ready'}>
          R
        </div>
      </div>
    </div>
  );
};
