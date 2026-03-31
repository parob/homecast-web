import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Eye, EyeOff, Copy, Check, RefreshCw, AlertTriangle } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface WebhookSecretDisplayProps {
  /** Full signing secret */
  secret: string;
  /** Masked secret prefix (e.g., "whsec_abc1...") */
  secretPrefix: string;
  /** Whether to show the rotate button */
  showRotate?: boolean;
  /** Callback when rotate is requested */
  onRotate?: () => Promise<void>;
  /** Whether rotation is in progress */
  isRotating?: boolean;
}

export function WebhookSecretDisplay({
  secret,
  secretPrefix,
  showRotate = false,
  onRotate,
  isRotating = false,
}: WebhookSecretDisplayProps) {
  const [showSecret, setShowSecret] = useState(false);
  const [copied, setCopied] = useState(false);
  const [rotateDialogOpen, setRotateDialogOpen] = useState(false);

  const displayValue = showSecret ? secret : secretPrefix;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleRotate = async () => {
    setRotateDialogOpen(false);
    if (onRotate) {
      await onRotate();
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <code className="flex-1 rounded-md bg-muted px-3 py-2 text-xs font-mono truncate select-all selectable">
          {displayValue}
        </code>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={() => setShowSecret(!showSecret)}
        >
          {showSecret ? (
            <EyeOff className="h-4 w-4" />
          ) : (
            <Eye className="h-4 w-4" />
          )}
        </Button>

        <Button
          variant="ghost"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleCopy}
        >
          {copied ? (
            <Check className="h-4 w-4 text-green-500" />
          ) : (
            <Copy className="h-4 w-4" />
          )}
        </Button>

        {showRotate && onRotate && (
          <>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setRotateDialogOpen(true)}
              disabled={isRotating}
            >
              <RefreshCw className={`h-4 w-4 ${isRotating ? 'animate-spin' : ''}`} />
            </Button>

            <AlertDialog open={rotateDialogOpen} onOpenChange={setRotateDialogOpen}>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle className="flex items-center gap-2">
                    <AlertTriangle className="h-5 w-5 text-amber-500" />
                    Rotate webhook secret?
                  </AlertDialogTitle>
                  <AlertDialogDescription asChild>
                    <div className="space-y-2">
                      <p>Rotating the secret will:</p>
                      <ul className="list-disc list-inside text-sm space-y-1">
                        <li>Generate a new signing secret</li>
                        <li>Invalidate the current secret immediately</li>
                        <li>Require you to update your endpoint</li>
                      </ul>
                    </div>
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>Cancel</AlertDialogCancel>
                  <AlertDialogAction onClick={handleRotate}>
                    Rotate Secret
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        Used to verify webhook authenticity via HMAC signature.
      </p>
    </div>
  );
}
