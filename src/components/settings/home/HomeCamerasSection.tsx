import { useMutation, useQuery } from '@apollo/client/react';
import { Switch } from '@/components/ui/switch';
import { GET_HOME_CAMERAS_ENABLED } from '@/lib/graphql/queries';
import { SET_HOME_CAMERAS_ENABLED } from '@/lib/graphql/mutations';
import type { HomeKitHome } from '@/lib/graphql/types';
import { setCameraHomeEnabled } from '@/lib/camera-snapshot-cache';

interface HomeCamerasEnabledResponse { homeCamerasEnabled: boolean | null }

interface Props {
  home: HomeKitHome;
  isAdmin: boolean;
  /**
   * `isCloudManagedHome` — cameras are captured by a relay Homecast operates
   * and by no other Mac, and the cloud refuses the toggle for every other
   * home. Those homes still get the page, so the feature is discoverable, but
   * the switch is off and says why.
   */
  cloudManaged: boolean;
}

/** The owner's per-home switch for camera stills and live view. */
export function HomeCamerasSection({ home, isAdmin, cloudManaged }: Props) {
  const { data, refetch } = useQuery<HomeCamerasEnabledResponse>(GET_HOME_CAMERAS_ENABLED, {
    variables: { homeId: home.id },
    fetchPolicy: 'network-only',
    errorPolicy: 'ignore',
    skip: !cloudManaged,
  });
  const [setEnabledMut, { loading: saving }] = useMutation(SET_HOME_CAMERAS_ENABLED);
  const enabled = cloudManaged && data?.homeCamerasEnabled === true;
  const setEnabled = async (next: boolean) => {
    await setEnabledMut({ variables: { homeId: home.id, enabled: next } });
    setCameraHomeEnabled(home.id, next);
    await refetch();
  };

  return (
    <div className="space-y-2">
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Cameras</p>
      <div className="flex items-center justify-between gap-3 py-1">
        <div className="min-w-0">
          <p className="text-sm font-medium">Show cameras</p>
          <p className="text-xs text-muted-foreground">
            {cloudManaged
              ? 'Stills and live view from your HomeKit cameras'
              : 'Cameras are available with Cloud Managed.'}
          </p>
        </div>
        <Switch
          checked={enabled}
          onCheckedChange={(v) => void setEnabled(v)}
          disabled={!cloudManaged || !isAdmin || saving}
          aria-label="Cameras"
        />
      </div>
    </div>
  );
}
