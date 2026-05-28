import { useState, useRef, useEffect } from 'react';

export interface SelectOption {
  value: string;
  label: string;
}

export interface SelectGroup {
  label: string;
  options: SelectOption[];
}

interface CustomSelectProps {
  value: string;
  onChange: (value: string) => void;
  groups?: SelectGroup[];
  options?: SelectOption[];
  placeholder?: string;
}

export function CustomSelect({ value, onChange, groups, options, placeholder }: CustomSelectProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const allOptions = groups 
    ? groups.flatMap(g => g.options)
    : (options || []);

  const selectedOption = allOptions.find(o => o.value === value);

  return (
    <div className="relative group" ref={containerRef}>
      <div 
        className="bg-zinc-900 border border-white/20 rounded-xl p-3 text-sm font-mono font-bold text-zinc-100 cursor-pointer hover:border-indigo-500/80 flex justify-between items-center transition-all shadow-md group-hover:shadow-[0_0_12px_rgba(99,102,241,0.15)]"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder || 'Select...'}</span>
        <svg className={`w-4 h-4 text-zinc-350 transition-transform ${isOpen ? 'rotate-180' : ''} group-hover:text-indigo-400`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-zinc-950 border border-white/20 rounded-xl shadow-[0_20px_50px_rgba(0,0,0,0.8)] overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200 backdrop-blur-md">
          <div className="max-h-60 overflow-y-auto custom-scrollbar p-1.5 bg-zinc-900/95">
            {groups ? (
              groups.map((group, i) => (
                <div key={i} className="mb-3 last:mb-0">
                  <div className="px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.15em] text-indigo-450 bg-indigo-500/10 border-l-2 border-indigo-500 rounded-r-md mb-1.5 mx-1 mt-1">
                    {group.label}
                  </div>
                  {group.options.map(opt => (
                    <div
                      key={opt.value}
                      className={`px-3 py-2 text-sm font-mono rounded-lg cursor-pointer transition-all ${value === opt.value ? 'bg-indigo-650/30 text-indigo-200 border-l-2 border-indigo-400 font-bold shadow-[inset_0_0_10px_rgba(99,102,241,0.15)]' : 'text-zinc-200 hover:bg-zinc-800/80 hover:text-white'}`}
                      onClick={() => {
                        onChange(opt.value);
                        setIsOpen(false);
                      }}
                    >
                      {opt.label}
                    </div>
                  ))}
                </div>
              ))
            ) : (
              options?.map(opt => (
                <div
                  key={opt.value}
                  className={`px-3 py-2 text-sm font-mono rounded-lg cursor-pointer transition-all ${value === opt.value ? 'bg-indigo-650/30 text-indigo-200 border-l-2 border-indigo-400 font-bold shadow-[inset_0_0_10px_rgba(99,102,241,0.15)]' : 'text-zinc-200 hover:bg-zinc-800/80 hover:text-white'}`}
                  onClick={() => {
                    onChange(opt.value);
                    setIsOpen(false);
                  }}
                >
                  {opt.label}
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
