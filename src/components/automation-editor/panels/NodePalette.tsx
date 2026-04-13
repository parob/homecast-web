// Automation Editor - Node Palette (left sidebar)
// Tab-based: Nodes | Executions | Versions
// Collapsible via toggle button

import { useState } from 'react';
import {
  Zap, Clock, Globe, AlertCircle, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow, StickyNote, ChevronRight,
  PanelLeftClose, PanelLeftOpen, Blocks, History, GitCommitVertical,
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

type SidebarTab = 'nodes' | 'executions' | 'versions';

interface NodePaletteProps {
  onAddNode: (def: NodeDefinition) => void;
  /** Force visible (for mobile overlay mode) */
  forceVisible?: boolean;
  /** Existing automation ID — enables Executions/Versions tabs */
  automationId?: string | null;
  homeId?: string;
  onVersionRestored?: () => void;
  /** Sidebar collapsed state */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export function NodePalette({ onAddNode, forceVisible, automationId, homeId, onVersionRestored, collapsed, onToggleCollapse }: NodePaletteProps) {
  const [activeTab, setActiveTab] = useState<SidebarTab>('nodes');
  const [categoryCollapsed, setCategoryCollapsed] = useState<Record<string, boolean>>({});

  const handleDragStart = (e: React.DragEvent, def: NodeDefinition) => {
    e.dataTransfer.setData('application/reactflow', `${def.category}:${def.type}`);
    e.dataTransfer.effectAllowed = 'move';
  };

  // Collapsed state — small floating button at top-left of canvas
  if (collapsed && !forceVisible) {
    return (
      <div className="absolute top-2 left-2 z-10 hidden sm:block">
        <Button variant="outline" size="icon" className="h-8 w-8 bg-background shadow-sm" onClick={onToggleCollapse}>
          <PanelLeftOpen className="h-4 w-4" />
        </Button>
      </div>
    );
  }

  const tabs: { id: SidebarTab; icon: React.ElementType; label: string; show: boolean }[] = [
    { id: 'nodes', icon: Blocks, label: 'Nodes', show: true },
    { id: 'executions', icon: History, label: 'Executions', show: !!automationId },
    { id: 'versions', icon: GitCommitVertical, label: 'Versions', show: !!automationId && !!homeId },
  ];

  const visibleTabs = tabs.filter((t) => t.show);

  return (
    <div className={cn('w-72 border-r flex-col min-h-0 shrink-0 bg-background', forceVisible ? 'flex w-full border-r-0' : 'hidden sm:flex')} data-testid="node-palette">
      {/* Header: collapse button + tabs */}
      {!forceVisible && (
        <div className="border-b shrink-0">
          <div className="flex items-center h-10">
            {onToggleCollapse && (
              <Button variant="ghost" size="icon" className="h-7 w-7 ml-1.5 shrink-0" onClick={onToggleCollapse}>
                <PanelLeftClose className="h-4 w-4" />
              </Button>
            )}
            <div className="flex-1 flex items-center justify-center gap-1 px-1">
              {visibleTabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    className={cn(
                      'flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-medium transition-colors',
                      activeTab === tab.id
                        ? 'bg-muted text-foreground'
                        : 'text-muted-foreground hover:text-foreground hover:bg-muted/50',
                    )}
                    onClick={() => setActiveTab(tab.id)}
                  >
                    <Icon className="w-3 h-3" />
                    {tab.label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {/* Nodes tab */}
        {activeTab === 'nodes' && (
          <>
            {PALETTE_CATEGORIES.map((category) => {
              const defs = NODE_DEFINITIONS_BY_CATEGORY[category] ?? [];
              if (defs.length === 0) return null;

              const isCollapsed = categoryCollapsed[category];
              const catStyles = CATEGORY_STYLES[category];

              return (
                <div key={category} data-testid={`palette-category-${category}`}>
                  <button
                    type="button"
                    className="w-full flex items-center gap-1.5 px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:bg-muted/30 transition-colors"
                    onClick={() => setCategoryCollapsed((prev) => ({ ...prev, [category]: !prev[category] }))}
                  >
                    <ChevronRight className={cn('w-3 h-3 transition-transform', !isCollapsed && 'rotate-90')} />
                    {CATEGORY_LABELS[category]}
                    <span className="text-muted-foreground/50 font-normal ml-auto">{defs.length}</span>
                  </button>

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
          </>
        )}

        {/* Executions tab */}
        {activeTab === 'executions' && automationId && (
          <ExecutionHistoryInline automationId={automationId} />
        )}

        {/* Versions tab */}
        {activeTab === 'versions' && automationId && homeId && onVersionRestored && (
          <VersionHistoryInline
            automationId={automationId}
            homeId={homeId}
            onRestored={onVersionRestored}
          />
        )}
      </div>
    </div>
  );
}
