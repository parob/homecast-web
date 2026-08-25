/**
 * The report sheet — what a shake opens.
 *
 * Design notes, since the shape here is deliberate:
 *
 * The screenshot is captured BEFORE this sheet renders. By the time someone has
 * read a prompt and typed a sentence, the screen they were complaining about is
 * behind a dialog and the logs have moved on. It is taken at the moment of the
 * shake, which is the moment they meant.
 *
 * A recording is the opposite: it necessarily runs FORWARD, so it is a "show us
 * what happens" tool rather than a replay of what already did. There is no
 * rolling buffer to draw on — neither ReplayKit nor getDisplayMedia offers one,
 * and capturing continuously to fake it would mean an always-on screen recorder
 * on someone's phone. So while recording, this sheet gets out of the way
 * entirely; a dialog left covering the app would record the dialog.
 *
 * There is exactly one required field. Everything else — version, connection
 * state, route, the last 500 log lines — is attached without being asked for,
 * because a person who has just hit a bug will not fill in a form, and none of
 * it is information they have anyway.
 *
 * What IS attached is listed, with a preview, and can be removed. Attaching a
 * screenshot and a log buffer silently would be a poor trade for trust.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, ImagePlus, Loader2, Trash2, Video,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  MAX_ATTACHMENT_BYTES, MAX_RECORDING_MS, canRecord, startRecording,
  type ActiveRecording, type CapturedMedia,
} from '@/lib/report/capture';
import { submitReport } from '@/lib/report/submit';

import { RecordingOverlay } from './RecordingOverlay';
import { ReportedIssues } from './ReportedIssues';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

/**
 * Every report is filed at the same severity.
 *
 * Asking was a question only the person reading the issue can answer: a reporter
 * has no idea whether what they hit is a nuisance or data loss, and the answer
 * changed nothing about how the report was handled. The field stays in the wire
 * format — the issue reporter still wants one — it is just no longer a question.
 */
const REPORT_SEVERITY = 'warning';

/** Enough evidence for any issue; past this it is an upload problem. */
const MAX_ATTACHMENTS = 6;

interface ReportSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Captured at the moment of the shake, before this sheet covered the screen. */
  initialScreenshot?: CapturedMedia | null;
}

export function ReportSheet({ open, onOpenChange, initialScreenshot }: ReportSheetProps) {
  const [summary, setSummary] = useState('');
  const [media, setMedia] = useState<CapturedMedia[]>([]);
  const [recording, setRecording] = useState<ActiveRecording | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // A shell can claim it records and then refuse: iOS reports
  // RPScreenRecorder.isAvailable as true in the Simulator and fails every
  // start. One refusal is a fact about this device, so stop offering it rather
  // than letting someone press a dead button over and over.
  const [recordingRefused, setRecordingRefused] = useState(false);

  const recordingRef = useRef<ActiveRecording | null>(null);
  recordingRef.current = recording;
  const mediaRef = useRef<CapturedMedia[]>([]);
  mediaRef.current = media;
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMedia(initialScreenshot ? [initialScreenshot] : []);
    setSummary('');
    setError(null);
  }, [open, initialScreenshot]);

  // Object URLs outlive the component unless revoked, and a screen recording is
  // large enough for that to matter.
  useEffect(() => () => {
    mediaRef.current.forEach((item) => URL.revokeObjectURL(item.previewUrl));
    recordingRef.current?.cancel();
  }, []);

  // Elapsed time for the overlay. Only ticks while recording.
  useEffect(() => {
    if (!recording) return;
    const startedAt = Date.now();
    setElapsedMs(0);
    const timer = window.setInterval(() => setElapsedMs(Date.now() - startedAt), 250);
    return () => window.clearInterval(timer);
  }, [recording]);

  const addMedia = useCallback((item: CapturedMedia) => {
    // Reject here rather than letting it fail two hops away with a 413 that
    // says nothing useful.
    if (item.blob.size > MAX_ATTACHMENT_BYTES) {
      URL.revokeObjectURL(item.previewUrl);
      toast.error(
        `${item.filename} is too large (${(item.blob.size / 1024 / 1024).toFixed(1)} MB).`,
        { description: `The limit is ${Math.round(MAX_ATTACHMENT_BYTES / 1024 / 1024)} MB — try a shorter recording.` },
      );
      return;
    }
    setMedia((current) => {
      if (current.length >= MAX_ATTACHMENTS) {
        URL.revokeObjectURL(item.previewUrl);
        toast.error(`You can attach up to ${MAX_ATTACHMENTS} files.`);
        return current;
      }
      return [...current, item];
    });
  }, []);

  const removeMedia = useCallback((index: number) => {
    setMedia((current) => {
      const next = [...current];
      const [removed] = next.splice(index, 1);
      if (removed) URL.revokeObjectURL(removed.previewUrl);
      return next;
    });
  }, []);

  const finishRecording = useCallback(async () => {
    const active = recordingRef.current;
    if (!active) return;
    setRecording(null);
    const captured = await active.stop();
    if (captured) addMedia(captured);
    else toast.error('The recording could not be saved.');
  }, [addMedia]);

  const beginRecording = useCallback(async () => {
    if (media.length >= MAX_ATTACHMENTS) {
      toast.error(`You can attach up to ${MAX_ATTACHMENTS} files.`);
      return;
    }
    // Starting can show a picker (desktop) or a system prompt (iOS), so it must
    // stay a direct result of the user's tap.
    try {
      const active = await startRecording(() => { void finishRecording(); });
      // Null covers dismissing the picker, which is a choice rather than a fault.
      if (active) setRecording(active);
    } catch (recordError) {
      // A failure used to be indistinguishable from a cancellation: both came
      // back as null and the button appeared to do nothing at all. It has to
      // say something once — and then stop offering itself.
      const unavailable =
        recordError instanceof Error && recordError.message.includes('UNAVAILABLE');
      if (unavailable) setRecordingRefused(true);
      toast.error('Screen recording could not start.', {
        description: unavailable
          ? "This device can't record the screen — attach a screenshot instead."
          : 'Try again, or attach a screenshot instead.',
      });
    }
  }, [media.length, finishRecording]);

  const addFromLibrary = useCallback((files: FileList | null) => {
    if (!files) return;
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) {
        toast.error(`${file.name} is not an image.`);
        continue;
      }
      addMedia({
        blob: file,
        mimeType: file.type,
        filename: file.name || 'image',
        previewUrl: URL.createObjectURL(file),
      });
    }
  }, [addMedia]);

  const send = useCallback(async () => {
    const text = summary.trim();
    if (!text) {
      setError('Please say something before sending.');
      return;
    }
    if (recordingRef.current) await finishRecording();

    setSending(true);
    setError(null);
    const token = localStorage.getItem('homecast-token');
    if (!token) {
      setSending(false);
      setError('You are signed out — nothing was sent.');
      return;
    }

    try {
      const result = await submitReport(
        { summary: text, severity: REPORT_SEVERITY, media: mediaRef.current }, token,
      );
      toast.success(
        result.deduplicated
          ? `Added to #${result.issueNumber} — this is already known.`
          : `Sent as #${result.issueNumber}. Thank you.`,
        {
          description: result.attachmentsSkipped.length
            ? `Not included: ${result.attachmentsSkipped.join(', ')}`
            : undefined,
        },
      );
      onOpenChange(false);
    } catch (submitError) {
      // Never close on failure: closing would read as success, and the whole
      // point is that the user knows whether it was actually filed.
      setError(submitError instanceof Error ? submitError.message : 'Nothing was sent.');
    } finally {
      setSending(false);
    }
  }, [summary, finishRecording, onOpenChange]);

  const atLimit = media.length >= MAX_ATTACHMENTS;
  const offerRecording = canRecord() && !recordingRefused;

  return (
    <>
      {/* Hidden, not closed, while recording — the state and everything already
          typed survives, and the app underneath is clear to reproduce on. */}
      <Dialog
        open={open && !recording}
        onOpenChange={(next) => !sending && onOpenChange(next)}
      >
        {/* Bounded and scrollable. Unbounded, the sheet ran off the bottom of a
            phone and took the Record and Send buttons with it — everything below
            the fold was simply unreachable. `dvh` rather than `vh` so the mobile
            browser chrome collapsing does not change the answer. */}
        <DialogContent
          className="flex max-h-[85dvh] flex-col overflow-hidden sm:max-w-lg"
          data-report-exclude="true"
          // No DialogDescription any more; without this Radix warns about a
          // missing description on every open.
          aria-describedby={undefined}
        >
          <DialogHeader className="shrink-0">
            <DialogTitle>Feedback</DialogTitle>
          </DialogHeader>

          <Tabs defaultValue="report" className="flex min-h-0 min-w-0 flex-1 flex-col">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="report">New</TabsTrigger>
              {/* Often the answer someone actually wants: it is already known,
                  and possibly already fixed. */}
              <TabsTrigger value="known">Previous</TabsTrigger>
            </TabsList>

            <TabsContent
              value="known"
              className="-mx-1 mt-4 min-h-0 min-w-0 flex-1 overflow-y-auto px-1"
            >
              <ReportedIssues />
            </TabsContent>

            {/* `px-1 -mx-1`: the focus ring is drawn outside the element's box,
                and an overflow container clips whatever crosses its edge — so
                the textarea's ring lost its left and right sides the moment it
                was focused. The padding gives the ring room; the negative
                margin gives the padding back. */}
            <TabsContent
              value="report"
              className="-mx-1 mt-4 min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-1"
            >
            <Textarea
              id="report-summary"
              aria-label="Your feedback"
              autoFocus
              rows={4}
              value={summary}
              onChange={(event) => setSummary(event.target.value)}
              disabled={sending}
            />

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>Attached</Label>
                <span className="text-xs text-muted-foreground">
                  {media.length} of {MAX_ATTACHMENTS}
                </span>
              </div>

              <div className="space-y-2">
                {media.map((item, index) => (
                  <div
                    key={item.previewUrl}
                    className="flex items-center gap-3 rounded-md border p-2"
                  >
                    {item.mimeType.startsWith('image/') ? (
                      <img
                        src={item.previewUrl}
                        alt=""
                        className="h-12 w-12 rounded object-cover"
                      />
                    ) : item.mimeType.startsWith('video/') ? (
                      // Playable, not a placeholder. A recording you cannot
                      // watch is evidence you cannot check before sending it —
                      // and the one thing you want to know is whether it caught
                      // the thing you were trying to show.
                      <video
                        src={item.previewUrl}
                        controls
                        playsInline
                        preload="metadata"
                        className="h-20 w-32 shrink-0 rounded bg-black object-contain"
                      />
                    ) : (
                      <div className="flex h-12 w-12 items-center justify-center rounded bg-muted">
                        <Video className="h-5 w-5 text-muted-foreground" />
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm">{item.filename}</div>
                      <div className="text-xs text-muted-foreground">
                        {(item.blob.size / 1024).toFixed(0)} KB
                      </div>
                    </div>
                    <Button
                      type="button" variant="ghost" size="icon"
                      disabled={sending}
                      onClick={() => removeMedia(index)}
                      aria-label={`Remove ${item.filename}`}
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="grid grid-cols-2 gap-2">
                {offerRecording && (
                  <Button
                    type="button" variant="outline"
                    disabled={sending || atLimit}
                    onClick={() => void beginRecording()}
                    className="border-red-500/50 text-red-600 hover:bg-red-500/10 hover:text-red-600 dark:text-red-400 dark:hover:text-red-400"
                  >
                    {/* The red dot everyone already reads as "record", rather
                        than a camera glyph that could equally mean playback. */}
                    <span className="mr-2 h-2.5 w-2.5 shrink-0 rounded-full bg-red-500" />
                    Record screen
                  </Button>
                )}
                <Button
                  type="button" variant="outline"
                  disabled={sending || atLimit}
                  onClick={() => pickerRef.current?.click()}
                  className={offerRecording ? undefined : 'col-span-2'}
                >
                  <ImagePlus className="mr-2 h-4 w-4" />
                  Add image
                </Button>
              </div>
              <input
                ref={pickerRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(event) => {
                  addFromLibrary(event.target.files);
                  // Reset so picking the same file twice still fires onChange.
                  event.target.value = '';
                }}
              />
            </div>

            {error && (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            {/* No Cancel. The dialog's own close control is in the corner where
                everyone already looks for it, and a second way out sitting next
                to Send only made the destructive choice as prominent as the
                one people came here to make. */}
            <div className="flex justify-end">
              <Button type="button" disabled={sending} onClick={() => void send()}>
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  'Send'
                )}
              </Button>
            </div>
            </TabsContent>
          </Tabs>
        </DialogContent>
      </Dialog>

      {recording && (
        <RecordingOverlay
          elapsedMs={elapsedMs}
          maxMs={MAX_RECORDING_MS}
          onStop={() => void finishRecording()}
        />
      )}
    </>
  );
}
