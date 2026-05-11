import React from 'react'
import { useDashboardStore } from '../hooks/useDashboardStore'
import { useTctSocket } from '../hooks/useTctSocket'

export const MemberListView: React.FC<{ resetTimer: string }> = ({ resetTimer }) => {
  const masterSwitch = useDashboardStore((state) => state.masterSwitch);
  const members = useDashboardStore((state) => state.members);
  const globalSelectedMembers = useDashboardStore((state) => state.globalSelectedMembers);
  const { filters, toggleFilter, setSort } = useDashboardStore();
  const { sendCommand } = useTctSocket();

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
        <span className={`absolute top-0 text-[7px] transition-all duration-300 ${filters.sortOrder === 'asc'
          ? 'text-indigo-400 opacity-100 scale-110'
          : 'text-zinc-600 opacity-20'
          }`}>▲</span>
        <span className={`absolute bottom-0 text-[7px] transition-all duration-300 ${filters.sortOrder === 'desc'
          ? 'text-indigo-400 opacity-100 scale-110'
          : 'text-zinc-600 opacity-20'
          }`}>▼</span>
      </span>
    );
  };

  const controls = (
    <div className="flex items-center justify-center gap-3 mb-6 px-4 md:px-6">
      <FilterButton
        active={filters.hideOffline}
        onClick={() => {
          const next = !filters.hideOffline;
          toggleFilter('hideOffline');
          sendCommand('UPDATE_CALC_SETTINGS', { settings: { hideOffline: next } });
        }}
        label="HIDE OFFLINE"
      />
      <FilterButton
        active={filters.hideHospital}
        onClick={() => {
          const next = !filters.hideHospital;
          toggleFilter('hideHospital');
          sendCommand('UPDATE_CALC_SETTINGS', { settings: { hideHospital: next } });
        }}
        label="HIDE IN HOSP"
      />
      <FilterButton
        active={filters.hideTraveling}
        onClick={() => {
          const next = !filters.hideTraveling;
          toggleFilter('hideTraveling');
          sendCommand('UPDATE_CALC_SETTINGS', { settings: { hideTraveling: next } });
        }}
        label="HIDE TRAVELING"
      />
    </div>
  );

  return (
    <div className="flex flex-col">
      {controls}
      <div className="flex flex-col gap-1 p-2 md:p-4">
        {/* Interactive Header Row */}
        <div className="flex items-center px-4 py-3 text-[11px] font-black uppercase tracking-[0.2em] text-zinc-500 border-b border-white/5 mb-2 bg-zinc-900/40 rounded-t-xl">
          <button
            onClick={() => setSort('name')}
            className={`w-[200px] flex-shrink-0 text-left hover:text-zinc-300 transition-colors flex items-center gap-1 ${filters.sortBy === 'name' ? 'text-indigo-400' : ''}`}
          >
            Personnel {getSortIcon('name')}
          </button>
          <button
            onClick={() => setSort('status')}
            className={`w-[100px] flex-shrink-0 text-center hover:text-zinc-300 transition-colors flex items-center justify-center gap-1 ${filters.sortBy === 'status' ? 'text-indigo-400' : ''}`}
          >
            Status {getSortIcon('status')}
          </button>
          <button
            onClick={() => setSort('activity')}
            className={`w-[100px] flex-shrink-0 text-center hover:text-zinc-300 transition-colors flex items-center justify-center gap-1 ${filters.sortBy === 'activity' ? 'text-indigo-400' : ''}`}
          >
            Activity {getSortIcon('activity')}
          </button>
          <button
            onClick={() => setSort('power')}
            className={`flex-1 text-center hover:text-zinc-300 transition-colors flex items-center justify-center gap-1 ${filters.sortBy === 'power' ? 'text-indigo-400' : ''}`}
          >
            Energy {getSortIcon('power')}
          </button>
          <div className="w-[260px] flex-shrink-0 text-center opacity-50 cursor-default">Cooldowns</div>
          <button
            onClick={() => setSort('refill')}
            className={`w-[80px] flex-shrink-0 text-right hover:text-zinc-300 transition-colors flex items-center justify-end gap-1 ${filters.sortBy === 'refill' ? 'text-indigo-400' : ''}`}
          >
            Refill {getSortIcon('refill')}
          </button>
          <div className="w-[60px] flex-shrink-0 text-right opacity-50 cursor-default" />
        </div>

        {processedMembers.map((member) => (
          <MemberRow
            key={member.id}
            member={member}
            isSelected={globalSelectedMembers.includes(member.id)}
            resetTimer={resetTimer}
          />
        ))}
        {processedMembers.length === 0 && (
          <div className="py-20 text-center flex flex-col items-center gap-4">
            <div className="w-12 h-12 rounded-full bg-zinc-900 flex items-center justify-center border border-white/5 text-zinc-600 animate-pulse">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            </div>
            <span className="text-zinc-600 font-bold uppercase tracking-widest text-xs">No matching members detected</span>
          </div>
        )}
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

const MemberRow: React.FC<{ member: any, isSelected: boolean, resetTimer: string }> = ({ member, isSelected, resetTimer }) => {
  const statusColor = member.status?.state === 'Okay' ? 'text-emerald-400' :
    member.status?.state === 'Hospital' ? 'text-rose-400' :
      member.status?.state === 'Traveling' ? 'text-blue-400' : 'text-amber-400';

  const onlineColor = member.last_action?.status === 'Online' ? 'text-green-400' :
    member.last_action?.status === 'Idle' ? 'text-amber-400' :
      member.last_action?.status === 'Traveling' ? 'text-blue-400' : 'text-zinc-500';

  return (
    <div className={`flex items-center px-4 py-2.5 rounded-xl border border-white/5 bg-zinc-900/20 hover:bg-zinc-800/40 transition-all group ${isSelected ? 'ring-1 ring-indigo-500/50 bg-indigo-500/5' : ''}`}>
      {/* Personnel */}
      <div className="w-[200px] flex-shrink-0 flex items-center gap-3 overflow-hidden">
        <div className="flex flex-col min-w-0">
          <span className="font-bold text-zinc-100 truncate text-sm tracking-tight">{member.name}</span>
          <span className="text-[9px] text-zinc-600 font-mono tabular-nums">#{member.id}</span>
        </div>
      </div>

      {/* Life Status */}
      <div className="w-[100px] flex-shrink-0 flex flex-col items-center justify-center gap-1">
        <div className={`h-1 w-1 rounded-full ${member.status?.state === 'Okay' ? 'bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.4)]' :
          member.status?.state === 'Hospital' ? 'bg-rose-500' :
            member.status?.state === 'Traveling' ? 'bg-blue-500' : 'bg-amber-500'
          }`} />
        <span className={`text-[10px] font-black uppercase tracking-tighter truncate ${statusColor}`}>{member.status?.state}</span>
      </div>

      {/* Activity */}
      <div className="w-[100px] flex-shrink-0 flex items-center justify-center">
        <span className={`text-[10px] font-black uppercase tracking-widest ${onlineColor}`}>{member.last_action?.status}</span>
      </div>

      {/* Energy */}
      <div className="flex-1 flex items-center gap-4 px-4">
        <div className="flex-1 h-1.5 bg-zinc-800/50 rounded-full overflow-hidden border border-white/5 relative">
          <div
            className={`h-full transition-all duration-1000 ${(member.is_pending || (!member.last_updated && !member.has_api)) ? 'bg-zinc-800' : member.energy_predicted ? 'bg-indigo-500 shadow-[0_0_12px_rgba(99,102,241,0.3)]' : 'bg-emerald-500/80 shadow-[0_0_12px_rgba(16,185,129,0.2)]'}`}
            style={{ width: `${(member.is_pending || (!member.last_updated && !member.has_api)) ? '0%' : Math.min(100, ((member.energy || 0) / (member.energy_max || 100)) * 100)}%` }}
          />
        </div>
        <div className="min-w-[65px] text-right">
          <span className={`text-[10px] font-black font-mono tabular-nums ${(member.is_pending || (!member.last_updated && !member.has_api)) ? 'text-zinc-800' : member.energy_predicted ? 'text-indigo-400' : 'text-zinc-500'}`}>
            {(member.is_pending || (!member.last_updated && !member.has_api)) ? '--' : member.energy || 0}<span className="text-zinc-700 mx-0.5">/</span>{member.energy_max || 100}
          </span>
        </div>
      </div>

      {/* Cooldowns */}
      <div className="w-[260px] flex-shrink-0 flex items-center justify-center gap-2">
        {(member.cooldowns?.drug || 0) > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-orange-500/5 border border-orange-500/20 shadow-inner" title="Drug CD">
            <span className="text-[9px] font-black text-orange-500/80">D</span>
            <span className="text-[10px] font-mono font-bold text-orange-400 tabular-nums">
              {member.cooldowns.drug >= 3600 ? `${Math.floor(member.cooldowns.drug / 3600)}h ` : ''}
              {Math.floor((member.cooldowns.drug % 3600) / 60)}m
            </span>
          </div>
        )}
        {(member.cooldowns?.medical || 0) > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-rose-500/5 border border-rose-500/20 shadow-inner" title="Med CD">
            <span className="text-[9px] font-black text-rose-500/80">M</span>
            <span className="text-[10px] font-mono font-bold text-rose-400 tabular-nums">
              {member.cooldowns.medical >= 3600 ? `${Math.floor(member.cooldowns.medical / 3600)}h ` : ''}
              {Math.floor((member.cooldowns.medical % 3600) / 60)}m
            </span>
          </div>
        )}
        {(member.cooldowns?.booster || 0) > 0 && (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-indigo-500/5 border border-indigo-500/20 shadow-inner" title="Boost CD">
            <span className="text-[9px] font-black text-indigo-500/80">B</span>
            <span className="text-[10px] font-mono font-bold text-indigo-400 tabular-nums">
              {member.cooldowns.booster >= 3600 ? `${Math.floor(member.cooldowns.booster / 3600)}h ` : ''}
              {Math.floor((member.cooldowns.booster % 3600) / 60)}m
            </span>
          </div>
        )}
        {(member.is_pending || (!member.last_updated && !member.has_api)) && (
          <span className="text-[10px] text-rose-500/50 font-black uppercase tracking-widest animate-pulse">No Data</span>
        )}
        {member.has_api && !member.last_updated && (
          <span className="text-[10px] text-zinc-800 font-black uppercase tracking-tighter opacity-30 italic">Syncing...</span>
        )}
        {member.last_updated && !(member.cooldowns?.drug > 0 || member.cooldowns?.medical > 0 || member.cooldowns?.booster > 0) && (
          <div className="h-6 flex items-center">
            <span className="text-[10px] text-zinc-500 font-black uppercase tracking-[0.2em] opacity-40">Ready</span>
          </div>
        )}
      </div>

      {/* Refill Column */}
      <div className="w-[80px] flex-shrink-0 flex justify-end items-center px-2">
        {(member.is_pending || (!member.last_updated && !member.has_api)) ? (
          <span className="text-[10px] text-rose-500/50 font-black uppercase tracking-widest animate-pulse">No Data</span>
        ) : !member.last_updated ? (
          <div className="w-1.5 h-1.5 rounded-full bg-zinc-800 animate-pulse" />
        ) : !member.refill_used ? (
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-lg bg-emerald-500/5 border border-emerald-500/20 group-hover:border-emerald-500/40 transition-colors" title="Refill Ready">
            <span className="text-[9px] font-black text-emerald-500">R</span>
            <span className="text-[10px] font-mono font-bold text-emerald-400 tabular-nums">
              {(() => {
                const [h, m] = resetTimer.split(':').map(Number);
                return h > 0 ? `${h}h` : `${m}m`;
              })()}
            </span>
          </div>
        ) : (
          <div className="w-6 h-6 rounded bg-zinc-900/50 flex items-center justify-center text-[9px] font-bold border border-white/5 text-zinc-700" title="Refill Used">
            R
          </div>
        )}
      </div>

      {/* Empty space for alignment */}
      <div className="w-[60px] flex-shrink-0" />
    </div>
  );
};
