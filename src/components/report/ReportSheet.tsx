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
 *
 * A report can be added to an issue that is already open, chosen from the
 * Previous tab. The server has always done this by itself when two reports
 * fingerprint alike; this is the same destination, chosen deliberately, for
 * the far commoner case of the same fault described in different words.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle, CornerDownRight, ImagePlus, Loader2, Play, Trash2, Video, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';

import {
  MAX_ATTACHMENT_BYTES, MAX_RECORDING_MS, canRecord, prepareImageForUpload, startRecording,
  type ActiveRecording, type CapturedMedia,
} from '@/lib/report/capture';
import { submitReport } from '@/lib/report/submit';

import type { ReportedIssue } from '@/lib/report/issues';

import { AttachmentPreview } from './AttachmentPreview';
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

/**
 * `recording_1.mp4`, `recording_2.mp4`, … — numbered in the order they were
 * taken.
 *
 * Every recording used to arrive called `recording.mp4` and every screenshot
 * `screenshot.png`, so an issue with three of them gave the reader no way to
 * say which was which, and no way for the reporter to refer to one in the text.
 * The number is the cheapest thing that fixes both.
 */
function numberedName(existing: CapturedMedia[], base: string, extension: string): string {
  const taken = new Set(existing.map((item) => item.filename));
  for (let index = 1; ; index += 1) {
    const candidate = `${base}_${index}.${extension}`;
    if (!taken.has(candidate)) return candidate;
  }
}

/** Keep a renamed file usable as a filename, and keep its extension. */
/**
 * What a newly attached file should be called.
 *
 * Only things this app captured get renumbered. A photo picked from the library
 * already has a name its owner chose, and replacing it with `screenshot_2.jpg`
 * would be throwing information away.
 */
function autoName(existing: CapturedMedia[], item: CapturedMedia): string {
  const captured = /^(screenshot|recording)\.[a-z0-9]+$/i.test(item.filename);
  if (!captured) return item.filename;
  const [base, extension] = item.filename.split('.');
  return numberedName(existing, base.toLowerCase(), extension.toLowerCase());
}

const EXTENSION_FOR: Record<string, string> = {
  'image/png': '.png',
  'image/jpeg': '.jpg',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
};

/**
 * Keep a renamed file usable as a filename, and keep its extension.
 *
 * The extension comes from the blob's own type rather than from the name being
 * replaced — otherwise clearing the field to type a new one leaves nothing to
 * recover it from, and the file goes up called "".
 */
function sanitiseName(name: string, mimeType: string): string {
  const extension = EXTENSION_FOR[mimeType] ?? '';
  const cleaned = name.replace(/[/\\]/g, '-').trim() || `attachment${extension}`;
  return extension && !cleaned.toLowerCase().endsWith(extension)
    ? cleaned + extension
    : cleaned;
}

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
  const [preview, setPreview] = useState<CapturedMedia | null>(null);
  // The issue this report is being added to, if the reporter picked one in
  // Previous. Null is the ordinary case: file a new one.
  const [addingTo, setAddingTo] = useState<ReportedIssue | null>(null);
  // Controlled, so picking an issue can bring the compose tab back with it.
  const [tab, setTab] = useState('report');

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
    setPreview(null);
    setAddingTo(null);
    setTab('report');
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
      return [...current, { ...item, filename: autoName(current, item) }];
    });
  }, []);

  const renameMedia = useCallback((index: number, name: string) => {
    setMedia((current) =>
      current.map((item, at) => (at === index ? { ...item, filename: name } : item)),
    );
  }, []);

  const removeMedia = useCallback((index: number) => {
    setPreview(null);
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
    void (async () => {
      for (const file of Array.from(files)) {
        if (!file.type.startsWith('image/')) {
          toast.error(`${file.name} is not an image.`);
          continue;
        }
        // Same treatment as a screenshot: a photo straight off a phone camera
        // is far past what GitHub will inline.
        const blob = await prepareImageForUpload(file);
        addMedia({
          blob,
          mimeType: blob.type,
          filename: file.name || 'image',
          previewUrl: URL.createObjectURL(blob),
        });
      }
    })();
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
      const chosen = addingTo?.issueNumber;
      const result = await submitReport(
        {
          summary: text,
          severity: REPORT_SEVERITY,
          media: mediaRef.current,
          ...(chosen !== undefined ? { issueNumber: chosen } : {}),
        },
        token,
      );

      // What is announced is where the report actually went, never where it was
      // asked to go. A server that predates `issueNumber` ignores it and files
      // a new issue; saying "added to #71" then would be a lie the reporter has
      // no way to catch.
      const landedElsewhere = chosen !== undefined && result.issueNumber !== chosen;
      const skipped = result.attachmentsSkipped.length
        ? `Not included: ${result.attachmentsSkipped.join(', ')}`
        : undefined;

      toast.success(
        landedElsewhere
          ? `Sent as #${result.issueNumber}.`
          : chosen !== undefined
            ? `Added to #${result.issueNumber}. Thank you.`
            : result.deduplicated
              ? `Added to #${result.issueNumber} — this is already known.`
              : `Sent as #${result.issueNumber}. Thank you.`,
        {
          description: landedElsewhere
            ? [`It could not be added to #${chosen}.`, skipped].filter(Boolean).join(' ')
            : skipped,
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
  }, [summary, finishRecording, onOpenChange, addingTo]);

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

          <Tabs
            value={tab}
            onValueChange={setTab}
            className="flex min-h-0 min-w-0 flex-1 flex-col"
          >
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="report">New</TabsTrigger>
              {/* Often the answer someone actually wants: it is already known,
                  and possibly already fixed. */}
              <TabsTrigger value="known">Previous</TabsTrigger>
            </TabsList>

            <TabsContent
              value="known"
              className="-mx-2 mt-4 min-h-0 min-w-0 flex-1 overflow-y-auto px-2 py-1"
            >
              {/* Picking one carries you back to what you were writing — the
                  choice is about where the report goes, not a place to be
                  left standing. */}
              <ReportedIssues
                onAddTo={(issue) => {
                  setAddingTo(issue);
                  setTab('report');
                }}
              />
            </TabsContent>

            {/* `px-1 -mx-1`: the focus ring is drawn outside the element's box,
                and an overflow container clips whatever crosses its edge — so
                the textarea's ring lost its left and right sides the moment it
                was focused. The padding gives the ring room; the negative
                margin gives the padding back. */}
            <TabsContent
              value="report"
              className="-mx-2 mt-4 min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto px-2 py-1"
            >
            {/* Above the field, not below the Send button: it changes what
                pressing Send means, so it has to be read before anything is
                typed rather than discovered afterwards. */}
            {addingTo && (
              <div className="flex items-start gap-2 rounded-md border border-primary/40 bg-primary/5 p-2">
                <CornerDownRight className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium">
                    Adding to #{addingTo.issueNumber}
                  </div>
                  <div className="line-clamp-2 break-words text-xs text-muted-foreground">
                    {addingTo.title}
                  </div>
                  {addingTo.state === 'closed' && (
                    // Worth saying out loud rather than hiding fixed issues:
                    // a fault that has come back is the report we most want.
                    <div className="mt-1 text-xs text-muted-foreground">
                      This one is marked fixed — send it if the problem is back.
                    </div>
                  )}
                </div>
                <Button
                  type="button" variant="ghost" size="icon"
                  disabled={sending}
                  onClick={() => setAddingTo(null)}
                  aria-label="File a new report instead"
                  className="h-6 w-6 shrink-0"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            )}

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
                    {/* Openable. A 48px thumbnail says a file exists, not
                        whether it shows what you meant to show — and for a
                        recording that is the only question there is. */}
                    <button
                      type="button"
                      onClick={() => setPreview(item)}
                      aria-label={`Open ${item.filename}`}
                      className="relative h-12 w-12 shrink-0 overflow-hidden rounded"
                    >
                      {item.mimeType.startsWith('image/') ? (
                        <img
                          src={item.previewUrl}
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : item.mimeType.startsWith('video/') ? (
                        <>
                          <video
                            src={item.previewUrl}
                            preload="metadata"
                            muted
                            playsInline
                            className="h-full w-full bg-black object-cover"
                          />
                          <span className="absolute inset-0 flex items-center justify-center bg-black/30">
                            <Play className="h-4 w-4 fill-white text-white" />
                          </span>
                        </>
                      ) : (
                        <span className="flex h-full w-full items-center justify-center bg-muted">
                          <Video className="h-5 w-5 text-muted-foreground" />
                        </span>
                      )}
                    </button>
                    <div className="min-w-0 flex-1">
                      {/* Editable in place. Naming a recording "blinds-wrong"
                          is how a reporter points at one of three of them from
                          the text of the issue. Borderless until focused, so it
                          reads as the filename it is rather than a form field
                          demanding to be filled in. */}
                      <input
                        type="text"
                        value={item.filename}
                        aria-label={`Rename ${item.filename}`}
                        disabled={sending}
                        onChange={(event) => renameMedia(index, event.target.value)}
                        onBlur={(event) =>
                          renameMedia(index, sanitiseName(event.target.value, item.mimeType))
                        }
                        className="w-full truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-sm hover:border-border focus:border-input focus:outline-none focus:ring-1 focus:ring-ring"
                      />
                      <div className="px-1 text-xs text-muted-foreground">
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

      {preview && (
        <AttachmentPreview media={preview} onClose={() => setPreview(null)} />
      )}

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
