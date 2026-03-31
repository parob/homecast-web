// Well-known OAuth clients with branding (shared between OAuthConsent and SharedItemsDialog)
// Icons are hosted locally to avoid cross-origin issues (e.g. claude.ai sets CORP: same-origin)
export const WELL_KNOWN_CLIENTS: Record<string, { name: string; logoUrl: string }> = {
  // Anthropic
  'claude.ai': {
    name: 'Claude',
    logoUrl: '/images/claude-icon.png',
  },
  // OpenAI
  'chatgpt.com': {
    name: 'ChatGPT',
    logoUrl: '/images/chatgpt-icon.webp',
  },
  'chat.openai.com': {
    name: 'ChatGPT',
    logoUrl: '/images/chatgpt-icon.webp',
  },
  // Google
  'gemini.google.com': {
    name: 'Gemini',
    logoUrl: '/images/gemini-icon.png',
  },
  // Cursor
  'cursor.com': {
    name: 'Cursor',
    logoUrl: '/images/cursor-icon.png',
  },
  'www.cursor.com': {
    name: 'Cursor',
    logoUrl: '/images/cursor-icon.png',
  },
  // Windsurf
  'windsurf.com': {
    name: 'Windsurf',
    logoUrl: '/images/windsurf-icon.ico',
  },
  'www.windsurf.com': {
    name: 'Windsurf',
    logoUrl: '/images/windsurf-icon.ico',
  },
};
