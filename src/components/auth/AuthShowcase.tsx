/**
 * The right-hand panel on the website's account pages: the same live phone
 * dashboard the landing page opens with, on its beach wallpaper. Loaded
 * lazily and only at desktop widths, so the form never waits for it.
 */
import { MobileDashboardDemo, useHomeState } from '@/components/marketing/landing/demos';

export default function AuthShowcase() {
  const home = useHomeState();
  return (
    <div className="absolute inset-0">
      <img src="/images/features/beach-blur.jpg" alt="" className="absolute inset-0 h-full w-full object-cover" />
      <div className="absolute inset-0 bg-gradient-to-b from-black/0 via-black/0 to-black/45" />
      <div className="relative flex h-full flex-col items-center justify-center gap-8 px-10 py-10">
        <div className="w-full max-w-[300px] drop-shadow-2xl">
          <MobileDashboardDemo home={home} />
        </div>
        <p className="max-w-sm text-center text-lg font-semibold text-white drop-shadow" style={{ fontFamily: "'Outfit', sans-serif" }}>
          Control and share your Apple Home from anywhere.
        </p>
      </div>
    </div>
  );
}
