/** The small brand and device glyphs the How it Works diagram is drawn with. */

export const GraphQLLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="none">
    <path d="M50 5L87.5 27.5V72.5L50 95L12.5 72.5V27.5L50 5Z" stroke="#E535AB" strokeWidth="4" fill="none"/>
    <circle cx="50" cy="5" r="5" fill="#E535AB"/>
    <circle cx="87.5" cy="27.5" r="5" fill="#E535AB"/>
    <circle cx="87.5" cy="72.5" r="5" fill="#E535AB"/>
    <circle cx="50" cy="95" r="5" fill="#E535AB"/>
    <circle cx="12.5" cy="72.5" r="5" fill="#E535AB"/>
    <circle cx="12.5" cy="27.5" r="5" fill="#E535AB"/>
  </svg>
);

export const RestLogo = () => (
  <div className="flex h-6 w-6 items-center justify-center rounded bg-emerald-500 text-[8px] font-bold text-white">REST</div>
);

export const MCPLogo = () => (
  <svg className="h-6 w-6" viewBox="0 0 100 100" fill="none">
    <rect x="10" y="25" width="25" height="50" rx="4" fill="#6366F1"/>
    <rect x="40" y="15" width="20" height="70" rx="4" fill="#8B5CF6"/>
    <rect x="65" y="25" width="25" height="50" rx="4" fill="#A855F7"/>
    <path d="M35 50H40M60 50H65" stroke="#C4B5FD" strokeWidth="3" strokeLinecap="round"/>
  </svg>
);

export const AppleTVIcon = () => (
  <svg className="h-6 w-6 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="2" y="3" width="20" height="13" rx="2" />
    <path d="M8 20h8M12 16v4" />
  </svg>
);

export const HomePodIcon = () => (
  <svg className="h-6 w-6 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
    <path d="M12 2C8.5 2 6 5 6 9v6c0 4 2.5 7 6 7s6-3 6-7V9c0-4-2.5-7-6-7z" />
    <ellipse cx="12" cy="8" rx="2.5" ry="1.5" fill="currentColor" stroke="none" opacity="0.5" />
  </svg>
);

export const MacMiniIcon = () => (
  <svg className="h-6 w-6 text-foreground" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="8" width="18" height="8" rx="2" />
    <circle cx="17" cy="12" r="1" fill="currentColor" stroke="none" />
    <line x1="6" y1="12" x2="10" y2="12" />
  </svg>
);
