import React from 'react'
import { useDashboardStore } from '../hooks/useDashboardStore'

export const MemberGrid: React.FC = () => {
  const members = useDashboardStore((state) => state.members);
  const globalSelectedMembers = useDashboardStore((state) => state.globalSelectedMembers);
  const filters = useDashboardStore((state) => state.filters);

  const processedMembers = Object.values(members)
    .filter(m => {
      if (filters.hideOffline && m.last_action?.status !== 'Online') return false;
      if (filters.hideHospital && m.status?.state === 'Hospital') return false;
      return true;
    })
    .sort((a, b) => {
    if (filters.sortByPower) {
      // 1. 状态优先级：Online (0) > Idle (1) > Offline (2)
      const getStatusWeight = (m: any) => {
        const s = m.last_action?.status;
        if (s === 'Online') return 0;
        if (s === 'Idle') return 1;
        return 2;
      };

      const statusDiff = getStatusWeight(a) - getStatusWeight(b);
      if (statusDiff !== 0) return statusDiff;

      // 2. 如果状态相同，看最后活跃秒数 (小的在前)
      const secA = a.last_action?.seconds ?? 999999;
      const secB = b.last_action?.seconds ?? 999999;
      if (secA !== secB) return secA - secB;

      // 3. 如果还是相同，能量高的在前
      return (b.energy || 0) - (a.energy || 0);
    }
      
      // 默认排序：在线状态优先
      if (a.last_action?.status === 'Online' && b.last_action?.status !== 'Online') return -1;
      if (a.last_action?.status !== 'Online' && b.last_action?.status === 'Online') return 1;
      return 0;
    });

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-2 md:gap-4 p-2 md:p-4">
      {processedMembers.map((member) => (
        <MemberCard 
          key={member.id} 
          member={member} 
          isSelected={globalSelectedMembers.includes(member.id)}
        />
      ))}
    </div>
  );
};

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
