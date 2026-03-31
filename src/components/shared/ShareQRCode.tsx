import { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Download, QrCode } from 'lucide-react';
import { toast } from 'sonner';

interface ShareQRCodeProps {
  shareUrl: string;
  entityName: string;
}

export function ShareQRCode({ shareUrl, entityName }: ShareQRCodeProps) {
  const [open, setOpen] = useState(false);

  const handleSaveImage = async () => {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const padding = 40;
    const qrSize = 200;
    const width = qrSize + padding * 2;
    const headerHeight = 60;
    const footerHeight = 80;
    const height = qrSize + headerHeight + footerHeight + padding * 2;

    canvas.width = width;
    canvas.height = height;

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Entity name at top
    ctx.fillStyle = '#1a1a1a';
    ctx.font = 'bold 18px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const maxWidth = width - padding * 2;
    const truncatedName = truncateText(ctx, entityName, maxWidth);
    ctx.fillText(truncatedName, width / 2, padding + 20);

    // QR Code - render SVG to canvas
    const qrSvg = document.querySelector('#share-qr-code-full svg') as SVGElement;
    if (qrSvg) {
      const svgData = new XMLSerializer().serializeToString(qrSvg);
      const svgBlob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const svgUrl = URL.createObjectURL(svgBlob);

      const img = new Image();
      img.onload = () => {
        const qrY = padding + headerHeight;
        ctx.drawImage(img, padding, qrY, qrSize, qrSize);
        URL.revokeObjectURL(svgUrl);

        // "Scan to access" text
        ctx.fillStyle = '#666666';
        ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Scan to access', width / 2, qrY + qrSize + 25);

        // Homecast branding at bottom
        ctx.fillStyle = '#999999';
        ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
        ctx.fillText('Powered by Homecast', width / 2, height - padding + 5);

        // Download
        downloadCanvas(canvas, entityName);
      };
      img.src = svgUrl;
    }
  };

  const truncateText = (ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string => {
    const metrics = ctx.measureText(text);
    if (metrics.width <= maxWidth) return text;

    let truncated = text;
    while (ctx.measureText(truncated + '...').width > maxWidth && truncated.length > 0) {
      truncated = truncated.slice(0, -1);
    }
    return truncated + '...';
  };

  const downloadCanvas = (canvas: HTMLCanvasElement, name: string) => {
    const link = document.createElement('a');
    const safeName = name.replace(/[^a-z0-9]/gi, '-').toLowerCase();
    link.download = `${safeName}-qr.png`;
    link.href = canvas.toDataURL('image/png');
    link.click();
    toast.success('QR code saved');
  };

  return (
    <>
      <Button
        variant="outline"
        size="icon"
        onClick={() => setOpen(true)}
        title="QR Code"
      >
        <QrCode className="h-4 w-4" />
      </Button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-[320px]">
          <DialogHeader>
            <DialogTitle className="text-center">{entityName}</DialogTitle>
          </DialogHeader>
          <div className="flex flex-col items-center gap-4 py-4">
            <div
              id="share-qr-code-full"
              className="p-4 rounded-lg bg-white"
            >
              <QRCodeSVG
                value={shareUrl}
                size={200}
                level="M"
                includeMargin={false}
              />
            </div>
            <p className="text-sm text-muted-foreground">Scan to access</p>
            <Button
              variant="outline"
              size="sm"
              onClick={handleSaveImage}
              className="w-full"
            >
              <Download className="h-4 w-4 mr-2" />
              Save as Image
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
