// Node info popover — shows rich markdown help fetched from docs.homecast.cloud

import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Info, ExternalLink, Loader2 } from 'lucide-react';
import { useNodeHelp } from '../help/useNodeHelp';
import { ALL_NODE_DEFINITIONS } from '../constants';

const DOCS_GUIDE_BASE = 'https://docs.homecast.cloud/guides/automations';

/** Lightweight markdown → HTML for trusted content */
function renderMarkdown(md: string): string {
  return md
    // Remove the H1 title (we show it separately)
    .replace(/^# .+\n/, '')
    // Code blocks (``` ... ```)
    .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre class="bg-muted p-2 rounded text-[10px] overflow-x-auto my-2"><code>$2</code></pre>')
    // Tables
    .replace(/\n\|(.+)\|\n\|[-| :]+\|\n((\|.+\|\n)+)/g, (_match, header, body) => {
      const headers = header.split('|').map((h: string) => h.trim()).filter(Boolean);
      const rows = body.trim().split('\n').map((row: string) =>
        row.split('|').map((c: string) => c.trim()).filter(Boolean),
      );
      return `<table class="text-[10px] my-2 w-full"><thead><tr>${headers.map((h: string) => `<th class="text-left px-1.5 py-1 border-b font-medium">${h}</th>`).join('')}</tr></thead><tbody>${rows.map((r: string[]) => `<tr>${r.map((c: string) => `<td class="px-1.5 py-1 border-b">${inlineMarkdown(c)}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
    })
    // H2
    .replace(/^## (.+)$/gm, '<h3 class="text-xs font-semibold mt-3 mb-1">$1</h3>')
    // H3
    .replace(/^### (.+)$/gm, '<h4 class="text-[11px] font-medium mt-2 mb-1">$1</h4>')
    // Unordered lists
    .replace(/^- (.+)$/gm, '<li class="ml-3 text-[11px] list-disc">$1</li>')
    // Wrap consecutive <li> in <ul>
    .replace(/((?:<li[^>]*>.*<\/li>\n?)+)/g, '<ul class="my-1">$1</ul>')
    // Bold
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    // Inline code
    .replace(/`([^`]+)`/g, '<code class="bg-muted px-1 py-0.5 rounded text-[10px]">$1</code>')
    // Links
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline" target="_blank">$1</a>')
    // Category badge
    .replace(/^\*\*Category:\*\* (\w+)$/gm, '<span class="inline-block text-[9px] font-medium uppercase tracking-wider px-1.5 py-0.5 rounded bg-muted mb-2">$1</span>')
    // Paragraphs (lines that aren't tags)
    .replace(/^(?!<[a-z]|$)(.+)$/gm, '<p class="text-[11px] leading-relaxed my-1">$1</p>')
    // Clean up empty paragraphs
    .replace(/<p[^>]*>\s*<\/p>/g, '');
}

function inlineMarkdown(text: string): string {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code class="bg-muted px-0.5 rounded text-[9px]">$1</code>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="text-primary underline">$1</a>');
}

interface NodeInfoPopoverProps {
  nodeType: string;
}

export function NodeInfoPopover({ nodeType }: NodeInfoPopoverProps) {
  const { content, loading } = useNodeHelp(nodeType);
  const def = ALL_NODE_DEFINITIONS.find((d) => d.type === nodeType);
  const filename = nodeType.replace(/_/g, '-');

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="h-5 w-5 shrink-0 text-muted-foreground/50 hover:text-muted-foreground"
          onClick={(e) => e.stopPropagation()}
        >
          <Info className="h-3 w-3" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-80 sm:w-96 max-h-96 overflow-y-auto p-0"
        side="right"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-3 py-2 border-b sticky top-0 bg-popover z-10">
          <div className="font-medium text-sm">{def?.label ?? nodeType}</div>
          {def?.description && (
            <div className="text-[10px] text-muted-foreground mt-0.5">{def.description}</div>
          )}
        </div>

        {/* Content */}
        <div className="px-3 py-2">
          {loading && (
            <div className="flex items-center gap-2 py-4 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              <span className="text-xs">Loading documentation...</span>
            </div>
          )}

          {!loading && content && (
            <div dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }} />
          )}

          {!loading && !content && (
            <p className="text-xs text-muted-foreground py-2">
              {def?.description ?? 'No documentation available.'}
            </p>
          )}
        </div>

        {/* Footer — link to full docs */}
        <div className="px-3 py-2 border-t bg-muted/30">
          <a
            href={`${DOCS_GUIDE_BASE}/${filename}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] text-primary hover:underline flex items-center gap-1"
          >
            View full documentation
            <ExternalLink className="h-2.5 w-2.5" />
          </a>
        </div>
      </PopoverContent>
    </Popover>
  );
}
