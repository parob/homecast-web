import { useParams, useLocation } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, Copy, Check, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { config } from '@/lib/config';

const ShareControlRedirect = () => {
  const { hash, action } = useParams();
  const location = useLocation();
  const [copied, setCopied] = useState(false);

  // Build the correct API URL
  const apiUrl = `${config.apiUrl}${location.pathname}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(apiUrl);
    setCopied(true);
    toast.success('URL copied');
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="min-h-screen bg-background flex items-center justify-center p-4">
      <Card className="max-w-lg w-full">
        <CardHeader className="text-center">
          <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center">
            <AlertTriangle className="h-6 w-6 text-amber-600 dark:text-amber-400" />
          </div>
          <CardTitle>Control Endpoint</CardTitle>
          <CardDescription>
            This is a device control URL that should be called directly, not visited in a browser.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="text-sm text-muted-foreground">
            <p className="mb-3">
              Control endpoints like <code className="bg-muted px-1.5 py-0.5 rounded text-xs">/{action}</code> are
              meant to be called programmatically (via HTTP GET/POST) to control your devices.
            </p>
            <p>Use this URL in your scripts, shortcuts, or automation tools:</p>
          </div>

          <div className="flex gap-2">
            <code className="flex-1 text-xs bg-muted px-3 py-2 rounded-md overflow-x-auto whitespace-nowrap selectable">
              {apiUrl}
            </code>
            <Button variant="outline" size="icon" onClick={handleCopy}>
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>

          <div className="pt-2 flex flex-col gap-2">
            <Button variant="outline" className="w-full" asChild>
              <a href={apiUrl} target="_blank" rel="noopener noreferrer">
                <ExternalLink className="h-4 w-4 mr-2" />
                Try it (opens API URL)
              </a>
            </Button>
            <Button variant="ghost" className="w-full" asChild>
              <a href={`/s/${hash}`}>
                View shared item instead
              </a>
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default ShareControlRedirect;
