/**
 * Looking at an attachment properly before sending it.
 *
 * A 48px thumbnail tells you a file exists, not whether it shows the thing you
 * were trying to show. For a screen recording that is the only question worth
 * asking — you were reproducing a bug while the app was in front of you and had
 * no way to watch what got captured.
 *
 * A nested dialog participates in the report sheet's modal stack, so it owns
 * focus, pointer events and Escape while open. A fixed sibling behind that
 * stack cannot be made interactive merely by appearing later in the DOM.
 */

import { useState } from 'react';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { dialogElevation, topPanelElevation } from '@/lib/overlay-elevation';
import { X } from 'lucide-react';

import { EdgeSampleSlivers } from '@/components/shared/EdgeSampleSlivers';
import type { CapturedMedia } from '@/lib/report/capture';

interface AttachmentPreviewProps {
  media: CapturedMedia;
  onClose: () => void;
}

export function AttachmentPreview({ media, onClose }: AttachmentPreviewProps) {
  const [zIndex] = useState(() => dialogElevation(topPanelElevation()) + 1);

  const isVideo = media.mimeType.startsWith('video/');

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        hideCloseButton
        data-report-exclude="true"
        style={{ zIndex }}
        overlayClassName="bg-transparent"
        className="inset-0 left-0 top-0 flex h-[100dvh] w-screen max-w-none sm:max-w-none max-h-none translate-x-0 translate-y-0 items-center justify-center rounded-none border-0 bg-black/90 p-4"
        onClick={onClose}
      >
        <DialogTitle className="sr-only">{media.filename}</DialogTitle>
        {/* iOS Safari's bar bands, matched to this backdrop (black at 90%), and
            the canvas behind them — see EdgeSampleSlivers. */}
        {/* First child, no z-index: above this box's own black backdrop, below
            the picture and the close button — paint order in one stacking
            context is DOM order. */}
        <EdgeSampleSlivers dim={0.9} />
        <button
          type="button"
          onClick={onClose}
          aria-label="Close preview"
          className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          style={{ top: 'calc(var(--safe-area-top, 0px) + 1rem)' }}
        >
          <X className="h-5 w-5" />
        </button>

        {/* Stop the backdrop's close handler firing on the video's own controls —
            scrubbing a recording should not dismiss it. */}
        <div className="max-h-full max-w-full" onClick={(event) => event.stopPropagation()}>
          {isVideo ? (
            <video
              src={media.previewUrl}
              controls
              autoPlay
              playsInline
              className="max-h-[85vh] max-w-full rounded"
            />
          ) : (
            <img
              src={media.previewUrl}
              alt={media.filename}
              className="max-h-[85vh] max-w-full rounded object-contain"
            />
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
