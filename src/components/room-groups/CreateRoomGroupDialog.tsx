import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { CREATE_ROOM_GROUP } from '@/lib/graphql/mutations';
import { GET_ROOMS } from '@/lib/graphql/queries';
import type { HomeKitRoom } from '@/lib/graphql/types';
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
import { Checkbox } from '@/components/ui/checkbox';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Loader2, Search, WifiOff, RotateCw } from 'lucide-react';
import { getRoomIcon } from '@/components/widgets';
import { toast } from 'sonner';

interface CreateRoomGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeId: string;
  homeName: string;
  onCreated?: (groupId: string) => void;
  /** If provided, only show rooms with at least one allowed accessory (free plan filtering) */
  allowedRoomIds?: Set<string> | null;
}

export function CreateRoomGroupDialog({
  open,
  onOpenChange,
  homeId,
  homeName,
  onCreated,
  allowedRoomIds,
}: CreateRoomGroupDialogProps) {
  const [name, setName] = useState('');
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Fetch rooms for this specific home
  const { data: roomsData, loading: roomsLoading, error: roomsError, refetch: refetchRooms } = useQuery<{ rooms: HomeKitRoom[] }>(
    GET_ROOMS,
    {
      variables: { homeId },
      skip: !open || !homeId,
      fetchPolicy: 'network-only',
    }
  );
  const allRooms = roomsData?.rooms || [];
  const allowedRooms = allowedRoomIds ? allRooms.filter(r => allowedRoomIds.has(r.id)) : allRooms;
  const rooms = searchQuery.trim()
    ? allowedRooms.filter(r => r.name.toLowerCase().includes(searchQuery.toLowerCase()))
    : allowedRooms;

  const [createRoomGroup] = useMutation<{ createRoomGroup: { entityId: string } | null }>(CREATE_ROOM_GROUP);

  const handleRoomToggle = useCallback((roomId: string) => {
    setSelectedRoomIds((prev) => {
      const next = new Set(prev);
      if (next.has(roomId)) {
        next.delete(roomId);
      } else {
        next.add(roomId);
      }
      return next;
    });
  }, []);

  const handleCreate = useCallback(async () => {
    if (!name.trim()) {
      toast.error('Please enter a name for the room group');
      return;
    }
    if (selectedRoomIds.size === 0) {
      toast.error('Please select at least one room');
      return;
    }

    setIsCreating(true);
    try {
      const result = await createRoomGroup({
        variables: {
          name: name.trim(),
          homeId,
          roomIds: Array.from(selectedRoomIds),
        },
      });

      if (result.data?.createRoomGroup) {
        toast.success('Room group created');
        onOpenChange(false);
        // Reset form
        setName('');
        setSelectedRoomIds(new Set());
        setSearchQuery('');
        // Notify parent
        if (onCreated) {
          onCreated(result.data.createRoomGroup.entityId);
        }
      } else {
        toast.error('Failed to create room group');
      }
    } catch (err) {
      console.error('Failed to create room group:', err);
      toast.error('Failed to create room group');
    } finally {
      setIsCreating(false);
    }
  }, [name, homeId, selectedRoomIds, createRoomGroup, onOpenChange, onCreated]);

  const handleClose = useCallback(() => {
    if (!isCreating) {
      onOpenChange(false);
      // Reset form
      setName('');
      setSelectedRoomIds(new Set());
      setSearchQuery('');
    }
  }, [isCreating, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Create Room Group</DialogTitle>
          <DialogDescription>
            Create a group of rooms from {homeName} that can be shared together.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Name input */}
          <div className="space-y-2">
            <Label htmlFor="group-name">Group Name</Label>
            <Input
              id="group-name"
              placeholder="e.g., Upstairs, Bedrooms, Entertainment Area"
              value={name}
              onChange={(e) => setName(e.target.value)}
              disabled={isCreating}
            />
          </div>

          {/* Room selection */}
          <div className="space-y-2">
            <Label>Select Rooms</Label>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search rooms..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-8"
                disabled={isCreating}
              />
            </div>
            <ScrollArea className="h-[200px] rounded-md border p-2">
              <div className="space-y-2">
                {roomsLoading ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : roomsError ? (
                  <div className="flex flex-col items-center justify-center py-6 gap-2">
                    <WifiOff className="h-6 w-6 text-muted-foreground" />
                    <p className="text-sm text-muted-foreground text-center">
                      Unable to load rooms
                    </p>
                    <Button variant="ghost" size="sm" onClick={() => refetchRooms()}>
                      <RotateCw className="h-3 w-3 mr-1.5" />
                      Retry
                    </Button>
                  </div>
                ) : rooms.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">
                    No rooms available
                  </p>
                ) : (
                  rooms.map((room) => {
                    const RoomIcon = getRoomIcon(room.name);
                    return (
                      <label
                        key={room.id}
                        className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted cursor-pointer"
                      >
                        <Checkbox
                          checked={selectedRoomIds.has(room.id)}
                          onCheckedChange={() => handleRoomToggle(room.id)}
                          disabled={isCreating}
                        />
                        <RoomIcon className="h-4 w-4 text-muted-foreground" />
                        <span className="flex-1">{room.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {room.accessoryCount} accessor{room.accessoryCount !== 1 ? 'ies' : 'y'}
                        </span>
                      </label>
                    );
                  })
                )}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              {selectedRoomIds.size} room{selectedRoomIds.size !== 1 ? 's' : ''} selected
            </p>
          </div>
        </div>

        <DialogFooter className="flex-col sm:flex-row gap-2">
          {!name.trim() && selectedRoomIds.size > 0 && (
            <p className="text-xs text-muted-foreground mr-auto">Enter a group name</p>
          )}
          {name.trim() && selectedRoomIds.size === 0 && (
            <p className="text-xs text-muted-foreground mr-auto">Select at least one room</p>
          )}
          <div className="flex gap-2">
            <Button variant="outline" onClick={handleClose} disabled={isCreating}>
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={isCreating || !name.trim() || selectedRoomIds.size === 0}
            >
              {isCreating && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Create Room Group
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
