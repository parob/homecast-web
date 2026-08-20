import { EyeOff, Loader2, Play, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  ContextMenu, ContextMenuContent, ContextMenuItem, ContextMenuLabel,
  ContextMenuSeparator, ContextMenuTrigger,
} from '@/components/ui/context-menu';
import { PinTabMenuItem } from '@/components/shared/PinTabMenuItem';
import { TileEditActions, HiddenLabel } from '@/components/shared/EditActions';
import { getIconColor } from '@/components/widgets/iconColors';
import { isBuiltInScene } from '@/lib/scenes';
import type { HomeKitScene } from '@/lib/graphql/types';

const sceneColors = getIconColor('scene');

function subtitleOf(scene: HomeKitScene): string {
  if (scene.automationName) return `Used by automation "${scene.automationName}"`;
  const count = `${scene.actionCount} action${scene.actionCount === 1 ? '' : 's'}`;
  return isBuiltInScene(scene) ? `Built-in · ${count}` : count;
}

/**
 * One scene card in the Scenes section.
 *
 * Sized to match ActionCard, which sits beside it in the same grid — the
 * reasoning for these measurements is written down there and applies here
 * unchanged: on the 180px compact grid a 32px chip left the name about 65px,
 * which wrapped to two lines and then clipped.
 *
 * The play button stays a real button, unlike the shortcut card's decorative
 * one. Pressing a scene card opens its editor, so running it needs a control of
 * its own — same look, different job.
 */
export function SceneCard({
  scene, homeId, isDarkBackground, editMode, touchMode, running, isHidden, onRun, onEdit, onToggleHidden,
}: {
  scene: HomeKitScene;
  homeId?: string | null;
  isDarkBackground?: boolean;
  editMode: boolean;
  /** Touch device: no context menu, because long press means lift. */
  touchMode?: boolean;
  running: boolean;
  /** Turned off for this home. Only rendered at all while editing. */
  isHidden?: boolean;
  onRun: (scene: HomeKitScene) => void;
  onEdit: (scene: HomeKitScene) => void;
  /** Absent where the layout cannot be written (a shared home, a view-only member). */
  onToggleHidden?: (scene: HomeKitScene, visible: boolean) => void;
}) {
  const card = (
    <div
      role="button"
      tabIndex={0}
      onClick={editMode ? undefined : () => onEdit(scene)}
      onKeyDown={(e) => {
        if (!editMode && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onEdit(scene); }
      }}
      className={cn(
        'relative rounded-2xl h-fit transition-all duration-300 ring-1 ring-inset',
        !editMode && 'cursor-pointer',
        isHidden && 'opacity-40',
        isDarkBackground ? 'ring-transparent' : 'ring-slate-200',
      )}
      style={{ contain: 'layout style paint' }}
    >
      {/* Blur layer — matches WidgetWrapper */}
      <div className={cn(
        'absolute inset-0 rounded-2xl backdrop-blur-xl shadow-sm transition-colors duration-300 transform-gpu',
        isDarkBackground ? 'bg-black/20' : 'bg-slate-100/80',
      )} />
      <div className="relative z-[1] flex items-center gap-2 p-2.5">
        <div className={cn('flex h-6 w-6 shrink-0 items-center justify-center rounded-full shadow-sm', sceneColors.bg, sceneColors.text)}>
          <Zap className="h-3 w-3" />
        </div>
        <div className="min-w-0 flex-1">
          <p
            title={scene.name}
            className={cn('text-[13px] font-medium leading-tight truncate transition-colors duration-300', isDarkBackground && 'text-white')}
          >
            {scene.name}
          </p>
          <p className={cn('text-[10px] truncate transition-colors duration-300', isDarkBackground ? 'text-white/60' : 'text-muted-foreground/60')}>
            {subtitleOf(scene)}
          </p>
        </div>
        {!editMode && (
          <button
            onClick={(e) => { e.stopPropagation(); onRun(scene); }}
            disabled={running}
            title="Run scene"
            className={cn(
              'shrink-0 rounded-lg p-1.5 transition-colors',
              isDarkBackground ? 'hover:bg-white/10 text-white/70' : 'hover:bg-muted text-muted-foreground',
            )}
          >
            {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
          </button>
        )}
      </div>
    </div>
  );

  const tab = { type: 'scene' as const, id: scene.id, name: scene.name, homeId: homeId ?? undefined };

  // The wrapper is unconditional, and only the badges are behind `editMode`.
  // It used to be a bare fragment outside edit mode, which meant flipping the
  // mode swapped one element tree for another and remounted the card — and the
  // mode now flips *during* a drag, on the press that started it. A remount
  // mid-drag takes the node dnd-kit is tracking out from under it.
  const editable = (
    <div className="relative">
      {card}
      {/* Outside the card, so dimming a hidden one does not also grey out
          the button that brings it back. */}
      {editMode && isHidden && <HiddenLabel />}
      {editMode && (
        <TileEditActions
          action={onToggleHidden
            ? { kind: 'hide', isHidden: !!isHidden, onToggle: () => onToggleHidden(scene, !!isHidden), name: scene.name }
            : null}
          tab={tab}
        />
      )}
    </div>
  );

  // Right-click only. On touch the long press that used to open this now lifts
  // the card into Edit Layout — see LayoutEditContext.
  if (editMode || touchMode) return editable;

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{editable}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuLabel className="text-xs font-normal text-muted-foreground">
          {scene.name}
        </ContextMenuLabel>
        <ContextMenuSeparator />
        <PinTabMenuItem tab={tab} />
        {/* Desktop has no edit mode, so hiding lives where every other desktop
            hide does. A hidden scene has no card to right-click, which is why
            Settings carries the list that brings one back. */}
        {onToggleHidden && (
          <ContextMenuItem onClick={() => onToggleHidden(scene, false)}>
            <EyeOff className="mr-2 h-4 w-4" />
            Hide Scene
          </ContextMenuItem>
        )}
      </ContextMenuContent>
    </ContextMenu>
  );
}
