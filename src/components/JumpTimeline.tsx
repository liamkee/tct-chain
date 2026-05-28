import React, { useState, useEffect, useMemo } from 'react';
import { DndContext, useDraggable, useDroppable } from '@dnd-kit/core';
import type { DragEndEvent, CollisionDetection, Modifier } from '@dnd-kit/core';
import type { JumpConfig } from '../services/jumpCalculator';
import { TORN_ITEMS } from '../constants/items';
import { restrictToWindowEdges, restrictToHorizontalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';

export interface JumpTimelineProps {
  config: JumpConfig['items'];
  maxEnergy: number;
  naturalEnergyPerDay: number;
  totalGain?: number;
  finalStat?: number;
  totalCost?: number;
  yield24h?: { gain24h: number; cost24h: number } | null;
  statType?: string;
}

export interface TimelineBlockData {
  id: string;
  type: 'drug' | 'booster' | 'action' | 'sleep' | 'natural';
  label: string;
  durationMins: number; // width essentially
  offsetMins: number | null; // null = in library
}

const restrictVerticalToContainer: Modifier = ({
  transform,
  activeNodeRect,
}) => {
  const container = document.getElementById('dnd-timeline-container');
  if (!container || !activeNodeRect) {
    return transform;
  }
  
  const containerRect = container.getBoundingClientRect();
  const minTop = containerRect.top;
  const maxBottom = containerRect.bottom;
  const currentTop = activeNodeRect.top + transform.y;
  const currentBottom = activeNodeRect.bottom + transform.y;
  
  let newY = transform.y;
  
  if (currentTop < minTop) {
    newY += minTop - currentTop;
  } else if (currentBottom > maxBottom) {
    newY -= currentBottom - maxBottom;
  }
  
  return {
    ...transform,
    y: newY,
  };
};

const customDynamicModifier: Modifier = (args) => {
  const { active } = args;
  const blockData = active?.data?.current as TimelineBlockData | undefined;
  
  // If the block is already placed in the timeline, lock it horizontally
  if (blockData && blockData.offsetMins !== null) {
    return restrictToHorizontalAxis(args);
  }
  
  // If it's in the library, allow it to be dragged down, but restricted to the container
  return restrictVerticalToContainer(args);
};

function DraggableBlock({ 
  block,
  actionIndex = 0,
  totalActions = 1,
  trackIndex = 0,
  totalTracks = 3
}: { 
  block: TimelineBlockData;
  actionIndex?: number;
  totalActions?: number;
  trackIndex?: number;
  totalTracks?: number;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: block.id,
    data: block
  });

  const [resizeDelta, setResizeDelta] = useState(0);
  const [isResizing, setIsResizing] = useState(false);

  const isAction = block.type === 'action';
  const isDrug = block.type === 'drug';
  const isBooster = block.type === 'booster';
  const isSleep = block.type === 'sleep';
  const isNatural = block.type === 'natural';

  const trackTop = `${trackIndex * 28 + 4}px`;
  const trackHeight = `${totalTracks * 28}px`;

  const baseWidth = block.offsetMins !== null ? (block.durationMins / 15) * 10 : 0;
  const currentWidth = baseWidth + resizeDelta;

  const style: React.CSSProperties = {
    transform: CSS.Translate.toString(transform),
    width: isAction && block.offsetMins !== null ? '2px' : (block.offsetMins !== null ? `${Math.max(40, currentWidth)}px` : 'auto'),
    minWidth: isAction ? (block.offsetMins !== null ? '2px' : 'auto') : (block.offsetMins !== null && block.durationMins === 0 ? '40px' : 'auto'),
    height: isAction && block.offsetMins !== null ? trackHeight : '24px',
    zIndex: isDragging || isResizing ? 50 : (isNatural ? 5 : 10),
    opacity: isDragging ? 0.8 : 1,
    top: isAction && block.offsetMins !== null ? '4px' : (block.offsetMins !== null ? trackTop : 'auto'),
  };

  const handleResizeStart = (e: React.PointerEvent) => {
    e.stopPropagation();
    setIsResizing(true);
    const startX = e.clientX;

    const onPointerMove = (ev: PointerEvent) => {
      setResizeDelta(ev.clientX - startX);
    };

    const onPointerUp = (ev: PointerEvent) => {
      const delta = ev.clientX - startX;
      setResizeDelta(0);
      setIsResizing(false);
      
      const newWidth = Math.max(40, baseWidth + delta);
      // 1 hour = 60 mins = 40px width
      const newHours = Math.max(0, Math.round(newWidth / 40));
      
      window.dispatchEvent(new CustomEvent('updateSleep', { detail: newHours }));

      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };

    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  // Action blocks on timeline render as a thin vertical line
  if (isAction && block.offsetMins !== null) {
    const slotStagger = ((block.offsetMins ?? 0) / 15) % 2 === 0 ? 0 : 14;
    const labelTop = -16 - (actionIndex * 12) - slotStagger;
    const displayLabel = block.label.startsWith('Train')
      ? 'Train'
      : (block.label === 'Point Refill' ? 'Refill' : block.label);

    return (
      <div
        ref={setNodeRef}
        style={style}
        {...listeners}
        {...attributes}
        className="absolute left-0 cursor-grab active:cursor-grabbing select-none"
        title={block.label}
      >
        <div className="w-[2px] h-full bg-yellow-400/80 shadow-[0_0_6px_rgba(250,204,21,0.4)]" />
        <div 
          style={{ top: `${labelTop}px` }}
          className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-[8px] font-bold text-yellow-400 uppercase tracking-wider transition-all duration-200"
        >
          {displayLabel}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      className={`absolute left-0 cursor-grab active:cursor-grabbing border flex items-center justify-center text-[10px] font-bold tracking-wider rounded overflow-hidden shadow-lg select-none ${isResizing ? '' : 'transition-[width] duration-200'} ${
        block.offsetMins === null ? 'relative mb-2 w-full !top-auto' : ''
      } ${
        isSleep ? 'bg-indigo-950/80 border-indigo-500/80 border-dashed text-indigo-200 backdrop-blur-sm shadow-[0_0_12px_rgba(99,102,241,0.15)]' :
        isDrug ? 'bg-rose-950/80 border-rose-500/80 text-rose-200 shadow-[0_0_12px_rgba(244,63,94,0.15)]' : 
        isBooster ? 'bg-cyan-950/80 border-cyan-500/80 text-cyan-200 shadow-[0_0_12px_rgba(6,182,212,0.15)]' :
        isNatural ? 'bg-emerald-950/60 border-emerald-500/60 text-emerald-200/80 border-dashed shadow-[0_0_12px_rgba(16,185,129,0.1)]' :
        'bg-yellow-950/80 border-yellow-500/80 text-yellow-200 shadow-[0_0_12px_rgba(234,179,8,0.15)]'
      }`}
      title={`${block.label} (${block.durationMins}m)`}
    >
      {isSleep ? (isResizing ? `Sleep (${Math.max(0, Math.round(currentWidth / 40))}h)` : block.label) : block.label}
      
      {isSleep && block.offsetMins !== null && (
        <div 
          className="absolute right-0 top-0 w-3 h-full cursor-col-resize hover:bg-indigo-400/20 border-l border-indigo-500/30 flex items-center justify-center group z-10"
          onPointerDown={handleResizeStart}
        >
          <div className="w-0.5 h-4 bg-indigo-500/50 group-hover:bg-indigo-400 rounded-full"></div>
        </div>
      )}
    </div>
  );
}

function DroppableSlot({ minOffset, children }: { minOffset: number, children: React.ReactNode }) {
  const { isOver, setNodeRef } = useDroppable({
    id: `slot-${minOffset}`,
    data: { minOffset }
  });

  const isHour = minOffset % 60 === 0;

  return (
    <div
      ref={setNodeRef}
      className={`w-[10px] h-full box-border relative flex items-end justify-center
        ${isOver ? 'bg-indigo-500/40' : 'bg-transparent'}
        ${isHour ? 'border-l border-white/20' : 'border-l border-white/5'}
      `}
    >
      {isHour && (
        <div className="absolute top-0 left-0 h-full border-l border-white/10 pointer-events-none" />
      )}
      {isHour && (
        <span className="absolute -bottom-5 -left-2 text-[9px] text-zinc-500 font-mono z-0 pointer-events-none">
          {minOffset / 60}h
        </span>
      )}
      {children}
    </div>
  );
}

const leftEdgeDetection: CollisionDetection = ({ droppableContainers, collisionRect }) => {
  if (!collisionRect) return [];

  let closestSlot = null;
  let minDistance = Infinity;

  for (const container of droppableContainers) {
    if (container.id === 'library') continue;

    if (container.rect.current) {
      // Find distance between the left edge of the dragging block and the left edge of the slot
      const distance = Math.abs(container.rect.current.left - collisionRect.left);
      
      // We also want to make sure the user is dragging somewhat horizontally near the timeline
      // But for simplicity, the closest left edge horizontally wins
      if (distance < minDistance) {
        minDistance = distance;
        closestSlot = container;
      }
    }
  }

  if (closestSlot && minDistance < 100) { // arbitrary threshold to snap
    return [{ id: closestSlot.id, data: closestSlot.data.current }];
  }

  return [];
};

function calculateAutoArrangeOffsets(
  blocksList: TimelineBlockData[],
  config: JumpConfig['items']
): { offsets: Record<string, number>; durations: Record<string, number> } {
  const isStacked = 
    config.ecstasy > 0 || 
    config.edvd > 0 || 
    config.truffles > 0 || 
    config.tootsie > 0 || 
    config.lollipop > 0 || 
    config.fhc > 0;
  const isDailyRoutine = config.xanax === 3 && config.refill === 1;

  if (isDailyRoutine) {
    const offsets: Record<string, number> = {};
    const durations: Record<string, number> = {};
    
    // Determine sleep duration from the actual sleep block
    const sleepBlock = blocksList.find(b => b.id === 'sleep-0');
    const sleepDurationMins = sleepBlock ? sleepBlock.durationMins : 480;
    
    // Phase 1: Sleep (T=0 → T=sleepDuration)
    // Natural energy accumulates during sleep → wake up with 150E
    offsets['sleep-0'] = 0;
    const wakeUpMins = sleepDurationMins;
    
    // natural-0 covers the sleep period: accumulating 150E while sleeping
    offsets['natural-0'] = 0;
    durations['natural-0'] = sleepDurationMins;
    // train-natural-0 = the first train after waking (before jump, using 150E natural)
    // But this overlaps with the jump train, so place it at wake-up
    if (blocksList.some(b => b.id === 'train-natural-0')) {
      offsets['train-natural-0'] = wakeUpMins;
    }
    
    // Phase 2: Wake up → pop Xanax #1 + 49 Choco + Ecstasy
    // 150E (natural) + 250E (xanax) = 400E, with boosted happy from choco+ecstasy
    offsets['xanax-0'] = wakeUpMins;
    
    // 49 choco (booster) at wake-up time
    blocksList.forEach(b => {
      if (b.type === 'booster') {
        offsets[b.id] = wakeUpMins;
      }
    });
    
    // Ecstasy at wake-up time (doubles happy)
    offsets['ecstasy-0'] = wakeUpMins;
    
    // Phase 3: Jump Train (train-0) at wake-up + 15m → train all 400E with boosted happy
    offsets['train-0'] = wakeUpMins + 15;
    
    // Phase 4: Point Refill after jump train
    offsets['refill-0'] = wakeUpMins + 15;
    
    // Phase 5: Train Refill 15m after point refill
    offsets['train-refill'] = wakeUpMins + 30;

    // Phase 6: Natural energy + remaining Xanax cycles
    // After jump+refill, continue with natural energy waits and 2 more xanax trains
    let currentNatTime = wakeUpMins + 30;
    
    // natural-1: wait for next 150E
    offsets['natural-1'] = currentNatTime;
    durations['natural-1'] = 300;
    currentNatTime += 300;
    offsets['train-natural-1'] = currentNatTime;
    
    // Xanax #2 at first CD expiry (wake + 420m)
    offsets['xanax-1'] = wakeUpMins + TORN_ITEMS.XANAX.cooldown.base;
    offsets['train-1'] = wakeUpMins + TORN_ITEMS.XANAX.cooldown.base + 15;
    
    // natural-2: wait for next 150E  
    offsets['natural-2'] = currentNatTime;
    durations['natural-2'] = 300;
    currentNatTime += 300;
    offsets['train-natural-2'] = currentNatTime;
    
    // Xanax #3 at second CD expiry (wake + 840m)
    offsets['xanax-2'] = wakeUpMins + (TORN_ITEMS.XANAX.cooldown.base * 2);
    offsets['train-2'] = wakeUpMins + (TORN_ITEMS.XANAX.cooldown.base * 2) + 15;
    
    // natural-3: wait for next 150E
    offsets['natural-3'] = currentNatTime;
    durations['natural-3'] = 300;
    currentNatTime += 300;
    offsets['train-natural-3'] = currentNatTime;
    
    return { offsets, durations };
  }

  let currentDrugMins = 0;
  const offsets: Record<string, number> = {};
  const durations: Record<string, number> = {};

  // 1. Xanax
  const xanaxBlocks = blocksList.filter(b => b.id.startsWith('xanax-')).sort((a, b) => a.id.localeCompare(b.id));
  xanaxBlocks.forEach(b => {
    offsets[b.id] = currentDrugMins;
    currentDrugMins += b.durationMins;
  });

  // 2. Boosters
  blocksList.forEach(b => {
    if (b.type === 'booster') {
      offsets[b.id] = currentDrugMins;
    }
  });

  // 3. Ecstasy
  if (blocksList.some(b => b.id.startsWith('ecstasy-'))) {
    offsets['ecstasy-0'] = currentDrugMins;
  }

  // 4. Train Stack / Train 250E
  if (isStacked) {
    if (blocksList.some(b => b.id === 'train-0')) {
      offsets['train-0'] = currentDrugMins + 15;
    }
  } else {
    const trainCount = blocksList.filter(b => b.id.startsWith('train-') && !b.id.startsWith('train-natural-') && b.id !== 'train-refill').length;
    for (let i = 0; i < trainCount; i++) {
      offsets[`train-${i}`] = (i * TORN_ITEMS.XANAX.cooldown.base) + 15;
    }
  }

  // 5. Refills
  if (blocksList.some(b => b.id === 'refill-0')) {
    offsets['refill-0'] = currentDrugMins + 15;
  }
  if (blocksList.some(b => b.id === 'train-refill')) {
    offsets['train-refill'] = currentDrugMins + 30;
  }

  // 6. Sleep
  let sleepStart = null;
  let sleepEnd = null;
  const sleepBlock = blocksList.find(b => b.id === 'sleep-0');
  if (sleepBlock) {
    const hasRefill = blocksList.some(b => b.id === 'refill-0');
    sleepStart = currentDrugMins + (hasRefill ? 45 : 15);
    sleepEnd = sleepStart + sleepBlock.durationMins;
    offsets['sleep-0'] = sleepStart;
  }

  // 7. Natural energy & Natural Train blocks
  if (!isStacked) {
    let currentNatTime = 0;
    const naturalBlocks = blocksList.filter(b => b.id.startsWith('natural-')).sort((a, b) => {
      const idxA = parseInt(a.id.split('-')[1]);
      const idxB = parseInt(b.id.split('-')[1]);
      return idxA - idxB;
    });

    naturalBlocks.forEach(natBlock => {
      const index = parseInt(natBlock.id.split('-')[1]);
      const trainBlockId = `train-natural-${index}`;

      const natStart = currentNatTime;
      let trainStart = natStart + 300;

      if (sleepStart !== null && sleepEnd !== null) {
        if (trainStart > sleepStart && trainStart < sleepEnd) {
          trainStart = sleepEnd;
        }
      }

      offsets[natBlock.id] = natStart;
      durations[natBlock.id] = trainStart - natStart;

      if (blocksList.some(b => b.id === trainBlockId)) {
        offsets[trainBlockId] = trainStart;
      }

      currentNatTime = trainStart;
    });
  }

  return { offsets, durations };
}

function adjustNaturalBlocksAndSleepConstraints(
  blocksList: TimelineBlockData[]
): TimelineBlockData[] {
  let newBlocks = blocksList.map(b => ({ ...b }));

  const sleepBlock = newBlocks.find(b => b.id === 'sleep-0');
  const sleepStart = sleepBlock?.offsetMins;
  const sleepEnd = sleepBlock && sleepStart !== null && sleepStart !== undefined ? sleepStart + sleepBlock.durationMins : null;

  // Filter and sort placed natural blocks
  let placedNatural = newBlocks.filter(b => b.id.startsWith('natural-') && b.offsetMins !== null).sort((a, b) => {
    const idxA = parseInt(a.id.split('-')[1]);
    const idxB = parseInt(b.id.split('-')[1]);
    return idxA - idxB;
  });

  if (placedNatural.length > 0) {
    let currentNatTime = placedNatural[0].offsetMins!;
    placedNatural = placedNatural.map(natBlock => {
      const index = parseInt(natBlock.id.split('-')[1]);
      const trainBlockId = `train-natural-${index}`;

      const natStart = currentNatTime;
      let trainStart = natStart + 300;

      if (sleepStart !== null && sleepStart !== undefined && sleepEnd !== null) {
        if (trainStart > sleepStart && trainStart < sleepEnd) {
          trainStart = sleepEnd;
        }
      }

      const newDuration = trainStart - natStart;
      
      // update the train block in newBlocks if it exists
      const trainBlockIdx = newBlocks.findIndex(b => b.id === trainBlockId);
      if (trainBlockIdx !== -1 && newBlocks[trainBlockIdx].offsetMins !== null) {
        newBlocks[trainBlockIdx].offsetMins = trainStart;
      }

      currentNatTime = trainStart;
      return {
        ...natBlock,
        offsetMins: natStart,
        durationMins: newDuration
      };
    });

    // Write the updated natural blocks back to newBlocks
    newBlocks = newBlocks.map(block => {
      const updatedNat = placedNatural.find(b => b.id === block.id);
      if (updatedNat) {
        return updatedNat;
      }
      return block;
    });
  }

  // Also ensure no other block is starting inside sleep (except natural)
  if (sleepStart !== null && sleepStart !== undefined && sleepEnd !== null) {
    newBlocks = newBlocks.map(block => {
      if (block.id !== 'sleep-0' && block.offsetMins !== null) {
        if (block.type !== 'natural') {
          if (block.offsetMins > sleepStart && block.offsetMins < sleepEnd) {
            return { ...block, offsetMins: sleepEnd };
          }
        }
      }
      return block;
    });
  }

  // Force alignment to the absolute left (shift to eliminate leading blank space)
  const placedBlocks = newBlocks.filter(b => b.offsetMins !== null);
  if (placedBlocks.length > 0) {
    const minOffset = Math.min(...placedBlocks.map(b => b.offsetMins!));
    if (minOffset > 0) {
      newBlocks = newBlocks.map(b => {
        if (b.offsetMins !== null) {
          return { ...b, offsetMins: b.offsetMins - minOffset };
        }
        return b;
      });
    }
  }

  return newBlocks;
}

function enforceTimelineAnchors(
  blocksList: TimelineBlockData[],
  config: JumpConfig['items']
): TimelineBlockData[] {
  let newBlocks = blocksList.map(b => ({ ...b }));
  const isStacked = 
    config.ecstasy > 0 || 
    config.edvd > 0 || 
    config.truffles > 0 || 
    config.tootsie > 0 || 
    config.lollipop > 0 || 
    config.fhc > 0;
  const isDailyRoutine = config.xanax === 3 && config.refill === 1;

  // Calculate the end of the Xanax stack
  const placedXanax = newBlocks.filter(b => b.id.startsWith('xanax-') && b.offsetMins !== null);
  let xanaxStackEnd = 0;
  placedXanax.forEach(x => {
    const end = x.offsetMins! + x.durationMins;
    if (end > xanaxStackEnd) {
      xanaxStackEnd = end;
    }
  });

  if (isDailyRoutine) {
    const sleepBlock = newBlocks.find(b => b.id === 'sleep-0');
    const sleepDuration = sleepBlock ? sleepBlock.durationMins : 480;
    const wakeUpMins = (sleepBlock && sleepBlock.offsetMins !== null) ? (sleepBlock.offsetMins + sleepBlock.durationMins) : sleepDuration;

    // Point Refill (refill-0) should be at wakeUpMins + 15
    const refill0 = newBlocks.find(b => b.id === 'refill-0');
    if (refill0 && refill0.offsetMins !== null) {
      refill0.offsetMins = wakeUpMins + 15;
    }

    // Train Refill (train-refill) should be at wakeUpMins + 30
    const trainRefill = newBlocks.find(b => b.id === 'train-refill');
    if (trainRefill && trainRefill.offsetMins !== null) {
      trainRefill.offsetMins = wakeUpMins + 30;
    }

    // Xanax and corresponding Train blocks:
    // xanax-0 is at wakeUpMins
    // xanax-1 is at wakeUpMins + 420
    // xanax-2 is at wakeUpMins + 840
    // train-0 is at wakeUpMins + 15 (jump train)
    // train-1 is at xanax-1 + 15
    // train-2 is at xanax-2 + 15
    newBlocks = newBlocks.map(b => {
      if (b.id.startsWith('xanax-') && b.offsetMins !== null) {
        const index = parseInt(b.id.split('-')[1]);
        if (index === 0) {
          return { ...b, offsetMins: wakeUpMins };
        } else if (index === 1) {
          return { ...b, offsetMins: wakeUpMins + TORN_ITEMS.XANAX.cooldown.base };
        } else if (index === 2) {
          return { ...b, offsetMins: wakeUpMins + (TORN_ITEMS.XANAX.cooldown.base * 2) };
        }
      }
      if (b.id.startsWith('train-') && !b.id.startsWith('train-natural-') && b.id !== 'train-refill' && b.offsetMins !== null) {
        const index = parseInt(b.id.split('-')[1]);
        if (index === 0) {
          return { ...b, offsetMins: wakeUpMins + 15 };
        } else {
          const xanaxBlock = newBlocks.find(x => x.id === `xanax-${index}`);
          if (xanaxBlock && xanaxBlock.offsetMins !== null) {
            return { ...b, offsetMins: xanaxBlock.offsetMins + 15 };
          }
        }
      }
      return b;
    });

    // Boosters should start at wakeUpMins
    newBlocks = newBlocks.map(b => {
      if (b.type === 'booster' && b.offsetMins !== null) {
        return { ...b, offsetMins: wakeUpMins };
      }
      return b;
    });
  } else if (isStacked) {
    // Ecstasy should start at or after the Xanax stack ends
    const ecstasyBlock = newBlocks.find(b => b.id === 'ecstasy-0');
    if (ecstasyBlock && ecstasyBlock.offsetMins !== null && !isDailyRoutine) {
      if (ecstasyBlock.offsetMins < xanaxStackEnd) {
        ecstasyBlock.offsetMins = xanaxStackEnd;
      }
    }

    const anchorTime = (ecstasyBlock && ecstasyBlock.offsetMins !== null) ? ecstasyBlock.offsetMins : xanaxStackEnd;

    // Boosters must start exactly when Ecstasy starts (anchorTime) so their happy multiplier doubles correctly
    newBlocks = newBlocks.map(b => {
      if (b.type === 'booster' && b.offsetMins !== null) {
        return { ...b, offsetMins: anchorTime };
      }
      return b;
    });
    
    // Train Stack (train-0)
    const train0 = newBlocks.find(b => b.id === 'train-0');
    if (train0 && train0.offsetMins !== null) {
      train0.offsetMins = anchorTime + 15;
    }

    // Point Refill (refill-0)
    const refill0 = newBlocks.find(b => b.id === 'refill-0');
    if (refill0 && refill0.offsetMins !== null) {
      refill0.offsetMins = anchorTime + 15;
    }

    // Train Refill (train-refill)
    const trainRefill = newBlocks.find(b => b.id === 'train-refill');
    if (trainRefill && trainRefill.offsetMins !== null) {
      trainRefill.offsetMins = anchorTime + 30;
    }
  } else {
    // Non-stacked: train-i = xanax-i + 15 mins
    newBlocks = newBlocks.map(b => {
      if (b.id.startsWith('train-') && !b.id.startsWith('train-natural-') && b.id !== 'train-refill' && b.offsetMins !== null) {
        const index = parseInt(b.id.split('-')[1]);
        const xanaxBlock = newBlocks.find(x => x.id === `xanax-${index}`);
        if (xanaxBlock && xanaxBlock.offsetMins !== null) {
          return { ...b, offsetMins: xanaxBlock.offsetMins + 15 };
        }
      }
      return b;
    });

    // Point Refill & Train Refill
    const refill0 = newBlocks.find(b => b.id === 'refill-0');
    if (refill0 && refill0.offsetMins !== null) {
      refill0.offsetMins = xanaxStackEnd + 15;
    }

    const trainRefill = newBlocks.find(b => b.id === 'train-refill');
    if (trainRefill && trainRefill.offsetMins !== null) {
      trainRefill.offsetMins = xanaxStackEnd + 30;
    }
  }

  return newBlocks;
}

function resolveCascadePushes(
  blocksList: TimelineBlockData[],
  activeId: string,
  config: JumpConfig['items']
): TimelineBlockData[] {
  let newBlocks = blocksList.map(b => ({ ...b }));

  const sleepBlock = newBlocks.find(b => b.id === 'sleep-0');
  const sleepStart = sleepBlock?.offsetMins;
  const sleepEnd = sleepBlock && sleepStart !== null && sleepStart !== undefined ? sleepStart + sleepBlock.durationMins : null;

  // 1. Sleep constraints: push any non-sleep, non-natural block starting inside sleep to wake up
  if (sleepStart !== null && sleepStart !== undefined && sleepEnd !== null) {
    newBlocks = newBlocks.map(block => {
      if (block.id !== 'sleep-0' && block.offsetMins !== null) {
        if (block.type !== 'natural') {
          if (block.offsetMins >= sleepStart && block.offsetMins < sleepEnd) {
            return { ...block, offsetMins: sleepEnd };
          }
        }
      }
      return block;
    });
  }

  // 2. Resolve drug-drug overlaps with a forward cascade push
  const placedDrugs = newBlocks.filter(b => b.type === 'drug' && b.offsetMins !== null);
  if (placedDrugs.length > 0) {
    placedDrugs.sort((a, b) => a.offsetMins! - b.offsetMins!);

    for (let i = 1; i < placedDrugs.length; i++) {
      const prevDrug = placedDrugs[i - 1];
      const currDrug = placedDrugs[i];
      const prevEnd = prevDrug.offsetMins! + prevDrug.durationMins;
      
      if (currDrug.offsetMins! < prevEnd) {
        currDrug.offsetMins = prevEnd;
        
        // Re-enforce sleep constraint if pushed into sleep
        if (sleepStart !== null && sleepStart !== undefined && sleepEnd !== null) {
          if (currDrug.offsetMins! >= sleepStart && currDrug.offsetMins! < sleepEnd) {
            currDrug.offsetMins = sleepEnd;
          }
        }
      }
    }

    // Write back
    newBlocks = newBlocks.map(block => {
      const updatedDrug = placedDrugs.find(b => b.id === block.id);
      if (updatedDrug) {
        return updatedDrug;
      }
      return block;
    });
  }

  // 3. Enforce the chronological anchoring of Train Stack, Refill, and Boosters
  newBlocks = enforceTimelineAnchors(newBlocks, config);

  // 4. Dynamic natural blocks adjustment
  return adjustNaturalBlocksAndSleepConstraints(newBlocks);
}

export function JumpTimeline({ 
  config, 
  maxEnergy, 
  naturalEnergyPerDay,
  totalGain,
  finalStat,
  totalCost,
  yield24h,
  statType
}: JumpTimelineProps) {
  const [blocks, setBlocks] = useState<TimelineBlockData[]>([]);
  const [prevItemsKey, setPrevItemsKey] = useState<string>('');

  // Initialize blocks when config changes
  useEffect(() => {
    const arr: TimelineBlockData[] = [];
    
    // 1. Drugs (Xanax)
    for (let i = 0; i < config.xanax; i++) {
      arr.push({
        id: `xanax-${i}`,
        type: 'drug',
        label: 'Xanax',
        durationMins: TORN_ITEMS.XANAX.cooldown.base,
        offsetMins: null
      });
    }

    // 2. Boosters (consolidated with stacked cooldown duration)
    const addConsolidatedBoosters = (key: keyof typeof config, itemId: string) => {
      const count = config[key] as number;
      if (count > 0) {
        const item = TORN_ITEMS[itemId as keyof typeof TORN_ITEMS];
        arr.push({
          id: `${key}-0`,
          type: 'booster',
          label: count > 1 ? `${item.name} x${count}` : item.name,
          durationMins: item.cooldown.base * count,
          offsetMins: null
        });
      }
    };

    addConsolidatedBoosters('edvd', 'EDVD');
    addConsolidatedBoosters('truffles', 'TRUFFLES');
    addConsolidatedBoosters('tootsie', 'TOOTSIE_ROLLS');
    addConsolidatedBoosters('lollipop', 'LOLLIPOP');
    addConsolidatedBoosters('fhc', 'FHC');

    // 3. Ecstasy (single block with xN count)
    if (config.ecstasy > 0) {
      arr.push({
        id: 'ecstasy-0',
        type: 'drug',
        label: config.ecstasy > 1 ? `Ecstasy x${config.ecstasy}` : 'Ecstasy',
        durationMins: TORN_ITEMS.ECSTASY.cooldown.base,
        offsetMins: null
      });
    }

    // 4. Actions (Train blocks)
    const isStacked = config.ecstasy > 0 || config.edvd > 0;
    const isDailyRoutine = config.xanax === 3 && config.refill === 1;
    if (isStacked) {
      if (config.xanax > 0 || config.edvd > 0) {
        arr.push({
          id: 'train-0',
          type: 'action',
          label: 'Train Stack',
          durationMins: 0,
          offsetMins: null
        });
      }
    } else {
      for (let i = 0; i < config.xanax; i++) {
        const trainLabel = (isDailyRoutine && i === 0) ? 'Train 400E' : 'Train 250E';
        arr.push({
          id: `train-${i}`,
          type: 'action',
          label: trainLabel,
          durationMins: 0,
          offsetMins: null
        });
      }
    }

    // 5. Refill
    if (config.refill > 0) {
      arr.push({
        id: 'refill-0',
        type: 'action',
        label: 'Point Refill',
        durationMins: 0,
        offsetMins: null
      });
      const isDailyRoutineRefill = config.xanax === 3 && config.refill === 1;
      if (!isStacked || isDailyRoutineRefill) {
        arr.push({
          id: 'train-refill',
          type: 'action',
          label: 'Train Refill',
          durationMins: 0,
          offsetMins: null
        });
      }
    }

    // 6. Sleep
    if (config.sleepHours && config.sleepHours > 0) {
      arr.push({
        id: 'sleep-0',
        type: 'sleep',
        label: `Sleep (${config.sleepHours}h)`,
        durationMins: config.sleepHours * 60,
        offsetMins: null
      });
    }

    // 7. Natural Energy
    if (!isStacked || isDailyRoutine) {
      // Dynamically calculate needed natural cycles to fully back the timeline's duration
      const xanaxCdEnd = config.xanax * TORN_ITEMS.XANAX.cooldown.base;
      const sleepDuration = (config.sleepHours || 0) * 60;
      const estimatedMaxMins = xanaxCdEnd + sleepDuration + 120;
      const neededNatCount = isDailyRoutine ? 4 : Math.max(4, Math.ceil(estimatedMaxMins / 300) + 1);

      for (let i = 0; i < neededNatCount; i++) {
        arr.push({
          id: `natural-${i}`,
          type: 'natural',
          label: `Wait ${maxEnergy}E`,
          durationMins: 300,
          offsetMins: null
        });
        
        // Skip train-natural-0 for daily routine extra because it's merged into the Train 400E (train-0)
        if (!(isDailyRoutine && i === 0)) {
          arr.push({
            id: `train-natural-${i}`,
            type: 'action',
            label: `Train ${maxEnergy}E`,
            durationMins: 0,
            offsetMins: null
          });
        }
      }
    }

    const itemsKey = JSON.stringify({
      xanax: config.xanax,
      edvd: config.edvd,
      truffles: config.truffles,
      tootsie: config.tootsie,
      lollipop: config.lollipop,
      fhc: config.fhc,
      ecstasy: config.ecstasy,
      refill: config.refill
    });

    const itemsChanged = itemsKey !== prevItemsKey;
    if (itemsChanged) {
      setPrevItemsKey(itemsKey);
    }

    // Auto-arrange the initial blocks
    setBlocks(prev => {
      const { offsets, durations } = calculateAutoArrangeOffsets(arr, config);
      const mapped = arr.map(block => {
        const existing = prev.find(b => b.id === block.id);
        
        let newOffset = offsets[block.id] !== undefined ? offsets[block.id] : null;
        let newDuration = durations[block.id] !== undefined ? durations[block.id] : block.durationMins;
        
        if (existing && !itemsChanged) {
          return {
            ...block,
            offsetMins: existing.offsetMins,
            durationMins: existing.type === 'natural' ? existing.durationMins : block.durationMins
          };
        }
        
        return {
          ...block,
          offsetMins: newOffset,
          durationMins: newDuration
        };
      });

      return adjustNaturalBlocksAndSleepConstraints(mapped);
    });
  }, [config]);

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over) return;

    const targetOffset = over.data.current?.minOffset ?? null;
    if (targetOffset === null) return;

    setBlocks((prev) => {
      const activeIdx = prev.findIndex(b => b.id === active.id);
      if (activeIdx === -1) return prev;
      
      const activeBlock = prev[activeIdx];
      let newTargetOffset = targetOffset;

      // Drug overlap prevention: drugs cannot overlap with other drugs
      if (activeBlock.type === 'drug') {
        const otherDrugs = prev.filter(b => b.type === 'drug' && b.id !== active.id && b.offsetMins !== null);
        for (const other of otherDrugs) {
          const otherStart = other.offsetMins!;
          const otherEnd = otherStart + other.durationMins;
          const activeEnd = newTargetOffset + activeBlock.durationMins;
          // Check if the active block overlaps with this other drug
          if (newTargetOffset < otherEnd && activeEnd > otherStart) {
            // Push target to the end of the blocking drug to prevent overlap
            newTargetOffset = otherEnd;
          }
        }
      }

      // Assign the new target offset
      let newBlocks = prev.map(b => ({ ...b }));
      newBlocks[activeIdx].offsetMins = newTargetOffset;

      return resolveCascadePushes(newBlocks, active.id as string, config);
    });
  };

  const timelineBlocks = blocks.filter(b => b.offsetMins !== null);

  // 动态计算总小时数：初始为24小时，如果超出则动态延长
  const TOTAL_HOURS = useMemo(() => {
    let maxMins = 24 * 60; // 初始 24 小时 (1440 mins)
    timelineBlocks.forEach(b => {
      const duration = b.durationMins > 0 ? b.durationMins : 15;
      const endOffset = (b.offsetMins ?? 0) + duration;
      if (endOffset > maxMins) {
        maxMins = endOffset;
      }
    });
    return Math.max(24, Math.ceil(maxMins / 60));
  }, [timelineBlocks]);

  const totalSlots = TOTAL_HOURS * 4;

  // 动态多轨道避让分配
  const blockTracks = useMemo(() => {
    const tracks: { end: number; id: string }[][] = [];
    const idToTrackIndex: Record<string, number> = {};

    const sortedTimeline = [...timelineBlocks].sort((a, b) => {
      if ((a.offsetMins ?? 0) !== (b.offsetMins ?? 0)) {
        return (a.offsetMins ?? 0) - (b.offsetMins ?? 0);
      }
      return a.id.localeCompare(b.id);
    });

    const hasSleep = timelineBlocks.some(b => b.type === 'sleep');

    // If sleep exists, pre-initialize the first track (track index 0) as empty to reserve it for sleep only
    if (hasSleep && tracks.length === 0) {
      tracks.push([]);
    }

    sortedTimeline.forEach(block => {
      const start = block.offsetMins ?? 0;
      const duration = block.durationMins > 0 ? block.durationMins : 15;
      const end = start + duration;

      let assignedTrack = 0;
      let found = false;

      if (block.type === 'sleep') {
        // Sleep block is strictly assigned to the highest track (index 0)
        assignedTrack = 0;
        tracks[0].push({ end, id: block.id });
        found = true;
      } else {
        // If sleep is active, other blocks must start assigning from track index 1 (second row)
        const startTrack = hasSleep ? 1 : 0;

        for (let t = startTrack; t < tracks.length; t++) {
          const track = tracks[t];
          const hasOverlap = track.some(placed => {
            const placedBlock = timelineBlocks.find(b => b.id === placed.id);
            if (!placedBlock) return false;

            const pStart = placedBlock.offsetMins ?? 0;
            const pDuration = placedBlock.durationMins > 0 ? placedBlock.durationMins : 15;
            const pEnd = pStart + pDuration;
            return (start < pEnd && end > pStart);
          });

          if (!hasOverlap) {
            tracks[t].push({ end, id: block.id });
            assignedTrack = t;
            found = true;
            break;
          }
        }

        if (!found) {
          // If we couldn't find a spot and need to create a new track
          if (hasSleep && tracks.length === 1) {
            tracks.push([{ end, id: block.id }]); // Create track 1
            assignedTrack = 1;
          } else {
            tracks.push([{ end, id: block.id }]);
            assignedTrack = tracks.length - 1;
          }
          found = true;
        }
      }

      idToTrackIndex[block.id] = assignedTrack;
    });

    return idToTrackIndex;
  }, [timelineBlocks]);

  const totalTracks = useMemo(() => {
    return Math.max(3, ...Object.values(blockTracks).map(Number), 0) + 1;
  }, [blockTracks]);

  const autoArrange = () => {
    setBlocks(prev => {
      const { offsets, durations } = calculateAutoArrangeOffsets(prev, config);
      const mapped = prev.map(block => {
        return {
          ...block,
          offsetMins: offsets[block.id] !== undefined ? offsets[block.id] : null,
          durationMins: durations[block.id] !== undefined ? durations[block.id] : block.durationMins
        };
      });
      return adjustNaturalBlocksAndSleepConstraints(mapped);
    });
  };

  return (
    <div className="mt-0 p-5 bg-zinc-950 border-t border-white/5 shadow-2xl relative z-10 w-full">
      <div className="max-w-7xl mx-auto flex flex-col gap-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <h3 className="text-sm font-bold text-zinc-300 uppercase tracking-widest flex items-center gap-2">
            <svg className="w-4 h-4 text-indigo-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            Interactive Jump Execution Timeline
          </h3>
          
          <div className="hidden sm:flex items-center gap-3 w-full sm:w-auto shrink-0 justify-between sm:justify-start">
            {/* Sleep Schedule Control (Moved to timeline) */}
            <div className="flex items-center gap-2 bg-indigo-950/20 p-1 px-3 rounded-xl border border-indigo-500/20 shadow-md">
              <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Sleep Schedule</span>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const newHours = Math.max(0, (config.sleepHours || 0) - 1);
                    window.dispatchEvent(new CustomEvent('updateSleep', { detail: newHours }));
                  }}
                  className="w-5 h-5 flex justify-center items-center rounded bg-white/5 hover:bg-indigo-500/20 text-zinc-300 hover:text-white transition-colors text-xs font-black select-none cursor-pointer"
                >-</button>
                <span className="font-mono text-xs w-6 text-center text-indigo-300 font-bold">{(config.sleepHours || 0)}h</span>
                <button
                  onClick={() => {
                    const newHours = Math.min(24, (config.sleepHours || 0) + 1);
                    window.dispatchEvent(new CustomEvent('updateSleep', { detail: newHours }));
                  }}
                  className="w-5 h-5 flex justify-center items-center rounded bg-white/5 hover:bg-indigo-500/20 text-zinc-300 hover:text-white transition-colors text-xs font-black select-none cursor-pointer"
                >+</button>
              </div>
            </div>

            <button
              onClick={autoArrange}
              className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold uppercase rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-indigo-500/20 cursor-pointer"
            >
              <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
              Auto Arrange
            </button>
          </div>
        </div>

      {/* Unified Jump Execution Dashboard */}
      <div className="mt-3 bg-zinc-900/40 p-5 rounded-2xl border border-white/5 shadow-2xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-indigo-500/5 blur-3xl rounded-full mix-blend-screen pointer-events-none" />
        
        <h3 className="text-xs font-bold text-zinc-300 uppercase tracking-[0.2em] mb-6 flex items-center gap-2">
          <span className="w-1.5 h-3 bg-indigo-500 rounded-full" />
          Execution Summary
        </h3>

        <div className="flex flex-col gap-6">
          {/* Financials & Yield */}
          <div className="flex flex-col gap-4">
            <h4 className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider">
              Strategy Yield & Financials
            </h4>
            
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {/* Total Gain */}
              <div className="bg-emerald-500/12 border border-emerald-500/30 p-4 rounded-xl flex flex-col justify-between min-h-[90px] shadow-md shadow-emerald-950/20">
                <span className="text-[9px] text-emerald-400 font-bold uppercase tracking-wider">Total Gain</span>
                <span className="text-xl font-black font-mono text-emerald-300 mt-2">
                  +{Math.floor(totalGain || 0).toLocaleString()}
                  <span className="text-[10px] font-bold text-emerald-400 ml-1 uppercase">{statType?.substring(0, 3)}</span>
                </span>
              </div>

              {/* Final Stat */}
              <div className="bg-indigo-500/12 border border-indigo-500/30 p-4 rounded-xl flex flex-col justify-between min-h-[90px] shadow-md shadow-indigo-950/20">
                <span className="text-[9px] text-indigo-400 font-bold uppercase tracking-wider">Final Stat</span>
                <span className="text-xl font-black font-mono text-indigo-200 mt-2">
                  {Math.floor(finalStat || 0).toLocaleString()}
                </span>
              </div>

              {/* Total Cost */}
              <div className="bg-rose-950/40 border border-rose-500/50 p-4 rounded-xl flex flex-col justify-between min-h-[90px] shadow-lg shadow-rose-950/30 transition-all duration-300 hover:border-rose-400/70">
                <span className="text-[9px] text-rose-300 font-extrabold uppercase tracking-wider">Total Cost</span>
                <span className="text-xl font-black font-mono text-rose-100 drop-shadow-[0_0_10px_rgba(244,63,94,0.4)] mt-2">
                  {totalCost ? `$${(totalCost / 1000000).toFixed(2)}M` : 'FREE'}
                </span>
              </div>

              {/* Cost Per Stat */}
              <div className="bg-amber-950/40 border border-amber-500/50 p-4 rounded-xl flex flex-col justify-between min-h-[90px] shadow-lg shadow-amber-950/30 transition-all duration-300 hover:border-amber-400/70">
                <span className="text-[9px] text-amber-300 font-extrabold uppercase tracking-wider">Cost per Stat</span>
                <span className="text-xl font-black font-mono text-amber-100 drop-shadow-[0_0_10px_rgba(245,158,11,0.4)] mt-2">
                  {totalCost && totalGain && totalGain > 0 
                    ? `$${Math.floor(totalCost / totalGain).toLocaleString()}` 
                    : 'N/A'}
                </span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Mobile-only Sleep Setting & Auto Arrange Panel */}
      <div className="flex sm:hidden items-center justify-between gap-3 bg-zinc-900/40 p-4 rounded-xl border border-white/5 shadow-xl mt-3 mb-1">
        {/* Sleep Schedule Control */}
        <div className="flex items-center gap-2 bg-indigo-950/20 p-1 px-3 rounded-xl border border-indigo-500/20 shadow-md">
          <span className="text-[9px] font-black uppercase tracking-widest text-indigo-400">Sleep Schedule</span>
          <div className="flex items-center gap-1.5">
            <button
              onClick={() => {
                const newHours = Math.max(0, (config.sleepHours || 0) - 1);
                window.dispatchEvent(new CustomEvent('updateSleep', { detail: newHours }));
              }}
              className="w-5 h-5 flex justify-center items-center rounded bg-white/5 hover:bg-indigo-500/20 text-zinc-300 hover:text-white transition-colors text-xs font-black select-none cursor-pointer"
            >-</button>
            <span className="font-mono text-xs w-6 text-center text-indigo-300 font-bold">{(config.sleepHours || 0)}h</span>
            <button
              onClick={() => {
                const newHours = Math.min(24, (config.sleepHours || 0) + 1);
                window.dispatchEvent(new CustomEvent('updateSleep', { detail: newHours }));
              }}
              className="w-5 h-5 flex justify-center items-center rounded bg-white/5 hover:bg-indigo-500/20 text-zinc-300 hover:text-white transition-colors text-xs font-black select-none cursor-pointer"
            >+</button>
          </div>
        </div>

        {/* Auto Arrange */}
        <button
          onClick={autoArrange}
          className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-xs font-bold uppercase rounded-lg transition-colors flex items-center gap-2 shadow-lg shadow-indigo-500/20 cursor-pointer"
        >
          <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
          </svg>
          Auto Arrange
        </button>
      </div>

      <DndContext 
        onDragEnd={handleDragEnd} 
        collisionDetection={leftEdgeDetection} 
        modifiers={[restrictToWindowEdges, customDynamicModifier]}
        autoScroll={{
          canScroll: (element) => {
            if (element instanceof HTMLElement) {
              return element.classList.contains('overflow-x-auto');
            }
            return false;
          }
        }}
      >
        <div id="dnd-timeline-container" className="flex flex-col gap-6">

          <div className="flex flex-col mb-4">
            <span className="text-[10px] text-zinc-500 font-bold uppercase mb-2">Timeline</span>
            
            <div className="relative w-full max-w-full overflow-x-auto pt-6 pb-8 custom-scrollbar">
              <div 
                style={{ height: `${totalTracks * 28 + 8}px` }}
                className="relative flex bg-black/60 rounded-xl border border-white/5 shadow-inner overflow-visible min-w-max mx-8 transition-[height] duration-300"
              >
                {/* Horizontal Track Grid Lines */}
                {Array.from({ length: totalTracks }).map((_, trackIdx) => (
                  <div 
                    key={trackIdx}
                    style={{ top: `${trackIdx * 28 + 4}px` }}
                    className="absolute left-0 w-full h-[24px] bg-white/[0.02] border-y border-white/5 pointer-events-none" 
                  />
                ))}

                {Array.from({ length: totalSlots }).map((_, i) => {
                  const minOffset = i * 15;
                  const blocksInSlot = timelineBlocks.filter(b => b.offsetMins === minOffset);

                  return (
                    <DroppableSlot key={minOffset} minOffset={minOffset}>
                      {blocksInSlot.map(b => {
                        const actionBlocksInSlot = blocksInSlot.filter(block => block.type === 'action');
                        const actionIndex = b.type === 'action' ? actionBlocksInSlot.findIndex(block => block.id === b.id) : 0;
                        const totalActions = actionBlocksInSlot.length;
                        return (
                          <DraggableBlock 
                            key={b.id} 
                            block={b} 
                            actionIndex={actionIndex}
                            totalActions={totalActions}
                            trackIndex={blockTracks[b.id] ?? 0}
                            totalTracks={totalTracks}
                          />
                        );
                      })}
                    </DroppableSlot>
                  );
                })}
              </div>
            </div>
          </div>

        </div>
      </DndContext>

      </div>
    </div>
  );
}
