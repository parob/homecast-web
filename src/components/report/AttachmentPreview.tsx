/**
 * Looking at an attachment properly before sending it.
 *
 * A 48px thumbnail tells you a file exists, not whether it shows the thing you
 * were trying to show. For a screen recording that is the only question worth
 * asking — you were reproducing a bug while the app was in front of you and had
 * no way to watch what got captured.
 *
 * A plain fixed overlay rather than a nested Dialog: this opens from inside the
 * report sheet, and stacking a second focus trap on the first is more machinery
 * than one full-screen image needs. The z-index clears the mobile tab bar
 * (z-[10001]) and the recording pill above it.
 */

import { useEffect } from 'react';
import { X } from 'lucide-react';

import type { CapturedMedia } from '@/lib/report/capture';

interface AttachmentPreviewProps {
  media: CapturedMedia;
  onClose: () => void;
}

export function AttachmentPreview({ media, onClose }: AttachmentPreviewProps) {
  // Escape closes it. The backdrop does too, but a keyboard user reaching for
  // Escape should not have to find a target first.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const isVideo = media.mimeType.startsWith('video/');

  return (
    <div
      data-report-exclude="true"
      className="fixed inset-0 z-[10003] flex items-center justify-center bg-black/90 p-4"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={media.filename}
    >
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
    </div>
  );
}
