import { useState, useCallback, useEffect } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { UPDATE_ROOM_GROUP } from '@/lib/graphql/mutations';
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

interface EditRoomGroupDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeId: string;
  groupId: string;
  groupName: string;
  roomIds: string[];
  onUpdated?: () => void;
  /** If provided, only show rooms with at least one allowed accessory (free plan filtering) */
  allowedRoomIds?: Set<string> | null;
}

export function EditRoomGroupDialog({
  open,
  onOpenChange,
  homeId,
  groupId,
  groupName,
  roomIds,
  onUpdated,
  allowedRoomIds,
}: EditRoomGroupDialogProps) {
  const [name, setName] = useState(groupName);
  const [selectedRoomIds, setSelectedRoomIds] = useState<Set<string>>(new Set(roomIds));
  const [isSaving, setIsSaving] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Reset form when dialog opens with new data
  useEffect(() => {
    if (open) {
      setName(groupName);
      // Normalize room IDs for comparison (lowercase, no dashes)
      setSelectedRoomIds(new Set(roomIds));
      setSearchQuery('');
    }
  }, [open, groupName, roomIds]);

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

  const [updateRoomGroup] = useMutation<{ updateRoomGroup: boolean | null }>(UPDATE_ROOM_GROUP);

  // Check if a room is selected (handles UUID normalization)
  const isRoomSelected = useCallback((roomId: string) => {
    const normalizedRoomId = roomId.toLowerCase().replace(/-/g, '');
    for (const id of selectedRoomIds) {
      if (id.toLowerCase().replace(/-/g, '') === normalizedRoomId) {
        return true;
      }
    }
    return false;
  }, [selectedRoomIds]);

  const handleRoomToggle = useCallback((roomId: string) => {
    setSelectedRoomIds((prev) => {
      const next = new Set(prev);
      const normalizedRoomId = roomId.toLowerCase().replace(/-/g, '');

      // Find if this room is already selected (by normalized ID)
      let foundId: string | null = null;
      for (const id of next) {
        if (id.toLowerCase().replace(/-/g, '') === normalizedRoomId) {
          foundId = id;
          break;
        }
      }

      if (foundId) {
        next.delete(foundId);
      } else {
        next.add(roomId);
      }
      return next;
    });
  }, []);

  const handleSave = useCallback(async () => {
    if (!name.trim()) {
      toast.error('Please enter a name for the room group');
      return;
    }
    if (selectedRoomIds.size === 0) {
      toast.error('Please select at least one room');
      return;
    }

    setIsSaving(true);
    try {
      const result = await updateRoomGroup({
        variables: {
          groupId,
          name: name.trim(),
          roomIds: Array.from(selectedRoomIds),
        },
      });

      if (result.data?.updateRoomGroup) {
        toast.success('Room group updated');
        onOpenChange(false);
        if (onUpdated) {
          onUpdated();
        }
      } else {
        toast.error('Failed to update room group');
      }
    } catch (err) {
      console.error('Failed to update room group:', err);
      toast.error('Failed to update room group');
    } finally {
      setIsSaving(false);
    }
  }, [name, groupId, selectedRoomIds, updateRoomGroup, onOpenChange, onUpdated]);

  const handleClose = useCallback(() => {
    if (!isSaving) {
      onOpenChange(false);
    }
  }, [isSaving, onOpenChange]);

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Edit Room Group</DialogTitle>
          <DialogDescription>
            Change the name or rooms in this group.
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
              disabled={isSaving}
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
                disabled={isSaving}
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
                          checked={isRoomSelected(room.id)}
                          onCheckedChange={() => handleRoomToggle(room.id)}
                          disabled={isSaving}
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
            <Button variant="outline" onClick={handleClose} disabled={isSaving}>
              Cancel
            </Button>
            <Button
              onClick={handleSave}
              disabled={isSaving || !name.trim() || selectedRoomIds.size === 0}
            >
              {isSaving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
