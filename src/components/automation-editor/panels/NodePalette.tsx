// Automation Editor - Node Palette (left sidebar)
// Always visible, collapsible categories, drag-to-canvas support

import { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import {
  Zap, Clock, Globe, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow, Search, ChevronRight,
} from 'lucide-react';
import { NodeInfoPopover } from './NodeInfoPopover';
import { cn } from '@/lib/utils';
import {
  PALETTE_CATEGORIES,
  NODE_DEFINITIONS_BY_CATEGORY,
  CATEGORY_LABELS,
  CATEGORY_STYLES,
  type NodeCategory,
  type NodeDefinition,
} from '../constants';

const ICONS: Record<string, React.ElementType> = {
  Zap, Clock, Globe, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow,
};

interface NodePaletteProps {
  onAddNode: (def: NodeDefinition) => void;
  searchInputRef?: React.RefObject<HTMLInputElement | null>;
  /** Force visible (for mobile overlay mode) */
  forceVisible?: boolean;
}

export function NodePalette({ onAddNode, searchInputRef, forceVisible }: NodePaletteProps) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const internalRef = useRef<HTMLInputElement>(null);
  const inputRef = searchInputRef ?? internalRef;
  const lowerSearch = search.toLowerCase();

  // Focus search on "/" key
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !(e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement)) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [inputRef]);

  const handleDragStart = (e: React.DragEvent, def: NodeDefinition) => {
    e.dataTransfer.setData('application/reactflow', `${def.category}:${def.type}`);
    e.dataTransfer.effectAllowed = 'move';
  };

  return (
    <div className={cn('w-56 border-r flex-col min-h-0 shrink-0 bg-background', forceVisible ? 'flex w-full border-r-0' : 'hidden sm:flex')} data-testid="node-palette">
      {/* Search */}
      <div className="p-2 border-b shrink-0">
        <div className="relative">
          <Search className="absolute left-2 top-2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            ref={inputRef}
            placeholder="Search nodes... (/)"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="h-7 pl-7 text-xs"
            data-testid="palette-search"
          />
        </div>
      </div>

      {/* Node list */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {PALETTE_CATEGORIES.map((category) => {
          const defs = NODE_DEFINITIONS_BY_CATEGORY[category] ?? [];
          const filtered = defs.filter(
            (d) =>
              !lowerSearch ||
              d.label.toLowerCase().includes(lowerSearch) ||
              d.description.toLowerCase().includes(lowerSearch),
          );

          if (filtered.length === 0) return null;

          const isCollapsed = collapsed[category] && !lowerSearch;
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
                <span className="text-muted-foreground/50 font-normal ml-auto">{filtered.length}</span>
              </button>

              {/* Node entries */}
              {!isCollapsed && (
                <div className="px-1.5 pb-1">
                  {filtered.map((def) => {
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
