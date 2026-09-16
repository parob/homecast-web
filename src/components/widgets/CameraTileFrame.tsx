import React from 'react';
import { ExpandedOverlay } from '@/components/shared/ExpandedOverlay';
import type { useCameraTileExpansion } from '@/hooks/useCameraTileExpansion';

/** Full-size grids need the same wide, floating camera viewer as compact grids. */
export function CameraTileFrame({ preview, children }: {
  preview: ReturnType<typeof useCameraTileExpansion>;
  children: React.ReactElement<{ expanded?: boolean; hero?: React.ReactNode }>;
}) {
  if (!preview.ownsExpansion) return children;
  return <div className="relative">
    {React.cloneElement(children, { expanded: false, hero: undefined })}
    <ExpandedOverlay isExpanded={preview.expanded} onClose={preview.close} centred>
      {children}
    </ExpandedOverlay>
  </div>;
}
