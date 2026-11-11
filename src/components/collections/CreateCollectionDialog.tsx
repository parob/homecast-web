import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { CREATE_COLLECTION } from '@/lib/graphql/mutations';
import type { Collection, CreateCollectionResponse } from '@/lib/graphql/types';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { toast } from 'sonner';

function isCoarsePointer(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(pointer: coarse)').matches;
}

interface CreateCollectionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: (collection: Collection) => void;
}

export function CreateCollectionDialog({
  open,
  onOpenChange,
  onCreated,
}: CreateCollectionDialogProps) {
  const [name, setName] = useState('');
  const [createCollection, { loading }] = useMutation<CreateCollectionResponse>(CREATE_COLLECTION);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!name.trim()) {
      toast.error('Please enter a name');
      return;
    }

    try {
      const result = await createCollection({
        variables: { name: name.trim() },
      });

      if (result.data?.createCollection) {
        toast.success('Collection created');
        setName('');
        onOpenChange(false);
        onCreated(result.data.createCollection);
      } else {
        toast.error('Failed to create collection');
      }
    } catch {
      toast.error('Failed to create collection');
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* On a phone the keyboard must not open with the dialog. Focusing the
          field during the open animation raises the keyboard while the dialog
          is still centred on the full-height viewport, and the iOS app scrolls
          the heading above the screen (homecast-web#299). A tap on the field
          opens it once the dialog has settled. A mouse still gets the field
          focused, since Radix focuses the first tabbable element. */}
      <DialogContent
        className="sm:max-w-[400px]"
        onOpenAutoFocus={(e) => { if (isCoarsePointer()) e.preventDefault(); }}
      >
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Create Collection</DialogTitle>
            <DialogDescription>
              Create a new collection to group and share your accessories.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Label htmlFor="name">Name</Label>
            <Input
              id="name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Collection"
              className="mt-2"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading || !name.trim()}>
              {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
