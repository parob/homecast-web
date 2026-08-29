/** The hero's words and calls to action, and the Android relay explainer the Play badge opens first. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Home } from 'lucide-react';
import { useAuth } from '@/contexts/AuthContext';
import { HERO, APP_STORE_URL, PLAY_STORE_URL } from './features';

export function AndroidModal({ onClose }: { onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-background rounded-2xl border border-border shadow-2xl max-w-md w-full p-6 animate-in fade-in zoom-in-95 duration-200">
        <div className="flex items-center gap-3 mb-4">
          <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-green-500/10">
            <svg className="h-6 w-6 text-green-500" viewBox="0 0 24 24" fill="currentColor">
              <path d="M6 18c0 .55.45 1 1 1h1v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h2v3.5c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5V19h1c.55 0 1-.45 1-1V8H6v10zM3.5 8C2.67 8 2 8.67 2 9.5v7c0 .83.67 1.5 1.5 1.5S5 17.33 5 16.5v-7C5 8.67 4.33 8 3.5 8zm17 0c-.83 0-1.5.67-1.5 1.5v7c0 .83.67 1.5 1.5 1.5s1.5-.67 1.5-1.5v-7c0-.83-.67-1.5-1.5-1.5zm-4.97-5.84l1.3-1.3c.2-.2.2-.51 0-.71-.2-.2-.51-.2-.71 0l-1.48 1.48A5.84 5.84 0 0012 1c-.96 0-1.86.23-2.66.63L7.85.15c-.2-.2-.51-.2-.71 0-.2.2-.2.51 0 .71l1.31 1.31A5.983 5.983 0 006 7h12c0-1.99-.97-3.75-2.47-4.84zM10 5H9V4h1v1zm5 0h-1V4h1v1z"/>
            </svg>
          </div>
          <h3 className="text-xl font-bold">Homecast for Android</h3>
        </div>
        <p className="text-sm text-muted-foreground mb-3">
          The Android app is a remote control for your Apple Home — it doesn't talk to HomeKit on its own. To reach your accessories it needs <strong className="text-foreground">one of</strong>:
        </p>
        <ul className="text-sm text-muted-foreground mb-6 space-y-1.5 list-disc pl-5">
          <li>The <strong className="text-foreground">Homecast Mac app</strong> running on a Mac at home, acting as your relay, or</li>
          <li>A paid <strong className="text-foreground">Cloud plan</strong>, which provides an always-on relay so you don't need a Mac.</li>
        </ul>
        <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" onClick={onClose} className="block transition-transform hover:scale-[1.03]">
          <img src="/download_google_play.svg" alt="Get it on Google Play" className="h-14 w-auto mx-auto" />
        </a>
      </div>
    </div>
  );
}

/** Sign Up + the two store badges. */
export function HeroCtas({ className = '' }: { className?: string }) {
  const { isAuthenticated } = useAuth();
  const [showAndroid, setShowAndroid] = useState(false);
  return (
    <>
      {showAndroid && <AndroidModal onClose={() => setShowAndroid(false)} />}
      <div className={`flex flex-wrap items-center gap-3 ${className}`}>
        {!isAuthenticated && (
          <Link to="/signup" className="inline-flex items-center gap-2 h-10 px-5 text-sm font-medium rounded-lg bg-black text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200 transition-colors">
            <Home className="h-4 w-4" />
            Sign Up
          </Link>
        )}
        <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer" className="inline-block">
          <img src="/download_app_store.svg" alt="Download on the App Store" className="h-10 w-auto max-w-[44vw] sm:max-w-none" />
        </a>
        <button type="button" onClick={() => setShowAndroid(true)} className="inline-block">
          <img src="/download_google_play.svg" alt="Get it on Google Play" className="h-10 w-auto max-w-[44vw] sm:max-w-none" />
        </button>
      </div>
    </>
  );
}

/** Headline, one line, and the CTAs — centred. */
export function HeroText() {
  return (
    <div className="text-center">
      <h1 className="mb-4 font-bold tracking-tight text-4xl sm:text-5xl lg:text-6xl" style={{ fontFamily: "'Outfit', sans-serif" }}>
        {HERO.title}
      </h1>
      <p className="mx-auto mb-8 max-w-lg text-lg text-muted-foreground">{HERO.subtitle}</p>
      <HeroCtas className="justify-center" />
    </div>
  );
}
