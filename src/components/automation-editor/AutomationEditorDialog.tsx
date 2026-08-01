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
import { X, Save, Undo2, Redo2, Loader2, Plus, Trash2, History } from 'lucide-react';
import { formatDistanceToNow } from 'date-fns';
import { cn } from '@/lib/utils';

import { BaseNode } from './nodes/BaseNode';
import { StickyNoteNode } from './nodes/StickyNoteNode';
import { ControlFlowEdge, EdgeMarkerDefs } from './edges/ControlFlowEdge';
import { NodePalette } from './panels/NodePalette';
import { NodeConfigPanel } from './panels/NodeConfigPanel';
import { MobileHistoryOverlay } from './panels/MobileHistoryOverlay';
import { RunStepPanel } from './panels/RunStepPanel';
import { STATUS_STYLES } from './panels/ExecutionHistoryPanel';
import { mapTraceToNodeStates } from './run-view';
import { useLiveExecution } from './useLiveExecution';
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
  // No markerEnd here: ControlFlowEdge points at its own markers (EdgeMarkerDefs)
  // so the arrowhead can follow the stroke colour per state. React Flow's
  // injected ArrowClosed takes one static colour, which left a grey head on a
  // blue selected edge.
};

interface AutomationEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeId: string;
  existingAutomation?: Automation;
  onSaved?: () => void;
  onDelete?: (id: string) => Promise<void>;
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
  onDelete?: (id: string) => Promise<void>;
  onClose: () => void;
}) {
  const isInMacApp = typeof window !== 'undefined' && !!(window as any).isHomecastMacApp;
  const isNew = !existingAutomation;

  // Finger jitter on touch screens exceeds React Flow's default 1px drag
  // threshold, so a tap registered as a micro-drag: the node got selected but
  // the click that opens it never fired, and opening a node took two taps
  // with nothing visibly happening on the first. A generous threshold makes a
  // tap a tap (opens on first tap) and a real drag a drag.
  const isCoarsePointer = typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;

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

  // Names for humanizing execution-history rows (resolved at render time, so
  // traces recorded before the capture upgrades humanize too).
  const entitySource = useMemo(() => ({
    accessories: accessories.map((a) => ({ id: a.id, name: a.name })),
    serviceGroups: serviceGroups.map((g) => ({ id: g.id, name: g.name })),
    scenes: scenes.map((s) => ({ id: s.id, name: s.name })),
  }), [accessories, serviceGroups, scenes]);

  // GraphQL
  const [saveHcAutomation] = useMutation(SAVE_HC_AUTOMATION);

  // Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<FlowNodeData>>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [automationName, setAutomationName] = useState(existingAutomation?.name ?? 'New automation');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [configNodeId, setConfigNodeId] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  // Two separate mobile overlays for two separate jobs: + opens the node
  // palette, the History button opens executions/versions. Mutually exclusive.
  const [showMobilePalette, setShowMobilePalette] = useState(false);
  const [showMobileHistory, setShowMobileHistory] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ nodeId: string; x: number; y: number } | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [showCloseWarning, setShowCloseWarning] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);

  // Run view: a selected execution overlaid on the canvas, read-only.
  const [viewedTrace, setViewedTrace] = useState<any>(null);
  const [runViewNodeId, setRunViewNodeId] = useState<string | null>(null);
  const runView = viewedTrace != null;

  // Live view: follow runs as they execute (engine in this context only).
  const [followLive, setFollowLive] = useState(false);
  const liveModeRef = useRef(false);

  const handleSaveRef = useRef<(() => void) | null>(null);

  // Existing automation ID for update
  const existingIdRef = useRef(existingAutomation?.id);

  // Only receives events when the engine runs in this WebView (relay Mac).
  const liveTrace = useLiveExecution(existingIdRef.current);

  // Undo/redo — single state object so commit/undo/redo stay consistent
  type GraphSnapshot = { nodes: Node<FlowNodeData>[]; edges: Edge[] };
  const [history, setHistory] = useState<{ entries: GraphSnapshot[]; index: number }>({ entries: [], index: -1 });
  const isUndoRedoRef = useRef(false);

  // Always-fresh view of current nodes/edges for imperative history commits
  const latestRef = useRef<GraphSnapshot>({ nodes: [], edges: [] });
  latestRef.current = { nodes, edges };

  const commitHistory = useCallback(() => {
    if (isUndoRedoRef.current) return;
    const snapshot: GraphSnapshot = {
      nodes: JSON.parse(JSON.stringify(latestRef.current.nodes)),
      edges: JSON.parse(JSON.stringify(latestRef.current.edges)),
    };
    setHistory((prev) => {
      const trimmed = prev.entries.slice(0, prev.index + 1);
      const entries = [...trimmed, snapshot].slice(-75);
      return { entries, index: entries.length - 1 };
    });
  }, []);

  // Debounced commit for continuous edits (typing in sticky notes, config fields)
  const debouncedCommitRef = useRef<number | null>(null);
  const commitHistoryDebounced = useCallback(() => {
    if (debouncedCommitRef.current) window.clearTimeout(debouncedCommitRef.current);
    debouncedCommitRef.current = window.setTimeout(() => {
      commitHistory();
      debouncedCommitRef.current = null;
    }, 400);
  }, [commitHistory]);

  // Load existing automation into graph
  useEffect(() => {
    if (existingAutomation) {
      const { nodes: loaded, edges: loadedEdges } = automationToGraph(
        existingAutomation,
        { accessories, serviceGroups },
      );
      setNodes(loaded);
      setEdges(loadedEdges);
      // Seed initial history entry once state is applied
      setTimeout(() => {
        latestRef.current = { nodes: loaded, edges: loadedEdges };
        commitHistory();
      }, 0);
    } else {
      // Seed empty initial entry for new automations
      setTimeout(() => commitHistory(), 0);
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Node subtitles name the accessory/group a node targets, but that name is
  // resolved from HomeKit data which loads asynchronously — on a cold cache the
  // graph mounts first and every node reads as a truncated id. Relabel once the
  // names land, touching ONLY the subtitle so positions and in-progress edits
  // survive, and only the first time so it can never stomp a later edit.
  const relabeledRef = useRef(false);
  useEffect(() => {
    if (relabeledRef.current || !existingAutomation) return;
    if (accessories.length === 0 && serviceGroups.length === 0) return;
    relabeledRef.current = true;

    const { nodes: relabeled } = automationToGraph(existingAutomation, { accessories, serviceGroups });
    const subtitles = new Map(relabeled.map((n) => [n.id, n.data.subtitle]));
    setNodes((current) =>
      current.map((n) =>
        subtitles.has(n.id) && subtitles.get(n.id) !== n.data.subtitle
          ? { ...n, data: { ...n.data, subtitle: subtitles.get(n.id) } }
          : n,
      ),
    );
  }, [accessories, serviceGroups, existingAutomation, setNodes]);

  const selectedNode = useMemo(
    () => nodes.find((n) => n.id === selectedNodeId),
    [nodes, selectedNodeId],
  );

  const configNode = useMemo(
    () => nodes.find((n) => n.id === configNodeId),
    [nodes, configNodeId],
  );

  // ============================================================
  // Run view (execution overlaid on the canvas)
  // ============================================================

  const enterRunView = useCallback((parsed: unknown) => {
    setViewedTrace(parsed);
    setRunViewNodeId(null);
    setConfigNodeId(null);
    setSelectedNodeId(null);
    setContextMenu(null);
    setShowMobilePalette(false);
    setShowMobileHistory(false);
  }, []);

  const exitRunView = useCallback(() => {
    liveModeRef.current = false;
    setViewedTrace(null);
    setRunViewNodeId(null);
  }, []);

  // Follow a run live: automatic for Run Test (the user just asked for it),
  // opt-in via the Executions tab's Live toggle for real triggers — an
  // automation firing in the background must not yank an editing session
  // into read-only run view uninvited.
  useEffect(() => {
    if (!liveTrace) return;
    if (liveTrace.status === 'running' && !liveModeRef.current && (liveTrace.isTest || followLive)) {
      liveModeRef.current = true;
      // A followed background run enters plain run view; a live test keeps
      // the config panel (and its Run Test button) where the user left it.
      if (!liveTrace.isTest) {
        setSelectedNodeId(null);
        setConfigNodeId(null);
      }
      setContextMenu(null);
    }
    if (liveModeRef.current) setViewedTrace(liveTrace);
  }, [liveTrace, followLive]);

  const runStates = useMemo(
    () => (runView ? mapTraceToNodeStates(viewedTrace?.steps, nodes.map((n) => n.id)) : null),
    [runView, viewedTrace, nodes],
  );

  // Decorated at render only — stored node state, undo history and the dirty
  // flag never see execution data. Outside run view this returns `nodes`
  // itself, so the normal editing path pays nothing.
  const displayNodes = useMemo(() => {
    if (!runStates) return nodes;
    return nodes.map((n) => {
      if (n.type === 'stickyNote') return n;
      const state = runStates.get(n.id);
      return {
        ...n,
        data: {
          ...n.data,
          executionState: state?.executionState ?? 'skipped',
          executionTime: state?.executionTime,
          executionError: state?.executionError,
        },
      };
    });
  }, [nodes, runStates]);

  const runViewNode = useMemo(
    () => (runView && runViewNodeId ? nodes.find((n) => n.id === runViewNodeId) : undefined),
    [runView, runViewNodeId, nodes],
  );

  // Connection handling
  const onConnect: OnConnect = useCallback(
    (connection: Connection) => {
      if (runView) return;
      setEdges((eds) => addEdge({ ...connection, type: 'controlFlow' }, eds));
      setIsDirty(true);
      // Defer so latestRef picks up the new edges
      setTimeout(() => commitHistory(), 0);
    },
    [setEdges, commitHistory, runView],
  );

  // Commit history after a node drag completes (captures the move)
  const onNodeDragStop = useCallback(() => {
    setIsDirty(true);
    commitHistory();
  }, [commitHistory]);

  // React Flow delete key → cascade edge cleanup + dirty + history
  const onNodesDelete = useCallback(
    (deleted: Node[]) => {
      const ids = new Set(deleted.map((n) => n.id));
      setEdges((eds) => eds.filter((e) => !ids.has(e.source) && !ids.has(e.target)));
      if (selectedNodeId && ids.has(selectedNodeId)) setSelectedNodeId(null);
      if (configNodeId && ids.has(configNodeId)) setConfigNodeId(null);
      setIsDirty(true);
      setTimeout(() => commitHistory(), 0);
    },
    [setEdges, selectedNodeId, configNodeId, commitHistory],
  );

  const onEdgesDelete = useCallback(() => {
    setIsDirty(true);
    setTimeout(() => commitHistory(), 0);
  }, [commitHistory]);

  // Single-click: select + open config panel (in run view: the step inspector)
  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (runView) {
      if (node.type !== 'stickyNote') {
        setRunViewNodeId(node.id);
        setConfigNodeId(null);
        setSelectedNodeId(null);
      }
      return;
    }
    setSelectedNodeId(node.id);
    setConfigNodeId(node.id);
  }, [runView]);

  // Double-click: open config tray
  const onNodeDoubleClick = useCallback((_: React.MouseEvent, node: Node) => {
    if (runView) return;
    setSelectedNodeId(node.id);
    setConfigNodeId(node.id);
  }, [runView]);

  const onPaneClick = useCallback((event: React.MouseEvent) => {
    // A nested picker (device / service group / characteristic / scene) closes
    // on pointer-down, so the trailing `click` lands on the canvas underneath
    // and would clear the very config panel the user was editing — the picker
    // appeared to slam shut the moment you chose an accessory.
    //
    // Two guards: ignore a click whose target is no longer in the document
    // (the overlay that received it has since unmounted), and ignore any click
    // while another dialog is still open above us.
    const target = event.target as globalThis.Node | null;
    if (target && !document.contains(target)) return;
    if (document.querySelector('[role="dialog"][data-state="open"] [data-picker-surface]')) return;

    setSelectedNodeId(null);
    setConfigNodeId(null);
    setContextMenu(null);
  }, []);

  const onNodeContextMenu = useCallback((event: React.MouseEvent, node: Node) => {
    event.preventDefault();
    if (runView) return;
    setContextMenu({ nodeId: node.id, x: event.clientX, y: event.clientY });
  }, [runView]);

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
    setTimeout(() => commitHistory(), 0);
  }, [nodes, setNodes, commitHistory]);

  const toggleNodeEnabled = useCallback((nodeId: string) => {
    setNodes((nds) => nds.map((n) => {
      if (n.id !== nodeId) return n;
      const d = n.data as FlowNodeData;
      return { ...n, data: { ...d, enabled: !d.enabled } };
    }));
    setIsDirty(true);
    setContextMenu(null);
    setTimeout(() => commitHistory(), 0);
  }, [setNodes, commitHistory]);


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
      if (runView) return;
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
      setTimeout(() => commitHistory(), 0);
    },
    [nodes, setNodes, commitHistory, runView],
  );

  // Update node config — debounced history commit so typing collapses into one entry
  const updateNodeData = useCallback(
    (nodeId: string, updates: Partial<FlowNodeData>) => {
      setNodes((nds) =>
        nds.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, ...updates } } : n)),
      );
      setIsDirty(true);
      commitHistoryDebounced();
    },
    [setNodes, commitHistoryDebounced],
  );

  // Delete node (called from context menu + config panel + onNodesDelete cascade)
  const deleteNode = useCallback(
    (nodeId: string) => {
      setNodes((nds) => nds.filter((n) => n.id !== nodeId));
      setEdges((eds) => eds.filter((e) => e.source !== nodeId && e.target !== nodeId));
      if (selectedNodeId === nodeId) setSelectedNodeId(null);
      if (configNodeId === nodeId) setConfigNodeId(null);
      setIsDirty(true);
      setTimeout(() => commitHistory(), 0);
    },
    [setNodes, setEdges, selectedNodeId, configNodeId, commitHistory],
  );

  const undo = useCallback(() => {
    if (history.index <= 0) return;
    const entry = history.entries[history.index - 1];
    if (!entry) return;
    isUndoRedoRef.current = true;
    setNodes(entry.nodes);
    setEdges(entry.edges);
    setHistory((prev) => ({ ...prev, index: prev.index - 1 }));
    setIsDirty(true);
    setTimeout(() => { isUndoRedoRef.current = false; }, 0);
  }, [history, setNodes, setEdges]);

  const redo = useCallback(() => {
    if (history.index >= history.entries.length - 1) return;
    const entry = history.entries[history.index + 1];
    if (!entry) return;
    isUndoRedoRef.current = true;
    setNodes(entry.nodes);
    setEdges(entry.edges);
    setHistory((prev) => ({ ...prev, index: prev.index + 1 }));
    setIsDirty(true);
    setTimeout(() => { isUndoRedoRef.current = false; }, 0);
  }, [history, setNodes, setEdges]);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Run view: Escape leaves it; editing shortcuts are inert.
      if (runView) {
        if (e.key === 'Escape') exitRunView();
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo(); else undo();
      }
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        handleSaveRef.current?.();
      }
      // Delete / Backspace — delete the currently selected node, unless
      // focus is inside an editable field (config panel, sticky note textarea).
      if (e.key === 'Delete' || e.key === 'Backspace') {
        const target = e.target as HTMLElement | null;
        const tag = target?.tagName;
        const editable = target?.isContentEditable
          || tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
        if (!editable && selectedNodeId) {
          e.preventDefault();
          deleteNode(selectedNodeId);
        }
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undo, redo, selectedNodeId, deleteNode, runView, exitRunView]);

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

  // Save without closing the editor (for test-before-run)
  const saveOnly = useCallback(async () => {
    if (!automationName.trim() || !homeId) return;
    setIsSaving(true);
    try {
      const automation = graphToAutomation(nodes, edges, automationName, homeId, existingIdRef.current);
      await saveHcAutomation({
        variables: { homeId, automationId: automation.id, data: JSON.stringify(automation) },
      });
      existingIdRef.current = automation.id;
      setIsDirty(false);
    } catch (e) {
      console.error('[AutomationEditor] Save failed:', e);
      toast.error('Failed to save automation');
    } finally {
      setIsSaving(false);
    }
  }, [automationName, homeId, nodes, edges, saveHcAutomation]);

  // Keep ref in sync for keyboard shortcut
  handleSaveRef.current = handleSave;



  return (
    <div className="flex flex-col h-full safe-area-top safe-area-bottom safe-area-left safe-area-right" data-testid="automation-editor">
      {/* Toolbar */}
      <div className="h-12 border-b flex items-center gap-1 sm:gap-2 px-2 sm:px-3 shrink-0">
        {/* Mobile palette toggle */}
        <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" onClick={() => { setShowMobileHistory(false); setShowMobilePalette((v) => !v); }} data-testid="mobile-palette-button">
          <Plus className="h-4 w-4" />
        </Button>
        {/* Mobile history entry (executions + versions) — saved automations only */}
        {existingIdRef.current && (
          <Button variant="ghost" size="icon" className="h-8 w-8 sm:hidden" onClick={() => { setShowMobilePalette(false); setShowMobileHistory((v) => !v); }} data-testid="mobile-history-button">
            <History className="h-4 w-4" />
          </Button>
        )}
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
          <Button variant="ghost" size="icon" onClick={undo} disabled={history.index <= 0} className="h-8 w-8 hidden sm:flex">
            <Undo2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger><TooltipContent side="bottom">Undo (⌘Z)</TooltipContent></Tooltip>
        <Tooltip><TooltipTrigger asChild>
          <Button variant="ghost" size="icon" onClick={redo} disabled={history.index >= history.entries.length - 1} className="h-8 w-8 hidden sm:flex">
            <Redo2 className="h-3.5 w-3.5" />
          </Button>
        </TooltipTrigger><TooltipContent side="bottom">Redo (⌘⇧Z)</TooltipContent></Tooltip>
        <div className="flex-1" />
        {!isNew && onDelete && (
          <Button
            variant="ghost"
            size="icon"
            className="h-8 w-8 sm:w-auto sm:px-3 text-muted-foreground hover:text-destructive"
            onClick={() => setShowDeleteConfirm(true)}
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
        <NodePalette
          onAddNode={addNewNode}
          automationId={existingIdRef.current}
          homeId={homeId}
          onVersionRestored={() => onClose()}
          collapsed={sidebarCollapsed}
          onToggleCollapse={() => setSidebarCollapsed((prev) => !prev)}
          entitySource={entitySource}
          onSelectTrace={enterRunView}
          followLive={followLive}
          onToggleFollowLive={() => setFollowLive((v) => !v)}
        />

        {/* Mobile palette overlay */}
        {showMobilePalette && (
          <div className="absolute inset-0 z-20 bg-background/95 backdrop-blur-sm sm:hidden flex flex-col">
            <div className="p-3 border-b flex items-center justify-between shrink-0">
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

        {/* Mobile history overlay (executions + versions) */}
        {showMobileHistory && existingIdRef.current && (
          <MobileHistoryOverlay
            automationId={existingIdRef.current}
            homeId={homeId}
            entitySource={entitySource}
            onSelectTrace={enterRunView}
            followLive={followLive}
            onToggleFollowLive={() => setFollowLive((v) => !v)}
            onVersionRestored={() => onClose()}
            onClose={() => setShowMobileHistory(false)}
          />
        )}

        {/* Center: React Flow canvas */}
        <div className="flex-1 relative min-h-0" onDragOver={onDragOver} onDrop={onDrop}>
          <ReactFlow
            nodes={displayNodes}
            edges={edges}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onConnect={onConnect}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onPaneClick={onPaneClick}
            onNodeContextMenu={onNodeContextMenu}
            onNodeDragStop={onNodeDragStop}
            onNodesDelete={onNodesDelete}
            onEdgesDelete={onEdgesDelete}
            nodeTypes={nodeTypes}
            edgeTypes={edgeTypes}
            defaultEdgeOptions={defaultEdgeOptions}
            fitView
            snapToGrid
            snapGrid={[16, 16]}
            nodesDraggable={!runView}
            nodesConnectable={!runView}
            nodeDragThreshold={isCoarsePointer ? 18 : 1}
            deleteKeyCode={runView ? null : ['Backspace', 'Delete']}
            className="bg-muted/20"
            proOptions={{ hideAttribution: true }}
          >
            <EdgeMarkerDefs />
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

          {/* Run view banner */}
          {runView && (() => {
            const isLive = viewedTrace.status === 'running';
            const status = isLive
              ? { color: 'text-blue-500', icon: Loader2, label: 'Running' }
              : (STATUS_STYLES[viewedTrace.status] ?? STATUS_STYLES.error);
            const StatusIcon = status.icon;
            const started = viewedTrace.startedAt ? new Date(viewedTrace.startedAt) : null;
            const durationS = viewedTrace.startedAt && viewedTrace.finishedAt
              ? ((Date.parse(viewedTrace.finishedAt) - Date.parse(viewedTrace.startedAt)) / 1000).toFixed(2)
              : null;
            return (
              <div className="absolute top-2 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-background border shadow-sm rounded-full pl-3 pr-1.5 py-1 max-w-[calc(100%-16px)]">
                <History className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                <StatusIcon className={cn('w-3.5 h-3.5 shrink-0', status.color, isLive && 'animate-spin')} />
                <span className="text-xs whitespace-nowrap truncate">
                  {status.label}
                  {!isLive && started && ` · ${formatDistanceToNow(started, { addSuffix: true }).replace('about ', '')}`}
                  {durationS && ` · ${durationS}s`}
                </span>
                <Button variant="ghost" size="sm" className="h-6 px-2 text-xs shrink-0" onClick={exitRunView} data-testid="exit-run-view">
                  Exit run view
                </Button>
              </div>
            );
          })()}

          {/* Context menu */}
          {contextMenu && (
            <div
              className="fixed z-[10060] bg-popover border rounded-lg shadow-lg py-1 min-w-[140px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              {[
                { label: 'Configure', action: () => { const n = nodes.find(n => n.id === contextMenu.nodeId); if (n) { setSelectedNodeId(n.id); setConfigNodeId(n.id); } setContextMenu(null); } },
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

        {/* Run view: step inspector in the config-panel slot. The config panel
            wins the slot when open (a live Run Test keeps it up). */}
        {runView && runViewNode && !configNode && (
          <div className="absolute inset-0 z-10 sm:absolute sm:inset-auto sm:right-3 sm:top-3 sm:bottom-3 sm:w-80">
            <RunStepPanel
              nodeId={runViewNode.id}
              nodeLabel={(runViewNode.data as FlowNodeData).label}
              trace={viewedTrace}
              entitySource={entitySource}
              onClose={() => setRunViewNodeId(null)}
            />
          </div>
        )}

        {/* Right: Config panel (floating card on desktop, full overlay on mobile) */}
        {configNode && (
          <div className="absolute inset-0 z-10 sm:absolute sm:inset-auto sm:right-3 sm:top-3 sm:bottom-3 sm:w-80">
          <NodeConfigPanel
            node={configNode}
            allNodes={nodes}
            allEdges={edges}
            onUpdateData={(updates) => updateNodeData(configNode.id, updates)}
            onDelete={() => deleteNode(configNode.id)}
            onClose={() => { setConfigNodeId(null); setSelectedNodeId(null); }}
            accessories={accessories}
            homes={homes}
            scenes={scenes}
            serviceGroups={serviceGroups}
            availableAutomations={availableAutomations}
            automationId={existingIdRef.current ?? undefined}
            homeId={homeId}
            onSaveBeforeTest={isDirty ? saveOnly : undefined}
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

      {/* Delete confirmation */}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete automation</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this automation. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={async () => {
                setShowDeleteConfirm(false);
                try {
                  await onDelete?.(existingIdRef.current ?? '');
                  onClose();
                } catch {
                  toast.error('Failed to delete automation');
                }
              }}
            >
              Delete
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
  onDelete?: (id: string) => Promise<void>;
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
  const isInMacApp = typeof window !== 'undefined' && !!(window as any).isHomecastMacApp;
  // Mac app: equal 48px inset on all sides to clear titlebar area
  const sizeClass = isInMacApp
    ? "!max-w-[100vw] sm:!max-w-[calc(100vw-88px)] !w-[100vw] sm:!w-[calc(100vw-88px)] !rounded-none sm:!rounded-2xl p-0 gap-0 flex flex-col overflow-hidden !h-[100dvh] sm:!h-[calc(100dvh-88px)] !max-h-[100dvh] sm:!max-h-[calc(100dvh-88px)]"
    : "!max-w-[100vw] sm:!max-w-[calc(100vw-48px)] !w-[100vw] sm:!w-[calc(100vw-48px)] !rounded-none sm:!rounded-2xl p-0 gap-0 flex flex-col overflow-hidden !h-[100dvh] sm:!h-[calc(100dvh-48px)] !max-h-[100dvh] sm:!max-h-[calc(100dvh-48px)]";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={sizeClass}
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
