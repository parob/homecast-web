/**
 * Community mode: REST API endpoints.
 * Same interface as the cloud REST API.
 */

import { executeHomeKitAction } from '../relay/local-handler';

interface HTTPRequest {
  method: string;
  path: string;
  body?: string;
  authorization?: string;
}

export async function handleREST(req: HTTPRequest): Promise<unknown> {
  const { method, path } = req;
  // Parse query params from path
  const [cleanPath, queryString] = path.split('?');
  const params = new URLSearchParams(queryString || '');

  // Strip /rest prefix
  const route = cleanPath.replace(/^\/rest/, '');

  try {
    switch (true) {
      // GET /rest/homes
      case method === 'GET' && route === '/homes': {
        const result = await executeHomeKitAction('homes.list') as any;
        return result?.homes || [];
      }

      // GET /rest/accessories?home=X&room=X&type=X&name=X
      case method === 'GET' && route === '/accessories': {
        const payload: Record<string, unknown> = { includeValues: true, includeAll: true };
        if (params.get('home')) payload.homeId = params.get('home');
        if (params.get('room')) payload.roomId = params.get('room');
        const result = await executeHomeKitAction('accessories.list', payload) as any;
        let accessories = result?.accessories || [];
        // Filter by type/name if specified
        const typeFilter = params.get('type');
        const nameFilter = params.get('name');
        if (typeFilter) accessories = accessories.filter((a: any) => a.category?.toLowerCase() === typeFilter.toLowerCase());
        if (nameFilter) accessories = accessories.filter((a: any) => a.name?.toLowerCase().includes(nameFilter.toLowerCase()));
        return accessories;
      }

      // GET /rest/accessories/:id
      case method === 'GET' && route.startsWith('/accessories/'): {
        const accessoryId = route.replace('/accessories/', '');
        const result = await executeHomeKitAction('accessory.get', { accessoryId }) as any;
        return result?.accessory || null;
      }

      // POST /rest/state
      case method === 'POST' && route === '/state': {
        if (!req.body) return { error: 'Missing body' };
        const body = JSON.parse(req.body);
        // Accept both flat dict and { state: ... } format
        const state = body.state || body;
        const homeId = body.homeId || body.home_id;
        await executeHomeKitAction('state.set', { state, homeId });
        return { success: true };
      }

      // GET /rest/scenes?home=X
      case method === 'GET' && route === '/scenes': {
        const homeId = params.get('home');
        if (!homeId) return { error: 'home parameter required' };
        const result = await executeHomeKitAction('scenes.list', { homeId }) as any;
        return result?.scenes || [];
      }

      // POST /rest/scenes/:id/execute
      case method === 'POST' && route.match(/^\/scenes\/[^/]+\/execute$/): {
        const sceneId = route.split('/')[2];
        await executeHomeKitAction('scene.execute', { sceneId });
        return { success: true };
      }

      // GET /rest/rooms?home=X
      case method === 'GET' && route === '/rooms': {
        const homeId = params.get('home');
        if (!homeId) return { error: 'home parameter required' };
        const result = await executeHomeKitAction('rooms.list', { homeId }) as any;
        return result?.rooms || [];
      }

      default:
        return { error: 'Not found', path: route };
    }
  } catch (e: any) {
    return { error: e.message || 'Internal error' };
  }
}
