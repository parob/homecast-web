import { ChevronRight } from 'lucide-react';

/**
 * The partial-run toast's description, as a way into the failure sheet.
 *
 * It is a button rather than a second toast action for one measured reason. The
 * toast is 290px wide on a phone (the viewport less the safe-area offset sonner
 * takes on each side), and a `Details` chip beside `Retry` leaves the text about
 * 115px — which wraps "Hall Lamp and Porch Light didn't respond" onto three
 * lines. Handing the sentence itself the tap keeps one button on the right, the
 * text on two lines, and gives the detail route a target the width of the toast
 * instead of a chip.
 *
 * Sonner has no toast-level click, but `description` takes a node, so this is
 * the affordance rather than a workaround for the lack of one.
 */
export function FailureToastDescription({ text, onDetails }: {
  /** The same sentence the toast would otherwise have shown as plain text. */
  text: string;
  onDetails: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onDetails}
      // The description colour is inherited from sonner's own class, so this
      // reads as the description it replaces rather than as a link.
      className="flex w-full items-start gap-1 text-left underline-offset-2 hover:underline focus-visible:underline focus-visible:outline-none"
      aria-label={`${text}. See which, and try again.`}
    >
      <span className="min-w-0 flex-1">{text}</span>
      {/* mt-px to sit on the first line's baseline rather than the box's
          centre, which on a three-line description is a line and a half down. */}
      <ChevronRight aria-hidden className="mt-px h-3.5 w-3.5 shrink-0 opacity-70" />
    </button>
  );
}
