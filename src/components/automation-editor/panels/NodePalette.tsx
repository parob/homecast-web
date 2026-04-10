// Automation Editor - Node Palette (left sidebar)
// Always visible, collapsible categories, drag-to-canvas support

import { useState } from 'react';
import {
  Zap, Clock, Globe, AlertCircle, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow, StickyNote, ChevronRight,
} from 'lucide-react';
import { NodeInfoPopover } from './NodeInfoPopover';
import { cn } from '@/lib/utils';
import {
  PALETTE_CATEGORIES,
  NODE_DEFINITIONS_BY_CATEGORY,
  CATEGORY_LABELS,
  CATEGORY_STYLES,
  type NodeDefinition,
} from '../constants';

const ICONS: Record<string, React.ElementType> = {
  Zap, Clock, Globe, AlertCircle, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow, StickyNote,
};

interface NodePaletteProps {
  onAddNode: (def: NodeDefinition) => void;
  /** Force visible (for mobile overlay mode) */
  forceVisible?: boolean;
}

export function NodePalette({ onAddNode, forceVisible }: NodePaletteProps) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const handleDragStart = (e: React.DragEvent, def: NodeDefinition) => {
    e.dataTransfer.setData('application/reactflow', `${def.category}:${def.type}`);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className={cn('w-56 border-r flex-col min-h-0 shrink-0 bg-background', forceVisible ? 'flex w-full border-r-0' : 'hidden sm:flex')} data-testid="node-palette">
      {/* Node list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {PALETTE_CATEGORIES.map((category) => {
          const defs = NODE_DEFINITIONS_BY_CATEGORY[category] ?? [];
          if (defs.length === 0) return null;

          const isCollapsed = collapsed[category];
          const catStyles = CATEGORY_STYLES[category];

          return (
            <div key={category} data-testid={`palette-category-${category}`}>
              {/* Category header */}
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 transition-colors"
                onClick={() => setCollapsed((prev) => ({ ...prev, [category]: !prev[category] }))}
              >
                <ChevronRight className={cn('w-3 h-3 transition-transform', !isCollapsed && 'rotate-90')} />
                {CATEGORY_LABELS[category]}
                <span className="text-muted-foreground/50 font-normal ml-auto">{defs.length}</span>
              </button>

              {/* Node entries */}
              {!isCollapsed && (
                <div className="px-1.5 pb-1">
                  {defs.map((def) => {
                    const Icon = ICONS[def.icon] ?? Zap;
                    return (
                      <div
                        key={`${def.category}:${def.type}`}
                        draggable
                        onDragStart={(e) => handleDragStart(e, def)}
                        className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/50 transition-colors text-left cursor-grab active:cursor-grabbing"
                        data-testid={`palette-node-${def.category}-${def.type}`}
                      >
                        <div
                          className="flex items-center gap-2 min-w-0 flex-1 cursor-pointer"
                          onClick={() => onAddNode(def)}
                          role="button"
                          tabIndex={0}
                          onKeyDown={(e) => { if (e.key === 'Enter') onAddNode(def); }}
                        >
                          <div className={cn('w-6 h-6 rounded flex items-center justify-center shrink-0', catStyles.iconBg)}>
                            <Icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="text-xs font-medium truncate">{def.label}</div>
                            <div className="text-[10px] text-muted-foreground truncate leading-tight">{def.description}</div>
                          </div>
                        </div>
                        <NodeInfoPopover nodeType={def.type} />
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
