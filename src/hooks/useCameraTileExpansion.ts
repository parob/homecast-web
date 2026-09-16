import { useCallback, useState } from 'react';

/** Compact grids own their floating overlay. Full-size grids render the
 * widget directly, so camera tiles must be able to open their own preview.
 * This controls the full viewer; visible tiles fetch their background still
 * separately on a slower cadence.
 */
export function useCameraTileExpansion({
  previewAvailable, compact, expanded, onExpandToggle,
}: {
  previewAvailable: boolean;
  compact?: boolean;
  expanded?: boolean;
  onExpandToggle?: () => void;
}) {
  const [inlineExpanded, setInlineExpanded] = useState(false);
  const ownsExpansion = previewAvailable && !compact && expanded === undefined && !onExpandToggle;
  const close = useCallback(() => setInlineExpanded(false), []);
  return {
    ownsExpansion,
    close,
    expanded: expanded ?? (ownsExpansion && inlineExpanded),
    onExpandToggle: onExpandToggle ?? (ownsExpansion ? () => setInlineExpanded(value => !value) : undefined),
  };
}
