import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';

const AD_CLIENT = 'ca-pub-3529699450676628';
const AD_SLOT = '2193345923';

interface AdBannerProps {
  onUpgrade: () => void;
}

export const AdBanner: React.FC<AdBannerProps> = ({ onUpgrade }) => {
  const [dismissed, setDismissed] = useState(false);
  const pushed = useRef(false);

  useEffect(() => {
    if (pushed.current) return;
    try {
      const adsbygoogle = (window as any).adsbygoogle;
      if (adsbygoogle) {
        adsbygoogle.push({});
        pushed.current = true;
      }
    } catch {
      // Ad blocker or script not loaded
    }
  }, []);

  if (dismissed) return null;
  if (typeof (window as any).adsbygoogle === 'undefined') return null;

  return (
    <div
      className="fixed bottom-0 left-0 right-0 bg-background/95 backdrop-blur-sm border-t shadow-[0_-2px_8px_rgba(0,0,0,0.08)]"
      style={{ zIndex: 9000 }}
    >
      <div className="relative max-w-3xl mx-auto px-4 py-2 md:py-3">
        <ins
          className="adsbygoogle"
          style={{ display: 'block', minHeight: 50 }}
          data-ad-client={AD_CLIENT}
          data-ad-slot={AD_SLOT}
          data-ad-format="horizontal"
          data-full-width-responsive="true"
        />
        <button
          onClick={() => setDismissed(true)}
          className="absolute top-1 right-1 p-1 rounded-full text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted/50 transition-colors"
          aria-label="Dismiss ad"
        >
          <X className="h-3.5 w-3.5" />
        </button>
        <button
          onClick={onUpgrade}
          className="block mx-auto text-[10px] text-muted-foreground/50 hover:text-primary transition-colors mt-0.5"
        >
          Upgrade to remove ads
        </button>
      </div>
    </div>
  );
};
