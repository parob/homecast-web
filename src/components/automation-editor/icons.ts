// Single icon registry for the automation editor.
//
// BaseNode and NodePalette each used to keep their own hand-maintained map, and
// they drifted: five node types added to the palette had no entry in either, so
// they silently fell back to the same lightning bolt and were indistinguishable
// from each other on the canvas. One registry, plus a test that every node
// definition resolves, makes that impossible to repeat.

import {
  Zap, Clock, Globe, AlertCircle, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow, StickyNote,
  Repeat, ListTree, Split, Variable, CircleStop, ToggleLeft, WifiOff,
} from 'lucide-react';

export const NODE_ICONS: Record<string, React.ElementType> = {
  Zap, Clock, Globe, AlertCircle, Lightbulb, Play, Timer, Bell, Send,
  GitBranch, GitMerge, Pause, Code, Workflow, StickyNote,
  Repeat, ListTree, Split, Variable, CircleStop, ToggleLeft, WifiOff,
};

/** Resolve a node definition's icon name, falling back to a neutral glyph. */
export function getNodeIcon(name: string): React.ElementType {
  return NODE_ICONS[name] ?? Zap;
}
