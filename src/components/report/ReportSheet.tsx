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
  AlertCircle, Check, ImagePlus, Loader2, Trash2, Video, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle,
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

type Severity = 'info' | 'warning' | 'critical';

const SEVERITIES: { value: Severity; label: string; hint: string }[] = [
  { value: 'info', label: 'Minor', hint: 'A suggestion or annoyance' },
  { value: 'warning', label: 'Wrong', hint: 'Something behaved incorrectly' },
  { value: 'critical', label: 'Broken', hint: 'Unusable, or something was lost' },
];

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
  const [severity, setSeverity] = useState<Severity>('warning');
  const [media, setMedia] = useState<CapturedMedia[]>([]);
  const [recording, setRecording] = useState<ActiveRecording | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const recordingRef = useRef<ActiveRecording | null>(null);
  recordingRef.current = recording;
  const mediaRef = useRef<CapturedMedia[]>([]);
  mediaRef.current = media;
  const pickerRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setMedia(initialScreenshot ? [initialScreenshot] : []);
    setSummary('');
    setSeverity('warning');
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
    const active = await startRecording(() => { void finishRecording(); });
    // Null covers dismissing the picker, which is a choice rather than a fault.
    if (active) setRecording(active);
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
      setError('Please describe what went wrong.');
      return;
    }
    if (recordingRef.current) await finishRecording();

    setSending(true);
    setError(null);
    const token = localStorage.getItem('homecast-token');
    if (!token) {
      setSending(false);
      setError('You are signed out — the report was not filed.');
      return;
    }

    try {
      const result = await submitReport(
        { summary: text, severity, media: mediaRef.current }, token,
      );
      toast.success(
        result.deduplicated
          ? `Added to issue #${result.issueNumber} — this is already known.`
          : `Reported as issue #${result.issueNumber}. Thank you.`,
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
      setError(submitError instanceof Error ? submitError.message : 'The report was not filed.');
    } finally {
      setSending(false);
    }
  }, [summary, severity, finishRecording, onOpenChange]);

  const atLimit = media.length >= MAX_ATTACHMENTS;

  return (
    <>
      {/* Hidden, not closed, while recording — the state and everything already
          typed survives, and the app underneath is clear to reproduce on. */}
      <Dialog
        open={open && !recording}
        onOpenChange={(next) => !sending && onOpenChange(next)}
      >
        <DialogContent className="sm:max-w-lg" data-report-exclude="true">
          <DialogHeader>
            <DialogTitle>Report a problem</DialogTitle>
            <DialogDescription>
              This goes straight to the people building Homecast, with what was
              on screen and the app's recent logs attached.
            </DialogDescription>
          </DialogHeader>

          <Tabs defaultValue="report">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="report">Report</TabsTrigger>
              {/* Often the answer someone actually wants: it is already known,
                  and possibly already fixed. */}
              <TabsTrigger value="known">Already reported</TabsTrigger>
            </TabsList>

            <TabsContent value="known" className="mt-4">
              <ReportedIssues />
            </TabsContent>

            <TabsContent value="report" className="mt-4 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="report-summary">What went wrong?</Label>
              <Textarea
                id="report-summary"
                autoFocus
                rows={4}
                placeholder="The blinds show 0% but they're actually open."
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
                disabled={sending}
              />
            </div>

            <div className="space-y-2">
              <Label>How bad is it?</Label>
              <div className="grid grid-cols-3 gap-2">
                {SEVERITIES.map((option) => (
                  <button
                    key={option.value}
                    type="button"
                    disabled={sending}
                    onClick={() => setSeverity(option.value)}
                    className={`rounded-md border px-2 py-2 text-left transition-colors ${
                      severity === option.value
                        ? 'border-primary bg-primary/10'
                        : 'border-border hover:bg-muted/50'
                    }`}
                  >
                    <div className="text-sm font-medium">{option.label}</div>
                    <div className="text-xs text-muted-foreground">{option.hint}</div>
                  </button>
                ))}
              </div>
            </div>

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

                <div className="flex items-center gap-2 rounded-md border border-dashed p-2 text-sm text-muted-foreground">
                  <Check className="h-4 w-4 shrink-0" />
                  App version, connection state and the last 500 log lines
                </div>
              </div>

              <div className="grid grid-cols-2 gap-2">
                {canRecord() && (
                  <Button
                    type="button" variant="outline"
                    disabled={sending || atLimit}
                    onClick={() => void beginRecording()}
                  >
                    <Video className="mr-2 h-4 w-4" />
                    Record screen
                  </Button>
                )}
                <Button
                  type="button" variant="outline"
                  disabled={sending || atLimit}
                  onClick={() => pickerRef.current?.click()}
                  className={canRecord() ? undefined : 'col-span-2'}
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
              {canRecord() && (
                <p className="text-xs text-muted-foreground">
                  Recording shows us what happens next — this sheet steps aside
                  so you can reproduce it. Up to{' '}
                  {Math.round(MAX_RECORDING_MS / 1000)}s each, and you can record
                  more than once.
                </p>
              )}
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

            <div className="flex justify-end gap-2">
              <Button
                type="button" variant="ghost"
                disabled={sending}
                onClick={() => onOpenChange(false)}
              >
                <X className="mr-2 h-4 w-4" />
                Cancel
              </Button>
              <Button type="button" disabled={sending} onClick={() => void send()}>
                {sending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Sending…
                  </>
                ) : (
                  'Send report'
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
