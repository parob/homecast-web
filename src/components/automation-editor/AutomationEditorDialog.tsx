// Automation Editor - Dialog-based visual editor
// Layout: [left palette | canvas | right config tray]
// Single-click selects, double-click opens config

import { useCallback, useEffect, useMemo, useState, useRef } from 'react';
import { useMutation } from '@apollo/client/react';
import { SAVE_HC_AUTOMATION } from '@/lib/graphql/mutations';
import { toast } from 'sonner';
import {
  ReactFlowProvider,
  ReactFlow,
  Background,
  MiniMap,
  BackgroundVariant,
  Controls,
  useNodesState,
  useEdgesState,
  useReactFlow,
  addEdge,
  type Node,
  type Edge,
  type Connection,
  type OnConnect,
  type NodeTypes,
} from '@xyflow/react';

import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useQuery } from '@apollo/client/react';
import { GET_ACCESSORIES, GET_HOMES, GET_SCENES, GET_SERVICE_GROUPS, HC_AUTOMATIONS } from '@/lib/graphql/queries';
import type { HomeKitAccessory, HomeKitHome, HomeKitScene, HomeKitServiceGroup } from '@/lib/graphql/types';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { X, Save, Undo2, Redo2, Loader2, Plus, Trash2, History, GitCommitVertical } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ExecutionHistoryPanel } from './panels/ExecutionHistoryPanel';
import { VersionHistoryPanel } from './panels/VersionHistoryPanel';

import { BaseNode } from './nodes/BaseNode';
import { StickyNoteNode } from './nodes/StickyNoteNode';
import { ControlFlowEdge } from './edges/ControlFlowEdge';
import { NodePalette } from './panels/NodePalette';
import { NodeConfigPanel } from './panels/NodeConfigPanel';
import type { FlowNodeData } from './constants';
import { createDefaultNodeData, ALL_NODE_DEFINITIONS, CATEGORY_STYLES } from './constants';
import type { NodeDefinition } from './constants';
import { graphToAutomation } from './serialization/graphToAutomation';
import { automationToGraph } from './serialization/automationToGraph';
import type { Automation } from '@/automation/types/automation';

const nodeTypes: NodeTypes = {
  automationNode: BaseNode,
  stickyNote: StickyNoteNode,
};

const edgeTypes = {
  controlFlow: ControlFlowEdge,
};

const defaultEdgeOptions = {
  type: 'controlFlow',
  animated: false,
};

interface AutomationEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeId: string;
  existingAutomation?: Automation;
  onSaved?: () => void;
  onDelete?: (id: string) => void;
}

function AutomationEditorInner({
  homeId,
  existingAutomation,
  onSaved,
  onDelete,
  onClose,
}: {
  homeId: string;
  existingAutomation?: Automation;
  onSaved?: () => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const isNew = !existingAutomation;

  // Fetch device data for the config panel's device picker
  const { data: accessoriesData } = useQuery<{ accessories: HomeKitAccessory[] }>(
    GET_ACCESSORIES,
    { variables: { homeId }, skip: !homeId, fetchPolicy: 'cache-first' },
  );
  const { data: homesData } = useQuery<{ homes: HomeKitHome[] }>(
    GET_HOMES,
    { skip: false, fetchPolicy: 'cache-first' },
  );
  const { data: scenesData } = useQuery<{ scenes: HomeKitScene[] }>(
    GET_SCENES,
    { variables: { homeId }, skip: !homeId, fetchPolicy: 'cache-first' },
  );
  const { data: serviceGroupsData } = useQuery<{ serviceGroups: HomeKitServiceGroup[] }>(
    GET_SERVICE_GROUPS,
    { variables: { homeId }, skip: !homeId, fetchPolicy: 'cache-first' },
  );
  const { data: automationsData } = useQuery<{ hcAutomations: { id: string; dataJson: string }[] }>(
    HC_AUTOMATIONS,
    { variables: { homeId }, skip: !homeId, fetchPolicy: 'cache-first' },
  );
  const accessories = accessoriesData?.accessories || [];
  const homes = homesData?.homes || [];
  const scenes = scenesData?.scenes || [];
  const serviceGroups = serviceGroupsData?.serviceGroups || [];
  const availableAutomations = useMemo(() => {
    return (automationsData?.hcAutomations ?? []).map((a) => {
      try {
        const parsed = JSON.parse(a.dataJson);
        return { id: parsed.id ?? a.id, name: parsed.name ?? 'Untitled' };
      } catch {
        return { id: a.id, name: 'Untitled' };
      }
    });
  }, [automationsData]);

  // GraphQL
  const [saveHcAutomation] = useMutation(SAVE_HC_AUTOMATION);

  // Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [automationName, setAutomationName] = useState(existingAutomation?.name ?? '');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [configNodeId, setConfigNodeId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMobilePalette, setShowMobilePalette] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [showVersions, setShowVersions] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [showCloseWarning, setShowCloseWarning] = useState(false);

  // Snapshot for config cancel/revert
  const configSnapshotRef = useRef<Record<string, unknown> | null>(null);
  const handleSaveRef = useRef<(() => void) | null>(null);

  // Existing automation ID for update
  const existingIdRef = useRef(existingAutomation?.id);

  // Undo/redo
  const [history, setHistory] = useState<{ nodes: Node<FlowNodeData>[]; edges: Edge[] }[]>([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const isUndoRedoRef = useRef(false);

  // Load existing automation into graph
  useEffect(() => {
    if (existingAutomation) {
      const { nodes: loaded, edges: loadedEdges } = automationToGraph(existingAutomation);
      setNodes(loaded);
      setEdges(loadedEdges);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  const configNode = useMemo(
    () => nodes.find((n) => n.id === configNodeId),
    [nodes, configNodeId],
  );

  // Connection handling
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      setEdges((eds) => addEdge({ ...connection, type: 'controlFlow' }, eds));
      setIsDirty(true);
    },
    [setEdges],
  );

  // Single-click: select + open config panel
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setConfigNodeId(node.id);
    const data = node.data as FlowNodeData;
    configSnapshotRef.current = { ...data.config };
  }, []);

  // Double-click: open config tray
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    setSelectedNodeId(node.id);
    setConfigNodeId(node.id);
    // Snapshot config for cancel/revert
    const data = node.data as FlowNodeData;
    configSnapshotRef.current = { ...data.config };
  }, []);

  const onPaneClick = useCallback(() => {
    setSelectedNodeId(null);
    setContextMenu(null);
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
  }, []);

  const duplicateNode = useCallback((nodeId: string) => {
    const original = nodes.find((n) => n.id === nodeId);
    if (!original) return;
    const newId = crypto.randomUUID();
    const newNode: Node<FlowNodeData> = {
      ...original,
      id: newId,
      position: { x: original.position.x + 40, y: original.position.y + 40 },
      selected: false,
    };
    setNodes((nds) => [...nds, newNode]);
    setIsDirty(true);
    setContextMenu(null);
  }, [nodes, setNodes]);

  const toggleNodeEnabled = useCallback((nodeId: string) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const d = n.data as FlowNodeData;
      return { ...n, data: { ...d, enabled: !d.enabled } };
    }));
    setIsDirty(true);
    setContextMenu(null);
  }, [setNodes]);

  // Config tray actions
  const handleConfigDone = useCallback(() => {
    setConfigNodeId(null);
    configSnapshotRef.current = null;
  }, []);

  const handleConfigCancel = useCallback(() => {
    // Revert to snapshot
    if (configNodeId && configSnapshotRef.current) {
      setNodes((nds) =>
        nds.map((n) =>
          n.id === configNodeId
            ? { ...n, data: { ...n.data, config: configSnapshotRef.current! } }
            : n,
        ),
      );
    }
    setConfigNodeId(null);
    configSnapshotRef.current = null;
  }, [configNodeId, setNodes]);

  // Drag and drop from palette
  const { screenToFlowPosition } = useReactFlow();

  const onDragOver = useCallback((event: React.DragEvent) => {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
  }, []);

  const onDrop = useCallback(
    (event: React.DragEvent) => {
      event.preventDefault();
      const nodeType = event.dataTransfer.getData('application/reactflow');
      if (!nodeType) return;

      const def = ALL_NODE_DEFINITIONS.find((d) => `${d.category}:${d.type}` === nodeType);
      if (!def) return;

      const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
      addNewNode(def, position);
    },
    [screenToFlowPosition], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Click-to-add from palette
  const addNewNode = useCallback(
    (def: NodeDefinition, position?: { x: number; y: number }) => {
      const id = crypto.randomUUID();
      const pos = position ?? { x: 300, y: (nodes.length + 1) * 80 + 50 };

      const newNode: Node<FlowNodeData> = {
        id,
        type: def.category === 'annotation' ? 'stickyNote' : 'automationNode',
        position: pos,
        data: createDefaultNodeData(def),
      };

      setNodes((nds) => [...nds, newNode]);
      setSelectedNodeId(id);
      setIsDirty(true);
    },
    [nodes, setNodes],
  );

  // Update node config
  const updateNodeData = useCallback(
    (nodeId: string, updates: Partial<FlowNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n)),
      );
      setIsDirty(true);
    },
    [setNodes],
  );

  // Delete node
  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      if (configNodeId === nodeId) { setConfigNodeId(null); configSnapshotRef.current = null; }
      setIsDirty(true);
    },
    [setNodes, setEdges, selectedNodeId, configNodeId],
  );

  // Undo/redo
  useEffect(() => {
    if (isDirty && !isUndoRedoRef.current) {
      setHistory((prev) => {
        const trimmed = prev.slice(0, historyIndex + 1);
        const entry = { nodes: JSON.parse(JSON.stringify(nodes)), edges: JSON.parse(JSON.stringify(edges)) };
        return [...trimmed, entry].slice(-75);
      });
      setHistoryIndex((prev) => Math.min(prev + 1, 74));
    }
  }, [nodes.length, edges.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const undo = useCallback(() => {
    if (historyIndex <= 0) return;
    isUndoRedoRef.current = true;
    const prev = history[historyIndex - 1];
    if (prev) { setNodes(prev.nodes); setEdges(prev.edges); setHistoryIndex(historyIndex - 1); }
    setTimeout(() => { isUndoRedoRef.current = false; }, 0);
  }, [historyIndex, history, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (historyIndex >= history.length - 1) return;
    isUndoRedoRef.current = true;
    const next = history[historyIndex + 1];
    if (next) { setNodes(next.nodes); setEdges(next.edges); setHistoryIndex(historyIndex + 1); }
    setTimeout(() => { isUndoRedoRef.current = false; }, 0);
  }, [historyIndex, history, setNodes, setEdges]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current?.();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo]);

  // Save
  const handleSave = useCallback(async () => {
    if (!automationName.trim() || !homeId) return;

    const warnings = validateGraph(nodes, edges);
    if (warnings.length > 0) {
      toast.warning(warnings.join('. '));
    }

    setIsSaving(true);
    try {
      const automation = graphToAutomation(nodes, edges, automationName, homeId, existingIdRef.current);
      await saveHcAutomation({
        variables: { homeId, automationId: automation.id, data: JSON.stringify(automation) },
      });
      existingIdRef.current = automation.id;
      setIsDirty(false);
      toast.success('Automation saved');
      onSaved?.();
    } catch (e) {
      console.error('[AutomationEditor] Save failed:', e);
      toast.error('Failed to save automation');
    } finally {
      setIsSaving(false);
    }
  }, [automationName, homeId, nodes, edges, saveHcAutomation, onSaved]);

  // Keep ref in sync for keyboard shortcut
  handleSaveRef.current = handleSave;

  return (
    <div className="flex flex-col h-full" data-testid="automation-editor">
      {/* Toolbar */}
      <div className="h-12 border-b flex items-center gap-1 sm:gap-2 px-2 sm:px-3 shrink-0">
        {/* Mobile palette toggle */}
        <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" onClick={() => setShowMobilePalette(!showMobilePalette)}>
          <Plus className="h-4 w-4" />
        </Button>
        <img src="/icon-192.png" alt="Homecast" className="h-5 w-5 shrink-0 rounded-sm opacity-50 hidden sm:block" />
        <Input
          value={automationName}
          onChange={(e) => { setAutomationName(e.target.value); setIsDirty(true); }}
          placeholder="Automation name..."
          className="h-8 w-28 sm:w-48 text-sm font-medium"
          data-testid="automation-name-input"
        />
        <div className="h-5 w-px bg-border mx-0.5 sm:mx-1 hidden sm:block" />
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={undo} disabled={historyIndex <= 0} className="h-8 w-8 hidden sm:flex">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger><TooltipContent side="bottom">Undo (⌘Z)</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={redo} disabled={historyIndex >= history.length - 1} className="h-8 w-8 hidden sm:flex">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger><TooltipContent side="bottom">Redo (⌘⇧Z)</TooltipContent></Tooltip>
        <div className="flex-1" />
        {!isNew && (
          <>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:w-auto sm:px-3 text-muted-foreground" onClick={() => setShowHistory(!showHistory)}>
                <History className="h-3.5 w-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">History</span>
              </Button>
            </TooltipTrigger><TooltipContent side="bottom">Execution History</TooltipContent></Tooltip>
            <Tooltip><TooltipTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 sm:w-auto sm:px-3 text-muted-foreground" onClick={() => setShowVersions(!showVersions)}>
                <GitCommitVertical className="h-3.5 w-3.5 sm:mr-1.5" />
                <span className="hidden sm:inline">Versions</span>
              </Button>
            </TooltipTrigger><TooltipContent side="bottom">Version History</TooltipContent></Tooltip>
          </>
        )}
        {!isNew && onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:w-auto sm:px-3 text-muted-foreground hover:text-destructive"
            onClick={() => {
              if (confirm('Delete this automation?')) {
                onDelete(existingIdRef.current ?? '');
                onClose();
              }
            }}
          >
            <Trash2 className="h-3.5 w-3.5 sm:mr-1.5" />
            <span className="hidden sm:inline">Delete</span>
          </Button>
        )}
        <Button
          size="sm"
          onClick={handleSave}
          disabled={isSaving || !isDirty || !automationName.trim()}
          data-testid="save-button"
          className="h-8"
        >
          {isSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5 sm:mr-1.5" />}
          <span className="hidden sm:inline">Save</span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => isDirty ? setShowCloseWarning(true) : onClose()}
          className="h-8 w-8"
          data-testid="close-editor-button"
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      </div>

      {/* Main content: left palette | canvas | right config tray */}
      <div className="flex-1 flex min-h-0 relative">
        {/* Left: Always-visible node palette (hidden on mobile via CSS in NodePalette) */}
        <NodePalette onAddNode={addNewNode} />

        {/* Mobile palette overlay */}
        {showMobilePalette && (
          <div className="absolute inset-0 z-20 bg-background/95 backdrop-blur-sm sm:hidden flex flex-col">
            <div className="p-3 border-b flex items-center justify-between">
              <span className="text-sm font-medium">Add Node</span>
              <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setShowMobilePalette(false)}>
                <X className="h-4 w-4" />
              </Button>
            </div>
            <div className="flex-1 overflow-y-auto">
              <NodePalette forceVisible onAddNode={(def) => { addNewNode(def); setShowMobilePalette(false); }} />
            </div>
          </div>
        )}

        {/* Center: React Flow canvas */}
        <div className="flex-1 relative min-h-0" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            onNodeContextMenu={onNodeContextMenu}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            deleteKeyCode={['Backspace', 'Delete']}
            className="bg-muted/20"
          >
            <Background variant={BackgroundVariant.Dots} gap={16} size={1} className="opacity-30" />
            {nodes.length === 0 && (
              <div className="absolute inset-0 flex items-center justify-center z-10">
                <div className="text-center text-muted-foreground">
                  <Plus className="h-8 w-8 mx-auto mb-2 opacity-30" />
                  <p className="text-sm">Drag nodes from the palette</p>
                  <p className="text-xs opacity-60 mt-1">or click a node to add it</p>
                </div>
              </div>
            )}
            <Controls showInteractive={false} className="!bg-background !border !shadow-sm !rounded-xl" />
            <MiniMap
              className="!bg-background !border !shadow-sm !rounded-xl"
              maskColor="hsl(var(--muted) / 0.5)"
              nodeColor={(n: Node) => {
                const data = n.data as FlowNodeData | undefined;
                if (!data) return '#888';
                return CATEGORY_STYLES[data.category]?.miniMapColor ?? '#888';
              }}
            />
          </ReactFlow>

          {/* Context menu */}
          {contextMenu && (
            <div
              className="fixed z-[10060] bg-popover border rounded-lg shadow-lg py-1 min-w-[140px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              {[
                { label: 'Configure', action: () => { const n = nodes.find(n => n.id === contextMenu.nodeId); if (n) { setSelectedNodeId(n.id); setConfigNodeId(n.id); configSnapshotRef.current = { ...(n.data as FlowNodeData).config }; } setContextMenu(null); } },
                { label: 'Duplicate', action: () => duplicateNode(contextMenu.nodeId) },
                { label: (nodes.find(n => n.id === contextMenu.nodeId)?.data as FlowNodeData)?.enabled === false ? 'Enable' : 'Disable', action: () => toggleNodeEnabled(contextMenu.nodeId) },
                { label: 'Delete', action: () => { deleteNode(contextMenu.nodeId); setContextMenu(null); }, destructive: true },
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={cn(
                    'w-full text-left px-3 py-1.5 text-xs hover:bg-muted transition-colors',
                    (item as any).destructive && 'text-destructive hover:text-destructive',
                  )}
                  onClick={item.action}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Right: History panel (full-width overlay on mobile, sidebar on desktop) */}
        {showHistory && !showVersions && !configNode && existingAutomation?.id && (
          <div className="absolute inset-0 z-10 sm:relative sm:inset-auto">
            <ExecutionHistoryPanel
              automationId={existingAutomation.id}
              onClose={() => setShowHistory(false)}
            />
          </div>
        )}

        {/* Right: Version history panel */}
        {showVersions && !configNode && existingAutomation?.id && (
          <div className="absolute inset-0 z-10 sm:relative sm:inset-auto">
            <VersionHistoryPanel
              automationId={existingAutomation.id}
              homeId={homeId}
              onClose={() => setShowVersions(false)}
              onRestored={() => { setShowVersions(false); onClose(); }}
            />
          </div>
        )}

        {/* Right: Config tray (full-width overlay on mobile, sidebar on desktop) */}
        {configNode && (
          <div className="absolute inset-0 z-10 sm:relative sm:inset-auto">
          <NodeConfigPanel
            node={configNode}
            allNodes={nodes}
            allEdges={edges}
            onUpdateData={(updates) => updateNodeData(configNode.id, updates)}
            onDelete={() => deleteNode(configNode.id)}
            onDone={handleConfigDone}
            onCancel={handleConfigCancel}
            accessories={accessories}
            homes={homes}
            scenes={scenes}
            serviceGroups={serviceGroups}
            availableAutomations={availableAutomations}
          />
          </div>
        )}
      </div>

      {/* Unsaved changes warning */}
      <AlertDialog open={showCloseWarning} onOpenChange={setShowCloseWarning}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Unsaved changes</AlertDialogTitle>
            <AlertDialogDescription>
              You have unsaved changes. Do you want to save before closing?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => setShowCloseWarning(false)}>
              Cancel
            </AlertDialogCancel>
            <Button
              variant="outline"
              onClick={() => { setShowCloseWarning(false); onClose(); }}
              data-testid="discard-changes-button"
            >
              Discard
            </Button>
            <AlertDialogAction
              onClick={async () => {
                setShowCloseWarning(false);
                await handleSave();
                onClose();
              }}
              data-testid="save-and-close-button"
            >
              Save
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function ErrorSafeReactFlow(props: {
  homeId: string;
  existingAutomation?: Automation;
  onSaved?: () => void;
  onDelete?: (id: string) => void;
  onClose: () => void;
}) {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setReady(true), 100);
    return () => clearTimeout(timer);
  }, []);

  if (!ready) {
    return (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading editor...
      </div>
    );
  }

  return (
    <ReactFlowProvider>
      <AutomationEditorInner {...props} />
    </ReactFlowProvider>
  );
}

function validateGraph(nodes: Node<FlowNodeData>[], edges: Edge[]): string[] {
  const warnings: string[] = [];
  const triggers = nodes.filter((n) => (n.data as FlowNodeData).category === 'trigger');
  const actions = nodes.filter((n) => (n.data as FlowNodeData).category === 'action');

  if (triggers.length === 0) warnings.push('No triggers — automation won\'t start automatically');
  if (actions.length === 0) warnings.push('No actions — automation won\'t do anything');

  const connectedIds = new Set<string>();
  for (const e of edges) { connectedIds.add(e.source); connectedIds.add(e.target); }
  const isolated = nodes.filter((n) => !connectedIds.has(n.id));
  if (isolated.length > 0 && nodes.length > 1) {
    warnings.push(`${isolated.length} unconnected node(s)`);
  }

  const unconfigured = nodes.filter((n) => !(n.data as FlowNodeData).isConfigured);
  if (unconfigured.length > 0) {
    warnings.push(`${unconfigured.length} unconfigured node(s)`);
  }

  return warnings;
}

export function AutomationEditorDialog({
  open,
  onOpenChange,
  homeId,
  existingAutomation,
  onSaved,
  onDelete,
}: AutomationEditorDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="!max-w-[100vw] sm:!max-w-[calc(100vw-48px)] !w-[100vw] sm:!w-[calc(100vw-48px)] !rounded-none sm:!rounded-lg p-0 gap-0 flex flex-col overflow-hidden !h-[100dvh] sm:!h-[calc(100dvh-48px)] !max-h-[100dvh] sm:!max-h-[calc(100dvh-48px)]"
        onOpenAutoFocus={(e) => e.preventDefault()}
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
        hideCloseButton
      >
        <DialogTitle className="sr-only">Automation Editor</DialogTitle>
        {open && (
          <ErrorSafeReactFlow
            homeId={homeId}
            existingAutomation={existingAutomation}
            onSaved={onSaved}
            onDelete={onDelete}
            onClose={() => onOpenChange(false)}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

export default AutomationEditorDialog;
