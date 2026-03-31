import { useQuery } from '@apollo/client/react';
import { GET_MY_SHARED_ENTITIES } from '@/lib/graphql/queries';
import type { GetMySharedEntitiesResponse, EntityType } from '@/lib/graphql/types';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import {
  Share2,
  Folder,
  DoorClosed,
  Layers,
  Home as HomeIcon,
  Lightbulb,
  Loader2,
  ExternalLink,
  Globe,
  Lock,
  Users,
} from 'lucide-react';

// Entity type to icon mapping
const ENTITY_TYPE_ICONS: Record<EntityType, typeof Folder> = {
  collection: Folder,
  collection_group: Layers,
  room: DoorClosed,
  room_group: Layers,
  accessory_group: Layers,
  home: HomeIcon,
  accessory: Lightbulb,
};

// Access type to icon mapping
const ACCESS_TYPE_ICONS: Record<string, typeof Globe> = {
  public: Globe,
  passcode: Lock,
  user: Users,
};

interface MySharedItemsPopoverProps {
  children?: React.ReactNode;
}

export function MySharedItemsPopover({ children }: MySharedItemsPopoverProps) {
  const { data, loading } = useQuery<GetMySharedEntitiesResponse>(
    GET_MY_SHARED_ENTITIES,
    {
      fetchPolicy: 'cache-and-network',
    }
  );

  const sharedEntities = data?.mySharedEntities || [];

  // Group by entity (an entity can have multiple access entries)
  const entitiesByKey = sharedEntities.reduce((acc, entity) => {
    const key = `${entity.entityType}-${entity.entityId}`;
    if (!acc[key]) {
      acc[key] = {
        entityType: entity.entityType,
        entityId: entity.entityId,
        entityName: entity.entityName || entity.entityId,
        shareUrl: entity.shareUrl,
        accessTypes: new Set<string>(),
      };
    }
    acc[key].accessTypes.add(entity.accessType);
    return acc;
  }, {} as Record<string, { entityType: EntityType; entityId: string; entityName: string; shareUrl?: string | null; accessTypes: Set<string> }>);

  const uniqueEntities = Object.values(entitiesByKey);

  return (
    <Popover>
      <PopoverTrigger asChild>
        {children || (
          <Button variant="ghost" size="icon" className="relative">
            <Share2 className="h-4 w-4" />
            {uniqueEntities.length > 0 && (
              <span className="absolute -top-0.5 -right-0.5 h-4 w-4 rounded-full bg-primary text-[10px] font-medium text-primary-foreground flex items-center justify-center">
                {uniqueEntities.length > 9 ? '9+' : uniqueEntities.length}
              </span>
            )}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent className="w-80" align="end">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">My Shared Items</h4>
            <span className="text-xs text-muted-foreground">
              {uniqueEntities.length} item{uniqueEntities.length !== 1 ? 's' : ''}
            </span>
          </div>

          {loading && uniqueEntities.length === 0 ? (
            <div className="flex items-center justify-center py-6">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : uniqueEntities.length === 0 ? (
            <div className="text-center py-6 text-sm text-muted-foreground">
              <Share2 className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p>No shared items yet</p>
              <p className="text-xs mt-1">
                Share a home, room, collection, or accessory to see it here
              </p>
            </div>
          ) : (
            <div className="space-y-1 max-h-[300px] overflow-y-auto">
              {uniqueEntities.map((entity) => {
                const EntityIcon = ENTITY_TYPE_ICONS[entity.entityType] || Folder;
                const accessTypesArray = Array.from(entity.accessTypes);

                return (
                  <a
                    key={`${entity.entityType}-${entity.entityId}`}
                    href={entity.shareUrl || '#'}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted transition-colors group"
                  >
                    <div className="h-8 w-8 rounded-md bg-primary/10 flex items-center justify-center shrink-0">
                      <EntityIcon className="h-4 w-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{entity.entityName}</p>
                      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                        <span className="capitalize">{entity.entityType}</span>
                        <span>·</span>
                        <div className="flex items-center gap-0.5">
                          {accessTypesArray.map((type) => {
                            const AccessIcon = ACCESS_TYPE_ICONS[type] || Globe;
                            return (
                              <AccessIcon
                                key={type}
                                className="h-3 w-3"
                                aria-label={`${type} access`}
                              />
                            );
                          })}
                        </div>
                      </div>
                    </div>
                    <ExternalLink className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                  </a>
                );
              })}
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
