import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@apollo/client/react';
import { Search, Wifi, WifiOff, Home, User, ChevronDown, ChevronRight, Clock, Key } from 'lucide-react';
import { GET_ME, GET_CACHED_HOMES } from '@/lib/graphql/queries';
import {
  isMqttDomain, getApiBase, getAuthHeaders, getJWT, useIsLgUp,
  requestMqttToken, mqttSyncUrl, markSyncAttempted, syncAlreadyAttempted, clearSyncAttempt,
} from './mqtt-browser/util';
import { formatUptime, FmtVal } from './mqtt-browser/helpers';
import { ConnectDialog } from './mqtt-browser/ConnectDialog';
import { HomeInfoDialog } from './mqtt-browser/HomeInfoDialog';
import { TreePane } from './mqtt-browser/TreePane';
import { InspectorPanel } from './mqtt-browser/InspectorPanel';
import { Drawer, DrawerContent, DrawerTitle } from '@/components/ui/drawer';
import {
  buildSlugToTopicMap, buildMemberTopicSet, buildTopicTree, findGroupForTopic,
  getEffectivePayload as getEffectivePayloadPure, rowTypeForTopic,
} from './mqtt-browser/topic-tree';
import type { TopicMessage } from './mqtt-browser/topic-tree';

interface CookieUser { id: string; email: string; name: string; accountType?: string }
interface CookieHome { id: string; name: string; role?: string; mqttEnabled?: boolean; relayConnected?: boolean; ownerEmail?: string | null }

export default function MQTTBrowser() {
  // On mqtt.* the only auth signal is the cross-subdomain cookie. If it's
  // not there we can't read localStorage either (different origin), so we
  // hand off to homecast.cloud with ?mqtt_sync=1&return=… — that page's
  // AuthContext rewrites the cookie from localStorage (or sends the user
  // through /login) and bounces them back here with the cookie set.
  const [searchParams, setSearchParams] = useSearchParams();
  const mockMode = searchParams.get('mock') === '1';
  // In mock mode we never need cookie sync — we skip the broker entirely.
  // The handshake runs at most once per tab: arriving back here still without a
  // usable cookie means the main domain had no session to hand over either, and
  // bouncing again would just shuttle the user between two domains. Past that
  // point the page stays put and offers a Sign in button instead.
  const needsMqttSync = !mockMode && isMqttDomain() && !getJWT() && !syncAlreadyAttempted();
  const [connected, setConnected] = useState(mockMode);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Set when the server refuses our credential and refreshing it didn't help.
  // Retrying can't fix that, so the retry loop stands down and the error banner
  // grows a Sign in button — the page otherwise has no auth UI at all.
  const [authBlocked, setAuthBlocked] = useState(false);
  const [messages, setMessages] = useState<Record<string, TopicMessage>>({});
  const [filter, setFilter] = useState(() => searchParams.get('filter') || '');
  // The tree row whose inspector is showing. Selection never collapses or
  // expands tree sections — those are the open* sets below.
  const [selectedTopic, setSelectedTopic] = useState<string | null>(() => searchParams.get('topic'));
  const [rawMode, setRawMode] = useState(() => searchParams.get('view') === 'json');
  const [publishValues, setPublishValues] = useState<Record<string, string>>({});
  const [availability, setAvailability] = useState<Record<string, string>>({});  // baseTopic → "online"|"offline"
  const [groupMembers, setGroupMembers] = useState<Record<string, string[]>>({});  // groupTopic → [accessory slugs]
  const [publishHistory, setPublishHistory] = useState<Array<{ topic: string; payload: string; timestamp: number }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [connStats, setConnStats] = useState({ connectedAt: 0, totalMessages: 0, clientId: '' });
  const [msgRate, setMsgRate] = useState(0);
  const msgTimestamps = useRef<number[]>([]);
  const [connectDialogOpen, setConnectDialogOpen] = useState(false);
  const [infoHomeName, setInfoHomeName] = useState<string | null>(null);
  const clientRef = useRef<any>(null);
  const mqttLibRef = useRef<any>(null);
  const userDisconnected = useRef(false);
  const filterTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const failureCountRef = useRef(0);
  const [retryDelay, setRetryDelay] = useState(0);
  const [groupByHome, setGroupByHome] = useState(() => {
    const p = searchParams.get('groupByHome');
    return p === '0' ? false : true;
  });
  const [groupByRoom, setGroupByRoom] = useState(() => {
    const p = searchParams.get('groupByRoom');
    return p === '1' ? true : p === '0' ? false : true;
  });
  // Sections default to collapsed; the user opens the ones they care about.
  const [openHomes, setOpenHomes] = useState<Set<string>>(new Set());
  const [openRooms, setOpenRooms] = useState<Set<string>>(new Set());  // keyed `${homeSlug}/${roomSlug}`
  const [openGroups, setOpenGroups] = useState<Set<string>>(new Set());  // keyed by group topic
  const isLgUp = useIsLgUp();

  // Member slugs resolve to full topics via last-path-segment lookup —
  // built once per message batch instead of scanning per member per render.
  const slugToTopic = useMemo(() => buildSlugToTopicMap(messages), [messages]);
  const memberTopicSet = useMemo(() => buildMemberTopicSet(groupMembers, slugToTopic), [groupMembers, slugToTopic]);
  const getEffectivePayloadFor = useCallback(
    (topic: string, payload: string) => getEffectivePayloadPure(topic, payload, groupMembers, slugToTopic, messages),
    [groupMembers, slugToTopic, messages],
  );

  const updateUrlParams = useCallback((params: Record<string, string | null>) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      for (const [key, value] of Object.entries(params)) {
        if (value) next.set(key, value);
        else next.delete(key);
      }
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  // Keep the JSON textarea in sync with the selected topic's payload, so
  // publishes that came from the widget show up live. Skip while the user is
  // actively typing into the textarea.
  useEffect(() => {
    if (!selectedTopic) return;
    if (document.activeElement?.tagName === 'TEXTAREA') return;
    const raw = getEffectivePayloadFor(selectedTopic, messages[selectedTopic]?.payload || '{}');
    const formatted = (() => {
      try { return JSON.stringify(JSON.parse(raw), null, 2); }
      catch { return raw; }
    })();
    setPublishValues(prev => ({ ...prev, [selectedTopic]: formatted }));
  }, [selectedTopic, messages, getEffectivePayloadFor]);

  const selectTopic = useCallback((topic: string) => {
    setSelectedTopic(topic);
    setRawMode(false);
    updateUrlParams({ topic, view: null });
  }, [updateUrlParams]);

  const clearSelection = useCallback(() => {
    setSelectedTopic(null);
    updateUrlParams({ topic: null, view: null });
  }, [updateUrlParams]);

  // Esc closes the inspector — unless the user is typing, or a dialog/drawer
  // is open (those own the Esc and close themselves).
  useEffect(() => {
    if (!selectedTopic) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const el = document.activeElement as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (document.querySelector('[role="dialog"]')) return;
      clearSelection();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [selectedTopic, clearSelection]);

  // Deep link (?topic=…): once the topic is known, open its ancestors so the
  // selected row is actually visible in the tree. Runs once.
  const revealDoneRef = useRef(false);
  useEffect(() => {
    if (revealDoneRef.current || !selectedTopic) return;
    if (!messages[selectedTopic] && !groupMembers[selectedTopic]) return;
    revealDoneRef.current = true;
    const groupTopic = groupMembers[selectedTopic]
      ? selectedTopic
      : findGroupForTopic(selectedTopic, groupMembers, slugToTopic);
    const anchor = groupTopic ?? selectedTopic;
    const parts = anchor.split('/');
    if (parts[0] === 'homecast' && parts.length >= 2) {
      const homeSlug = parts[1];
      setOpenHomes(prev => new Set(prev).add(homeSlug));
      if (parts.length >= 4) setOpenRooms(prev => new Set(prev).add(`${homeSlug}/${parts[2]}`));
    }
    if (groupTopic && groupTopic !== selectedTopic) setOpenGroups(prev => new Set(prev).add(groupTopic));
  }, [selectedTopic, messages, groupMembers, slugToTopic]);

  const debouncedUpdateFilter = useCallback((value: string) => {
    clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(() => {
      updateUrlParams({ filter: value || null });
    }, 400);
  }, [updateUrlParams]);

  useEffect(() => () => clearTimeout(filterTimerRef.current), []);

  const onMqttDomain = isMqttDomain();
  const api = getApiBase();

  // On main domain: use Apollo. On mqtt.* domain: fetch via cookie.
  const { data: meData } = useQuery(GET_ME, { fetchPolicy: 'cache-first', skip: onMqttDomain });
  const { data: homesData } = useQuery(GET_CACHED_HOMES, { fetchPolicy: 'cache-first', skip: onMqttDomain });
  const [cookieUser, setCookieUser] = useState<CookieUser | null>(null);
  const [cookieHomes, setCookieHomes] = useState<CookieHome[]>([]);

  // Fetch user + homes via cookie on mqtt.* domains. Poll every 15s so the
  // relay-connected banner updates when the user brings their Mac online/offline.
  useEffect(() => {
    if (!onMqttDomain) return;
    const fetchOnce = () => {
      // Read the cookie per call, not once for the life of the effect: a
      // refresh during connect() rewrites it, and a poll pinned to the old
      // header would keep failing silently and leave the home chips empty.
      const headers = getAuthHeaders();
      if (!headers) return;
      fetch(api + '/', { method: 'POST', headers, body: JSON.stringify({ query: '{ me { id email name accountType } cachedHomes { id name role mqttEnabled relayConnected ownerEmail } }' }) })
        .then(r => r.json())
        .then(d => {
          if (d?.data?.me) setCookieUser(d.data.me);
          if (d?.data?.cachedHomes) setCookieHomes(d.data.cachedHomes);
        })
        .catch(() => {});
    };
    fetchOnce();
    const interval = setInterval(fetchOnce, 15000);
    return () => clearInterval(interval);
  }, [onMqttDomain, api]);

  const user = meData?.me ?? cookieUser;

  const homes = useMemo(() => {
    const raw: CookieHome[] = (homesData?.cachedHomes ?? cookieHomes) || [];
    const byName = new Map<string, CookieHome>();
    for (const h of raw) {
      const existing = byName.get(h.name);
      if (!existing || h.role === 'owner') byName.set(h.name, h);
    }
    return Array.from(byName.values());
  }, [homesData, cookieHomes]);

  // Derive topic counts + rooms per home from messages
  const { topicCountByHome, roomsByHome } = useMemo(() => {
    const counts: Record<string, number> = {};
    const rooms: Record<string, Set<string>> = {};
    for (const topic of Object.keys(messages)) {
      const p = topic.split('/');
      if (p[0] === 'homecast' && p.length >= 3) {
        counts[p[1]] = (counts[p[1]] || 0) + 1;
        if (p.length >= 4) {
          if (!rooms[p[1]]) rooms[p[1]] = new Set();
          rooms[p[1]].add(p[2]);
        }
      }
    }
    return { topicCountByHome: counts, roomsByHome: Object.fromEntries(Object.entries(rooms).map(([k, v]) => [k, Array.from(v).sort()])) };
  }, [messages]);

  // Build the MQTT slug for a home from its id + name — must match the
  // server's _make_slug (name slugified + '-' + first 4 hex of UUID).
  // Deriving from the home record (not from received topics) means the
  // filter still works for homes that haven't published a message yet.
  const homeSlugForName = useCallback((name: string) => {
    const home = homes.find(h => h.name === name);
    if (!home) return null;
    const base = name.toLowerCase().replace(/\s+/g, '-').replace(/'/g, '').replace(/"/g, '').replace(/[^a-z0-9-]/g, '');
    const suffix = home.id.replace(/-/g, '').slice(0, 4).toLowerCase();
    return `${base}-${suffix}`;
  }, [homes]);

  // Redirect off the mqtt.* domain for the cookie handshake before we
  // start loading mqtt.js or touching the broker.
  useEffect(() => {
    if (!needsMqttSync) return;
    markSyncAttempted();
    location.replace(mqttSyncUrl());
  }, [needsMqttSync]);

  // Load mqtt.js (skipped in mock mode — no broker needed)
  useEffect(() => {
    if (needsMqttSync || mockMode) return;
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/mqtt@5.10.0/dist/mqtt.min.js';
    s.onload = () => { mqttLibRef.current = (window as any).mqtt; };
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, [needsMqttSync, mockMode]);

  // ?mock=1 — seed realistic fake topics so the UI can be iterated without
  // a broker, login, or relay. Publishes from inline controls update the
  // local mock state instead of going to MQTT.
  useEffect(() => {
    if (!mockMode) return;
    const now = Date.now();
    const mk = (payload: object, ageSec = 0): TopicMessage => ({ payload: JSON.stringify(payload), timestamp: now - ageSec * 1000, updates: 1 });
    setCookieUser({ id: 'mock-user', email: 'mock@homecast.cloud', name: 'Mock User' });
    setCookieHomes([
      { id: '11111111-1111-1111-1111-111111111111', name: 'Beach House', role: 'owner', mqttEnabled: true, relayConnected: true, ownerEmail: 'mock@homecast.cloud' },
      { id: '22222222-2222-2222-2222-222222222222', name: 'County Hall', role: 'owner', mqttEnabled: true, relayConnected: false, ownerEmail: 'mock@homecast.cloud' },
    ]);
    const topics: Record<string, TopicMessage> = {
      // --- Beach House / kitchen ---
      'homecast/beach-house-1111/kitchen-aaaa/lamp-a1b2':       mk({ on: true,  brightness: 72, color_temp: 350, hue: 45, saturation: 80 }, 3),
      'homecast/beach-house-1111/kitchen-aaaa/fan-9c8d':        mk({ active: 1, speed: 30 }, 12),
      'homecast/beach-house-1111/kitchen-aaaa/outlet-77b1':     mk({ on: false }, 60),
      'homecast/beach-house-1111/kitchen-aaaa/sensor-44f1':     mk({ current_temp: 22.5, relative_humidity: 45, battery_level: 88 }, 8),
      'homecast/beach-house-1111/kitchen-aaaa/lights-group':    mk({ on: true, brightness: 40 }, 4),
      // --- Beach House / bedroom ---
      'homecast/beach-house-1111/bedroom-bbbb/lamp-77a2':       mk({ on: false, brightness: 0, color_temp: 270 }, 600),
      'homecast/beach-house-1111/bedroom-bbbb/thermo-22a3':     mk({ active: 1, current_temp: 19.5, heat_target: 21, cool_target: 24, hvac_mode: 'heat', relative_humidity: 48 }, 30),
      'homecast/beach-house-1111/bedroom-bbbb/lock-9911':       mk({ locked: 1 }, 3600),
      'homecast/beach-house-1111/bedroom-bbbb/motion-12cd':     mk({ motion: false, battery_level: 72 }, 90),
      // --- County Hall (offline relay) ---
      'homecast/county-hall-2222/lounge-cccc/lamp-ff00':        mk({ on: true, brightness: 100 }, 5000),
      'homecast/county-hall-2222/lounge-cccc/speaker-3344':     mk({ volume: 35, mute: false }, 5000),
    };
    setMessages(topics);
    setAvailability({
      'homecast/beach-house-1111/kitchen-aaaa/lamp-a1b2':       'online',
      'homecast/beach-house-1111/kitchen-aaaa/fan-9c8d':        'online',
      'homecast/beach-house-1111/kitchen-aaaa/outlet-77b1':     'online',
      'homecast/beach-house-1111/kitchen-aaaa/sensor-44f1':     'online',
      'homecast/beach-house-1111/kitchen-aaaa/lights-group':    'online',
      'homecast/beach-house-1111/bedroom-bbbb/lamp-77a2':       'online',
      'homecast/beach-house-1111/bedroom-bbbb/thermo-22a3':     'online',
      'homecast/beach-house-1111/bedroom-bbbb/lock-9911':       'online',
      'homecast/beach-house-1111/bedroom-bbbb/motion-12cd':     'online',
      'homecast/county-hall-2222/lounge-cccc/lamp-ff00':        'offline',
      'homecast/county-hall-2222/lounge-cccc/speaker-3344':     'offline',
    });
    setGroupMembers({
      'homecast/beach-house-1111/kitchen-aaaa/lights-group': [
        'homecast/beach-house-1111/kitchen-aaaa/lamp-a1b2',
        'homecast/beach-house-1111/bedroom-bbbb/lamp-77a2',
      ],
    });
    setConnStats({ connectedAt: now - 60_000, totalMessages: 11, clientId: 'mock-client-id' });
  }, [mockMode]);

  const connect = useCallback(async () => {
    if (!mqttLibRef.current) { setError('MQTT library not loaded yet'); return; }
    setConnecting(true); setError(null); userDisconnected.current = false;
    try {
      const result = await requestMqttToken();
      if (result.kind === 'signed-out') {
        // No usable session. The handshake on the main domain is the only way
        // to a login form from here, so take the user through it — once. Back
        // still signed out means the handshake isn't the answer, and looping
        // them between two domains would be worse than saying so.
        if (!syncAlreadyAttempted()) {
          markSyncAttempted();
          setConnecting(false);
          location.replace(mqttSyncUrl());
          return;
        }
        setAuthBlocked(true);
        setConnecting(false);
        setError('Your session has expired. Sign in again to see device state from your homes.');
        return;
      }
      if (result.kind === 'error') throw new Error(result.message);
      const token = result.token;
      // A working token means any future expiry deserves its own handshake.
      clearSyncAttempt();
      setAuthBlocked(false);
      const cid = 'browser_' + Math.random().toString(36).slice(2, 8);
      // reconnectPeriod: 0 disables mqtt.js' internal reconnect loop. We do
      // our own exponential backoff in the useEffect below; leaving both
      // enabled produced a 1Hz retry storm against a down broker.
      const client = mqttLibRef.current.connect('wss://mqtt.homecast.cloud:8084/mqtt', { username: '', password: token, clientId: cid, clean: true, reconnectPeriod: 0 });
      client.on('connect', () => {
        setConnected(true); setConnecting(false);
        failureCountRef.current = 0;
        setRetryDelay(0);
        setConnStats({ connectedAt: Date.now(), totalMessages: 0, clientId: cid });
        client.subscribe('homecast/#');
      });
      client.on('message', (topic: string, payload: Buffer) => {
        const text = payload.toString();
        msgTimestamps.current.push(Date.now());
        setConnStats(prev => ({ ...prev, totalMessages: prev.totalMessages + 1 }));
        // An empty retained payload is how MQTT says "this topic is gone" — it
        // is what the relay publishes when an accessory is renamed, removed, or
        // moved to a different room. Dropping the row is the whole point of
        // that publish; keeping it left the vacated topic on screen as a blank
        // row, indistinguishable from a live device reporting nothing.
        const isTombstone = text === '';
        // Track availability topics separately
        if (topic.endsWith('/availability')) {
          const baseTopic = topic.replace(/\/availability$/, '');
          setAvailability(prev => {
            if (!isTombstone) return { ...prev, [baseTopic]: text };
            if (!(baseTopic in prev)) return prev;
            const { [baseTopic]: _gone, ...rest } = prev;
            return rest;
          });
          return;
        }
        // Track group membership topics
        if (topic.endsWith('/members')) {
          const baseTopic = topic.replace(/\/members$/, '');
          if (isTombstone) {
            setGroupMembers(prev => {
              if (!(baseTopic in prev)) return prev;
              const { [baseTopic]: _gone, ...rest } = prev;
              return rest;
            });
            return;
          }
          try {
            const members: string[] = JSON.parse(text);
            setGroupMembers(prev => ({ ...prev, [baseTopic]: members }));
            // Create a placeholder topic entry so the group appears in the list
            setMessages(prev => {
              if (prev[baseTopic]?.updates > 0) return prev;  // Already has real state from event
              return { ...prev, [baseTopic]: { payload: '{}', timestamp: Date.now(), updates: 0 } };
            });
          } catch {}
          return;
        }
        // Skip /set echo topics
        if (topic.endsWith('/set')) return;
        if (isTombstone) {
          setMessages(prev => {
            if (!(topic in prev)) return prev;
            const { [topic]: _gone, ...rest } = prev;
            return rest;
          });
          setSelectedTopic(prev => (prev === topic ? null : prev));
          return;
        }
        setMessages(prev => ({ ...prev, [topic]: { payload: text, timestamp: Date.now(), updates: (prev[topic]?.updates ?? 0) + 1 } }));
      });
      client.on('error', (err: Error) => { setError(err.message); setConnecting(false); setConnected(false); });
      client.on('close', () => {
        setConnected(false);
        setConnecting(false);
        if (!userDisconnected.current) failureCountRef.current += 1;
      });
      clientRef.current = client;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed');
      setConnecting(false);
      failureCountRef.current += 1;
    }
  }, []);

  const disconnect = useCallback(() => {
    userDisconnected.current = true;
    clientRef.current?.end(); clientRef.current = null; setConnected(false);
  }, []);

  const addToHistory = useCallback((topic: string, payload: string) => {
    setPublishHistory(prev => [{ topic, payload, timestamp: Date.now() }, ...prev].slice(0, 20));
  }, []);

  // Map a topic's home-slug (parts[1]) back to the CookieHome record by
  // comparing against each home's derived slug — same format the server uses.
  const homeForSlug = useCallback((slug: string): CookieHome | undefined => {
    return homes.find(h => homeSlugForName(h.name) === slug);
  }, [homes, homeSlugForName]);

  // In mock mode, "publishes" just mutate local state so the UI reacts the
  // same way it would when a retained message comes back over MQTT. We mirror
  // the relay's behavior of translating /set write-keys to state-keys
  // (e.g. lock_target → locked, target → position) so widgets visually flip.
  const mockPublish = useCallback((topic: string, payload: string) => {
    const base = topic.replace(/\/set$/, '');
    const simulateRelay = (incoming: Record<string, unknown>) => {
      const out: Record<string, unknown> = { ...incoming };
      if ('lock_target' in out) {
        out.locked = (out.lock_target === true || out.lock_target === 1 || out.lock_target === 'true') ? 1 : 0;
        delete out.lock_target;
      }
      if ('target' in out) {
        out.position = Number(out.target);
        delete out.target;
      }
      return out;
    };
    setMessages(prev => {
      const prevMsg = prev[base];
      let nextPayload = payload;
      try {
        const incoming = JSON.parse(payload);
        const echoed = simulateRelay(incoming);
        const existing = prevMsg ? JSON.parse(prevMsg.payload) : {};
        nextPayload = JSON.stringify({ ...existing, ...echoed });
      } catch { /* keep raw */ }
      return { ...prev, [base]: { payload: nextPayload, timestamp: Date.now(), updates: (prevMsg?.updates || 0) + 1 } };
    });
    addToHistory(topic.endsWith('/set') ? topic : topic + '/set', payload);
  }, [addToHistory]);

  const publishToSet = useCallback((topic: string, payload: string) => {
    if (mockMode) { mockPublish(topic, payload); return; }
    if (!clientRef.current || !connected) return;
    const t = topic.endsWith('/set') ? topic : topic + '/set';
    clientRef.current.publish(t, payload);
    addToHistory(t, payload);
  }, [connected, addToHistory, mockMode, mockPublish]);

  const publishProp = useCallback((topic: string, key: string, value: unknown) => {
    if (mockMode) { mockPublish(topic, JSON.stringify({ [key]: value })); return; }
    if (!clientRef.current || !connected) return;
    const t = topic.endsWith('/set') ? topic : topic + '/set';
    const p = JSON.stringify({ [key]: value });
    clientRef.current.publish(t, p);
    addToHistory(t, p);
  }, [connected, addToHistory, mockMode, mockPublish]);

  // Auto-connect with exponential backoff. On each consecutive failure we wait
  // longer (500ms, 1s, 2s, … capped at 10s) so a broken token or broker doesn't
  // peg the auth endpoint or the broker.
  useEffect(() => {
    // authBlocked: the server has refused our credential and refreshing it
    // failed. Retrying that forever is what put "Retrying in 8s" under an error
    // no retry could ever clear.
    if (needsMqttSync || authBlocked || connected || connecting || userDisconnected.current) { setRetryDelay(0); return; }
    const delay = Math.min(500 * 2 ** failureCountRef.current, 10_000);
    setRetryDelay(delay);
    const t = setTimeout(() => {
      if (mqttLibRef.current && !connected && !connecting && !userDisconnected.current) connect();
    }, delay);
    return () => clearTimeout(t);
  }, [connect, connected, connecting, needsMqttSync, authBlocked]);

  useEffect(() => { return () => { clientRef.current?.end(); }; }, []);

  // Message rate calculator (every 2s)
  useEffect(() => {
    if (!connected) return;
    const interval = setInterval(() => {
      const now = Date.now();
      msgTimestamps.current = msgTimestamps.current.filter(t => now - t < 10000);
      setMsgRate(Math.round(msgTimestamps.current.length / 10 * 10) / 10);
    }, 2000);
    return () => clearInterval(interval);
  }, [connected]);

  // Filter topics by search text. Group members are excluded — they render
  // nested under their group node, never in the plain lists.
  const filteredTopics = useMemo(() => {
    return Object.entries(messages)
      .filter(([topic]) => {
        if (filter && !topic.toLowerCase().includes(filter.toLowerCase())) return false;
        if (memberTopicSet.has(topic)) return false;
        return true;
      })
      .sort(([a], [b]) => a.localeCompare(b));
  }, [messages, filter, memberTopicSet]);

  const topicTree = useMemo(
    () => buildTopicTree(filteredTopics, groupMembers, slugToTopic, messages, { groupByHome, groupByRoom }),
    [filteredTopics, groupMembers, slugToTopic, messages, groupByHome, groupByRoom],
  );

  const onToggleHome = useCallback((slug: string) => {
    setOpenHomes(prev => { const n = new Set(prev); if (n.has(slug)) n.delete(slug); else n.add(slug); return n; });
  }, []);
  const onToggleRoom = useCallback((key: string) => {
    setOpenRooms(prev => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  }, []);
  const onToggleGroup = useCallback((topic: string) => {
    setOpenGroups(prev => { const n = new Set(prev); if (n.has(topic)) n.delete(topic); else n.add(topic); return n; });
  }, []);

  if (needsMqttSync) return null;

  // Inspector content is identical for the desktop pane and the mobile
  // drawer — only the variant (stacked vs tabbed) differs.
  const selectedMessage = selectedTopic ? messages[selectedTopic] : undefined;
  const selectedEp = selectedTopic ? getEffectivePayloadFor(selectedTopic, selectedMessage?.payload || '{}') : '';
  const renderInspector = (variant: 'pane' | 'sheet') => selectedTopic && (
    <InspectorPanel
      topic={selectedTopic}
      message={selectedMessage}
      effectivePayload={selectedEp}
      rowType={rowTypeForTopic(selectedTopic, groupMembers)}
      homeOffline={homeForSlug(selectedTopic.split('/')[1] || '')?.relayConnected === false}
      rawMode={rawMode}
      onRawModeChange={(v) => { setRawMode(v); updateUrlParams({ view: v ? 'json' : null }); }}
      publishValue={publishValues[selectedTopic] ?? selectedEp}
      onPublishValueChange={(v) => setPublishValues(prev => ({ ...prev, [selectedTopic]: v }))}
      onPublishToSet={publishToSet}
      onPublishProp={publishProp}
      onClose={clearSelection}
      variant={variant}
    />
  );

  return (
    <div className="min-h-screen bg-background">
      <style>{`
        @keyframes mqttFlash {
          0% { background-color: rgba(34, 197, 94, 0.15); }
          100% { background-color: transparent; }
        }
        .animate-mqtt-flash { animation: mqttFlash 8s ease-out forwards; }
      `}</style>
      <>
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2.5 shrink-0">
            <img src="/icon-192.png" alt="Homecast" className="h-6 w-6 rounded" />
            <h1 className="text-lg font-semibold whitespace-nowrap">MQTT Browser</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-3 overflow-x-auto">
            {user && (
              <div className="hidden sm:flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <User className="h-3 w-3" />
                <span>{user.email}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 shrink-0">
              {connected ? <Wifi className="h-3.5 w-3.5 text-green-500" /> : connecting ? null : <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className={`text-[11px] ${connected ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                {connected ? 'Connected' : connecting ? 'Connecting...' : !userDisconnected.current && retryDelay >= 1000 ? `Retrying in ${Math.round(retryDelay / 1000)}s` : 'Disconnected'}
              </span>
            </div>
            <button onClick={() => setConnectDialogOpen(true)} className="text-[11px] px-2.5 py-1 rounded border hover:bg-muted transition-colors flex items-center gap-1 shrink-0 whitespace-nowrap">
              <Key className="h-3 w-3" /> Connection Details
            </button>
            {connected ? (
              <button onClick={disconnect} className="text-[11px] px-2.5 py-1 rounded border hover:bg-muted transition-colors">Disconnect</button>
            ) : (
              <button onClick={connect} disabled={connecting} className="text-[11px] px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50">
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      </div>
      {error && (
        <div className="max-w-7xl mx-auto px-4 pt-3">
          <div className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            <span>{error}</span>
            {/* An auth error is the one the user can act on, and mqtt.* serves
                no login form of its own — so this is the way out of it. */}
            {authBlocked && (
              <a
                href={mqttSyncUrl()}
                onClick={clearSyncAttempt}
                className="shrink-0 text-[11px] px-2.5 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 no-underline"
              >
                Sign in
              </a>
            )}
          </div>
        </div>
      )}

      <div className="max-w-7xl mx-auto px-4 py-4 space-y-3">
        {/* Connection Info */}
        {connected && (
          <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
            <span>Broker <span className="font-mono">mqtt.homecast.cloud:8084</span></span>
            <span>Client <span className="font-mono">{connStats.clientId}</span></span>
            <span className="tabular-nums">{connStats.totalMessages} messages</span>
            <span className="tabular-nums">{msgRate} msg/s</span>
            <span className="tabular-nums">{connStats.connectedAt ? formatUptime(Date.now() - connStats.connectedAt) : ''}</span>
          </div>
        )}

        {/* Home chips + grouping toggles. Clicking a chip opens an info
            dialog (no filtering — the list already groups by home).
            Layout: chip row scrolls horizontally rather than wrapping;
            the count + Homes/Rooms pills wrap to a second line
            before the chips do on narrow viewports. */}
        {homes.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1.5">
            <div className="flex items-center gap-1.5 flex-nowrap overflow-x-auto min-w-0 max-w-full">
              <span className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium mr-0.5 shrink-0">Homes</span>
              {homes.map(home => {
                const slug = homeSlugForName(home.name);
                const count = slug ? topicCountByHome[slug] ?? 0 : 0;
                const relayOffline = home.relayConnected === false;
                const chipClass = !home.mqttEnabled
                  ? 'border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground'
                  : relayOffline
                    ? 'border-red-500/50 bg-red-500/10 hover:bg-red-500/20 text-red-700 dark:text-red-400'
                    : 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10 text-foreground';
                return (
                  <button
                    key={home.id}
                    onClick={() => setInfoHomeName(prev => prev === home.name ? null : home.name)}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-colors border shrink-0 ${chipClass}`}
                    title={relayOffline ? `${home.name} relay is offline` : 'Relay online'}
                  >
                    <Home className="h-3 w-3" />
                    <span className="font-medium">{home.name}</span>
                    {home.mqttEnabled ? (
                      <span className={`text-[9px] ${relayOffline ? 'text-red-700 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`}>
                        {relayOffline ? 'offline' : count > 0 ? count : 'on'}
                      </span>
                    ) : (
                      <span className="text-[9px]">mqtt off</span>
                    )}
                  </button>
                );
              })}
            </div>
            {/* Toggles + count. Wraps to a new row before the chip row does. */}
            {Object.keys(messages).length > 0 && (
              <div className="flex items-center gap-1.5 shrink-0">
                <span className="text-[10px] text-muted-foreground tabular-nums">
                  {filteredTopics.length === Object.keys(messages).length
                    ? `${Object.keys(messages).length}`
                    : `${filteredTopics.length}/${Object.keys(messages).length}`}
                </span>
                <button onClick={() => { const next = !groupByHome; setGroupByHome(next); setOpenHomes(new Set()); updateUrlParams({ groupByHome: next ? '1' : '0' }); }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${groupByHome ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-muted hover:text-foreground'}`}>
                  Homes
                </button>
                <button onClick={() => { const next = !groupByRoom; setGroupByRoom(next); setOpenRooms(new Set()); updateUrlParams({ groupByRoom: next ? '1' : '0' }); }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${groupByRoom ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-muted hover:text-foreground'}`}>
                  Rooms
                </button>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" placeholder="Search topics..." value={filter} onChange={(e) => { setFilter(e.target.value); debouncedUpdateFilter(e.target.value); }}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted/30 border rounded-md outline-none focus:border-primary font-mono" />
        </div>

        {/* Publish History */}
        {publishHistory.length > 0 && (
          <div className="space-y-1">
            <button onClick={() => setShowHistory(!showHistory)} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              {showHistory ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Clock className="h-3 w-3" />
              Publish History ({publishHistory.length})
            </button>
            {showHistory && (
              <div className="border rounded-md divide-y text-[11px]">
                {publishHistory.map((entry, i) => (
                  <button key={i} onClick={() => { publishToSet(entry.topic.replace(/\/set$/, ''), entry.payload); }}
                    className="w-full flex items-center gap-2 px-2.5 py-1.5 text-left hover:bg-muted/50 transition-colors">
                    <span className="text-muted-foreground tabular-nums shrink-0">{new Date(entry.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    <span className="font-mono text-muted-foreground truncate">{entry.topic}</span>
                    <span className="ml-auto font-mono shrink-0"><FmtVal payload={entry.payload} /></span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Topics: tree pane + (when a topic is selected on lg+) inspector.
            With nothing selected the inspector is gone entirely and the
            tree takes the full width. */}
        {filteredTopics.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {connected
              ? 'Waiting for messages...'
              : authBlocked
                ? 'Sign in to see device state from your homes'
                : 'Connect to see device state from your homes'}
          </div>
        ) : (
          <div className={selectedTopic ? 'lg:grid lg:grid-cols-[minmax(0,1fr)_26rem] lg:gap-4 lg:items-start' : undefined}>
            <TreePane
              tree={topicTree}
              groupByHome={groupByHome}
              groupByRoom={groupByRoom}
              openHomes={openHomes}
              openRooms={openRooms}
              openGroups={openGroups}
              onToggleHome={onToggleHome}
              onToggleRoom={onToggleRoom}
              onToggleGroup={onToggleGroup}
              selectedTopic={selectedTopic}
              onSelect={selectTopic}
              availability={availability}
              groupMembers={groupMembers}
              getEffectivePayload={getEffectivePayloadFor}
            />
            {selectedTopic && (
              <aside className="hidden lg:block lg:sticky lg:top-[76px] lg:max-h-[calc(100vh-92px)] lg:overflow-y-auto animate-in fade-in slide-in-from-right-4 duration-200">
                {renderInspector('pane')}
              </aside>
            )}
          </div>
        )}

      </div>

      {/* Mobile inspector: bottom drawer below the lg breakpoint */}
      <Drawer open={!!selectedTopic && !isLgUp} onOpenChange={(o) => { if (!o) clearSelection(); }}>
        <DrawerContent className="max-h-[85vh]" aria-describedby={undefined}>
          <DrawerTitle className="sr-only">Topic inspector</DrawerTitle>
          <div className="overflow-y-auto px-4 pb-6 pt-2">
            {renderInspector('sheet')}
          </div>
        </DrawerContent>
      </Drawer>

      {/* Connect Dialog */}
      <ConnectDialog
        open={connectDialogOpen}
        onOpenChange={setConnectDialogOpen}
        homes={homes}
      />
      <HomeInfoDialog
        open={!!infoHomeName}
        onOpenChange={(o) => { if (!o) setInfoHomeName(null); }}
        home={homes.find(h => h.name === infoHomeName) ?? null}
        slug={infoHomeName ? homeSlugForName(infoHomeName) : null}
        topicCount={(infoHomeName ? topicCountByHome[homeSlugForName(infoHomeName) ?? ''] : 0) ?? 0}
        roomCount={(infoHomeName ? roomsByHome[homeSlugForName(infoHomeName) ?? ''] : [])?.length ?? 0}
      />
      </>
    </div>
  );
}
