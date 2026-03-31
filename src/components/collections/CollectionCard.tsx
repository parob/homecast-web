import { useState } from 'react';
import { useMutation } from '@apollo/client/react';
import { DELETE_COLLECTION } from '@/lib/graphql/mutations';
import type { Collection } from '@/lib/graphql/types';
import { parseCollectionPayload } from '@/lib/graphql/types';
import { ShareDialog } from '@/components/shared/ShareDialog';
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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
import { MoreVertical, Share2, Trash2, Lightbulb } from 'lucide-react';
import { toast } from 'sonner';

interface DeleteCollectionResponse {
  deleteCollection: boolean;
}

interface CollectionCardProps {
  collection: Collection;
  onClick: () => void;
  onUpdate: () => void;
}

export function CollectionCard({ collection, onClick, onUpdate }: CollectionCardProps) {
  const [shareDialogOpen, setShareDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);

  const [deleteCollection] = useMutation<DeleteCollectionResponse>(DELETE_COLLECTION);

  const parsedPayload = parseCollectionPayload(collection.payload);
  const accessoryCount = parsedPayload.items.length;

  const handleDelete = async () => {
    try {
      const result = await deleteCollection({
        variables: { collectionId: collection.id },
      });
      if (result.data?.deleteCollection) {
        toast.success('Collection deleted');
        onUpdate();
      } else {
        toast.error('Failed to delete collection');
      }
    } catch {
      toast.error('Failed to delete collection');
    }
    setDeleteDialogOpen(false);
  };

  return (
    <>
      <Card
        className="cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={onClick}
      >
        <CardHeader className="pb-2">
          <div className="flex items-start justify-between">
            <div className="space-y-1 flex-1 min-w-0">
              <CardTitle className="text-base truncate">{collection.name}</CardTitle>
              <CardDescription className="flex items-center gap-2 text-xs">
                {accessoryCount === 0 ? (
                  'Empty collection'
                ) : (
                  <span className="flex items-center gap-1">
                    <Lightbulb className="h-3 w-3" />
                    {accessoryCount} {accessoryCount === 1 ? 'accessory' : 'accessories'}
                  </span>
                )}
              </CardDescription>
            </div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild onClick={(e) => e.stopPropagation()}>
                <Button variant="ghost" size="icon" className="h-8 w-8 shrink-0">
                  <MoreVertical className="h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={(e) => { e.stopPropagation(); setShareDialogOpen(true); }}>
                  <Share2 className="h-4 w-4 mr-2" />
                  Share
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  className="text-destructive focus:text-destructive"
                  onClick={(e) => { e.stopPropagation(); setDeleteDialogOpen(true); }}
                >
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </CardHeader>
      </Card>

      <ShareDialog
        entityType="collection"
        entityId={collection.id}
        entityName={collection.name}
        open={shareDialogOpen}
        onOpenChange={setShareDialogOpen}
        onUpdated={onUpdate}
      />

      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent onClick={(e) => e.stopPropagation()}>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete collection?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete this collection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
