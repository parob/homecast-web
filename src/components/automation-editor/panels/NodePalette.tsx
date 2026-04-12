// Automation Editor - Node Palette (left sidebar)
// Always visible, collapsible categories, drag-to-canvas support
// Includes Executions and Versions sections for existing automations

import { useState } from 'react';
import {
  Zap, Clock, Globe, AlertCircle, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow, StickyNote, ChevronRight,
  PanelLeftClose, PanelLeftOpen, History, GitCommitVertical,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { NodeInfoPopover } from './NodeInfoPopover';
import { ExecutionHistoryInline } from './ExecutionHistoryPanel';
import { VersionHistoryInline } from './VersionHistoryPanel';
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
  /** Existing automation ID — enables Executions/Versions sections */
  automationId?: string | null;
  homeId?: string;
  onVersionRestored?: () => void;
  /** Sidebar collapsed state */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function NodePalette({ onAddNode, forceVisible, automationId, homeId, onVersionRestored, collapsed, onToggleCollapse }: NodePaletteProps) {
  const [sectionCollapsed, setSectionCollapsed] = useState<Record<string, boolean>>({
    executions: true,
    versions: true,
  });

  const handleDragStart = (e: React.DragEvent, def: NodeDefinition) => {
    e.dataTransfer.setData('application/reactflow', `${def.category}:${def.type}`);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Collapsed state — thin strip with expand button
  if (collapsed && !forceVisible) {
    return (
      <div className="w-10 border-r flex flex-col items-center pt-2 shrink-0 bg-background hidden sm:flex">
        <Button variant="ghost" size="icon" className="h-8 w-8" onClick={onToggleCollapse}>
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  return (
    <div className={cn('w-56 border-r flex-col min-h-0 shrink-0 bg-background', forceVisible ? 'flex w-full border-r-0' : 'hidden sm:flex')} data-testid="node-palette">
      {/* Collapse toggle header */}
      {!forceVisible && onToggleCollapse && (
        <div className="h-10 border-b flex items-center px-2 shrink-0">
          <Button variant="ghost" size="icon" className="h-7 w-7" onClick={onToggleCollapse}>
            <PanelLeftClose className="h-4 w-4" />
          </Button>
          <span className="text-xs font-medium ml-1.5">Nodes</span>
        </div>
      )}

      {/* Scrollable content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Node categories */}
        {PALETTE_CATEGORIES.map((category) => {
          const defs = NODE_DEFINITIONS_BY_CATEGORY[category] ?? [];
          if (defs.length === 0) return null;

          const isCollapsed = sectionCollapsed[category];
          const catStyles = CATEGORY_STYLES[category];

          return (
            <div key={category} data-testid={`palette-category-${category}`}>
              {/* Category header */}
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 transition-colors"
                onClick={() => setSectionCollapsed((prev) => ({ ...prev, [category]: !prev[category] }))}
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

        {/* Executions & Versions — only for existing automations */}
        {automationId && (
          <>
            <div className="h-px bg-border mx-2.5 my-1" />

            {/* Executions */}
            <div>
              <button
                type="button"
                className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 transition-colors"
                onClick={() => setSectionCollapsed((prev) => ({ ...prev, executions: !prev.executions }))}
              >
                <ChevronRight className={cn('w-3 h-3 transition-transform', !sectionCollapsed.executions && 'rotate-90')} />
                <History className="w-3 h-3" />
                Executions
              </button>
              {!sectionCollapsed.executions && (
                <ExecutionHistoryInline automationId={automationId} />
              )}
            </div>

            {/* Versions */}
            {homeId && onVersionRestored && (
              <div>
                <button
                  type="button"
                  className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 transition-colors"
                  onClick={() => setSectionCollapsed((prev) => ({ ...prev, versions: !prev.versions }))}
                >
                  <ChevronRight className={cn('w-3 h-3 transition-transform', !sectionCollapsed.versions && 'rotate-90')} />
                  <GitCommitVertical className="w-3 h-3" />
                  Versions
                </button>
                {!sectionCollapsed.versions && (
                  <VersionHistoryInline
                    automationId={automationId}
                    homeId={homeId}
                    onRestored={onVersionRestored}
                  />
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
