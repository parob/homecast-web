// Sticky note node — canvas annotation, not serialized to automation JSON

import { memo, useCallback } from 'react';
import { type NodeProps, type Node, useReactFlow, NodeResizer } from '@xyflow/react';
import type { FlowNodeData } from '../constants';

export const StickyNoteNode = memo(function StickyNoteNode({ id, data, selected }: NodeProps<Node<FlowNodeData>>) {
  const nodeData = data as FlowNodeData;
  const { setNodes } = useReactFlow();

  const updateText = useCallback((text: string) => {
    setNodes((nds) => nds.map((n) =>
      n.id === id ? { ...n, data: { ...n.data, config: { ...n.data.config, text } } } : n,
    ));
  }, [id, setNodes]);

  return (
    <div
      className="relative"
      style={{ minWidth: 140, minHeight: 60 }}
    >
      <NodeResizer
        isVisible={selected}
        minWidth={140}
        minHeight={60}
        lineClassName="!border-amber-400"
        handleClassName="!w-2 !h-2 !bg-amber-400 !border-amber-500"
      />
      <div
        className="w-full h-full rounded-lg p-3 shadow-sm border"
        style={{
          backgroundColor: 'hsl(48 96% 89%)',
          borderColor: 'hsl(48 96% 76%)',
        }}
      >
        <textarea
          value={(nodeData.config.text as string) ?? ''}
          onChange={(e) => updateText(e.target.value)}
          placeholder="Add a note..."
          className="w-full h-full bg-transparent resize-none text-xs text-amber-900 placeholder:text-amber-400 focus:outline-none"
          style={{ minHeight: 40 }}
        />
      </div>
    </div>
  );
});
