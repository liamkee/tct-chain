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
    <div className="relative" ref={containerRef}>
      <div 
        className="bg-zinc-950 border border-white/10 rounded-xl p-3 text-sm font-mono cursor-pointer hover:border-indigo-500/50 flex justify-between items-center transition-colors"
        onClick={() => setIsOpen(!isOpen)}
      >
        <span className="truncate">{selectedOption ? selectedOption.label : placeholder || 'Select...'}</span>
        <svg className={`w-4 h-4 text-zinc-500 transition-transform ${isOpen ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </div>

      {isOpen && (
        <div className="absolute z-50 w-full mt-2 bg-zinc-900 border border-white/10 rounded-xl shadow-2xl overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="max-h-60 overflow-y-auto custom-scrollbar p-1">
            {groups ? (
              groups.map((group, i) => (
                <div key={i} className="mb-2 last:mb-0">
                  <div className="px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-indigo-500/70 bg-black/40 rounded-md mb-1 mx-1 mt-1">
                    {group.label}
                  </div>
                  {group.options.map(opt => (
                    <div
                      key={opt.value}
                      className={`px-3 py-2 text-sm font-mono rounded-lg cursor-pointer transition-colors ${value === opt.value ? 'bg-indigo-500/20 text-indigo-300' : 'text-zinc-300 hover:bg-white/5 hover:text-white'}`}
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
                  className={`px-3 py-2 text-sm font-mono rounded-lg cursor-pointer transition-colors ${value === opt.value ? 'bg-indigo-500/20 text-indigo-300' : 'text-zinc-300 hover:bg-white/5 hover:text-white'}`}
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
