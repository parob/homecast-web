import { describe, expect, it } from 'vitest';
import { inferSceneRoom, sceneRoom, mergeVisibleOrder } from '../scene-rooms';
import type { HomeKitScene } from '@/lib/graphql/types';

const rooms = [{ id: 'ROOM-A', name: 'Living Room' }, { id: 'ROOM-B', name: 'Terrace' }];
const accessories = [{ id: 'LIGHT-A', roomId: 'room-a' }, { id: 'BLIND-A', roomId: 'ROOM-A' }, { id: 'LIGHT-B', roomId: 'ROOM-B' }];
const makeScene = (...ids: string[]): HomeKitScene => ({
  id: 'SCENE-A', name: 'Movie time', actionCount: ids.length,
  actions: JSON.stringify(ids.map(accessoryId => ({ accessoryId }))),
});

describe('scene room placement', () => {
  it('assigns a single-room scene using case-insensitive accessory and room IDs', () => {
    expect(inferSceneRoom(makeScene('light-a', 'BLIND-A'), accessories, rooms)).toBe('ROOM-A');
  });
  it('keeps multi-room, roomless, unresolved and incomplete scenes at home', () => {
    for (const scene of [makeScene('LIGHT-A', 'LIGHT-B'), makeScene('missing'), makeScene(),
      { ...makeScene('LIGHT-A'), actionCount: 2 }, { ...makeScene('LIGHT-A'), actions: 'invalid' }]) {
      expect(inferSceneRoom(scene, accessories, rooms)).toBeNull();
    }
    expect(inferSceneRoom(makeScene('helper'), [{ id: 'helper' }], rooms)).toBeNull();
  });
  it('accepts community arrays and older accessories with room names', () => {
    const scene = makeScene('LIGHT-A');
    scene.actions = JSON.parse(scene.actions as string);
    expect(inferSceneRoom(scene, [{ id: 'LIGHT-A', roomName: 'Living Room' }], rooms)).toBe('ROOM-A');
  });
  it('respects explicit home/room placement and falls back safely after room deletion', () => {
    expect(sceneRoom(makeScene('LIGHT-A'), accessories, rooms, { 'scene-a': null })).toBeNull();
    expect(sceneRoom(makeScene('LIGHT-A'), accessories, rooms, { 'scene-a': 'room-b' })).toBe('ROOM-B');
    expect(sceneRoom(makeScene('LIGHT-A'), accessories, rooms, { 'scene-a': 'deleted' })).toBeNull();
  });
});

it('keeps hidden and offline card positions when visible cards are rearranged', () => {
  expect(mergeVisibleOrder(['a', 'hidden', 'b', 'offline'], ['b', 'a', 'new'])).toEqual(['b', 'hidden', 'a', 'offline', 'new']);
});
