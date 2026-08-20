import { useState } from 'react';
import { useQuery, useMutation } from '@apollo/client/react';
import { toast } from 'sonner';
import { GET_SCENES } from '@/lib/graphql/queries';
import { EXECUTE_SCENE } from '@/lib/graphql/mutations';
import { SceneCard } from '@/components/scenes/SceneCard';
import { ActionCard } from '@/components/actions/ActionCard';
import { useHomeActionRunner } from '@/components/actions/useHomeActionRunner';
import type { HomeAction } from '@/components/actions/catalog';
import type { RunHomeActionOverrides } from '@/components/actions/useRunHomeAction';
import type { HomeKitScene } from '@/lib/graphql/types';
import { useBackgroundContext } from '@/contexts/BackgroundContext';

/**
 * A pinned scene or shortcut, opened from the tab bar as a card.
 *
 * Both used to fire the moment you touched the chip, which made the two most
 * consequential things you can pin — "Everything off", "Lock up" — the two
 * easiest to set off by accident, from a row of small targets along the bottom
 * edge of a phone. They open like an accessory now, and the card is what runs
 * them: the same card the home screen shows, so it behaves the same way and
 * carries the same confirmation.
 *
 * Components rather than a branch inside `renderPinnedControl`, because each
 * needs hooks of its own — a scene has to fetch itself, and a shortcut needs a
 * runner to track its progress.
 */

export function PinnedActionCard({ action, homeId, isViewOnly, onRunAction }: {
  action: HomeAction;
  homeId: string;
  isViewOnly?: boolean;
  onRunAction: (action: HomeAction, opts?: RunHomeActionOverrides) => Promise<void>;
}) {
  const { isDarkBackground } = useBackgroundContext();
  const runner = useHomeActionRunner(onRunAction);
  return (
    <ActionCard
      action={action}
      homeId={homeId}
      isDarkBackground={isDarkBackground}
      isViewOnly={isViewOnly}
      // The panel is not the layout, so it never wiggles; and it is reached by
      // touch, which is what decides whether a two-way action offers both
      // directions up front or on a long press.
      editMode={false}
      touchMode
      running={runner.runningId === action.id}
      progress={runner.runningId === action.id ? runner.progress : null}
      runningTextOf={runner.runningTextOf}
      onPress={runner.press}
      onRun={runner.run}
    />
  );
}

export function PinnedSceneCard({ sceneId, homeId, name }: {
  sceneId: string;
  homeId: string;
  /** The pin's cached name, so the card can draw before the query lands. */
  name: string;
}) {
  const { isDarkBackground } = useBackgroundContext();
  const [running, setRunning] = useState(false);
  const [executeScene] = useMutation(EXECUTE_SCENE);
  const { data } = useQuery<{ scenes: HomeKitScene[] }>(GET_SCENES, {
    variables: { homeId },
    skip: !homeId,
    fetchPolicy: 'cache-first',
    errorPolicy: 'ignore',
  });

  // The pin stores only an id and a name, and the card wants the action count
  // as well. Until the home's scenes arrive — usually already cached, since the
  // home screen asks for the same list — stand in with what the pin knows.
  const scene: HomeKitScene =
    data?.scenes?.find(s => s.id === sceneId) ?? { id: sceneId, name, actionCount: 0 };

  const run = async () => {
    setRunning(true);
    try {
      await executeScene({ variables: { sceneId, homeId } });
      toast.success(`Ran "${scene.name}"`);
    } catch (e: unknown) {
      toast.error('Scene failed', { description: String((e as Error)?.message ?? e) });
    } finally {
      setRunning(false);
    }
  };

  return (
    <SceneCard
      scene={scene}
      homeId={homeId}
      isDarkBackground={isDarkBackground}
      editMode={false}
      running={running}
      onRun={run}
      // Editing a scene belongs to the home screen, where there is room for the
      // dialog. From the bar, the card runs it and nothing else.
      onEdit={run}
    />
  );
}
