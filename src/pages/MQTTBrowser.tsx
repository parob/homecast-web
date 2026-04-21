import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@apollo/client/react';
import { Radio, Send, Search, Wifi, WifiOff, Home, User, ChevronDown, ChevronRight, Clock, Key } from 'lucide-react';
import { GET_ME, GET_CACHED_HOMES } from '@/lib/graphql/queries';
import { isMqttDomain, getApiBase, getAuthHeaders, getJWT } from './mqtt-browser/util';
import { formatUptime, PropertyEditor, TopicPath, FmtVal } from './mqtt-browser/helpers';
import { ConnectDialog } from './mqtt-browser/ConnectDialog';
import { HomeInfoDialog } from './mqtt-browser/HomeInfoDialog';

interface TopicMessage { payload: string; timestamp: number; updates: number; }
interface CookieUser { id: string; email: string; name: string; accountType?: string }
interface CookieHome { id: string; name: string; role?: string; mqttEnabled?: boolean; relayConnected?: boolean; ownerEmail?: string | null }

export default function MQTTBrowser() {
  // On mqtt.* the only auth signal is the cross-subdomain cookie. If it's
  // not there we can't read localStorage either (different origin), so we
  // hand off to homecast.cloud with ?mqtt_sync=1&return=… — that page's
  // AuthContext rewrites the cookie from localStorage (or sends the user
  // through /login) and bounces them back here with the cookie set.
  const needsMqttSync = isMqttDomain() && !getJWT();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, TopicMessage>>({});
  const [filter, setFilter] = useState(() => searchParams.get('filter') || '');
  const [expandedTopic, setExpandedTopic] = useState<string | null>(() => searchParams.get('topic'));
  const [rawMode, setRawMode] = useState(() => searchParams.get('view') === 'json');
  const [publishValue, setPublishValue] = useState('');
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
    return p === '1' ? true : p === '0' ? false : false;
  });
  const [groupByRoom, setGroupByRoom] = useState(() => {
    const p = searchParams.get('groupByRoom');
    return p === '1' ? true : p === '0' ? false : true;
  });
  const [hideMembers, setHideMembers] = useState(true);
  // Homes default to collapsed; the user opens the ones they care about.
  const [openHomes, setOpenHomes] = useState<Set<string>>(new Set());
  const [openRooms, setOpenRooms] = useState<Set<string>>(new Set());
  const [openGroupKeys, setOpenGroupKeys] = useState<Set<string>>(new Set());
  const appliedHomeDefaultRef = useRef(false);

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
    const headers = getAuthHeaders();
    if (!headers) return;
    const fetchOnce = () => {
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

  // Default Homes grouping on when the user has >1 mqtt-enabled home. Runs
  // once after homes load; a manual URL param or explicit toggle wins.
  useEffect(() => {
    if (appliedHomeDefaultRef.current) return;
    if (homes.length === 0) return;
    if (searchParams.has('groupByHome')) { appliedHomeDefaultRef.current = true; return; }
    if (homes.filter(h => h.mqttEnabled).length > 1) setGroupByHome(true);
    appliedHomeDefaultRef.current = true;
  }, [homes, searchParams]);

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
    const target = location.hostname.startsWith('staging.')
      ? 'https://staging.homecast.cloud/'
      : 'https://homecast.cloud/';
    location.replace(`${target}?mqtt_sync=1&return=${encodeURIComponent(location.href)}`);
  }, [needsMqttSync]);

  // Load mqtt.js
  useEffect(() => {
    if (needsMqttSync) return;
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/mqtt@5.10.0/dist/mqtt.min.js';
    s.onload = () => { mqttLibRef.current = (window as any).mqtt; };
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, [needsMqttSync]);

  const connect = useCallback(async () => {
    if (!mqttLibRef.current) { setError('MQTT library not loaded yet'); return; }
    setConnecting(true); setError(null); userDisconnected.current = false;
    try {
      let token: string | null = null;
      const headers = getAuthHeaders();
      if (headers) {
        const r = await fetch(getApiBase() + '/', { method: 'POST', headers, body: JSON.stringify({ query: 'mutation { createMqttToken }' }) });
        const result = await r.json();
        token = result?.data?.createMqttToken;
        if (!token && result?.errors?.[0]?.message) throw new Error(result.errors[0].message);
      }
      if (!token) {
        const loginUrl = location.hostname.includes('staging')
          ? 'https://staging.homecast.cloud/login'
          : 'https://homecast.cloud/login';
        throw new Error(`Not signed in. Sign in at ${loginUrl.replace('https://', '')} first, then return here.`);
      }
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
        // Track availability topics separately
        if (topic.endsWith('/availability')) {
          const baseTopic = topic.replace(/\/availability$/, '');
          setAvailability(prev => ({ ...prev, [baseTopic]: text }));
          return;
        }
        // Track group membership topics
        if (topic.endsWith('/members')) {
          const baseTopic = topic.replace(/\/members$/, '');
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

  const publishToSet = useCallback((topic: string, payload: string) => {
    if (!clientRef.current || !connected) return;
    const t = topic.endsWith('/set') ? topic : topic + '/set';
    clientRef.current.publish(t, payload);
    addToHistory(t, payload);
  }, [connected, addToHistory]);

  const publishProp = useCallback((topic: string, key: string, value: unknown) => {
    if (!clientRef.current || !connected) return;
    const t = topic.endsWith('/set') ? topic : topic + '/set';
    const p = JSON.stringify({ [key]: value });
    clientRef.current.publish(t, p);
    addToHistory(t, p);
  }, [connected, addToHistory]);

  // Auto-connect with exponential backoff. On each consecutive failure we wait
  // longer (500ms, 1s, 2s, … capped at 10s) so a broken token or broker doesn't
  // peg the auth endpoint or the broker.
  useEffect(() => {
    if (needsMqttSync || connected || connecting || userDisconnected.current) { setRetryDelay(0); return; }
    const delay = Math.min(500 * 2 ** failureCountRef.current, 10_000);
    setRetryDelay(delay);
    const t = setTimeout(() => {
      if (mqttLibRef.current && !connected && !connecting && !userDisconnected.current) connect();
    }, delay);
    return () => clearTimeout(t);
  }, [connect, connected, connecting, needsMqttSync]);

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

  // Filter topics by search text + group-member hiding. Home/room filtering
  // was removed — the per-home group headers already scope the view.
  const filteredTopics = useMemo(() => {
    return Object.entries(messages)
      .filter(([topic]) => {
        if (filter && !topic.toLowerCase().includes(filter.toLowerCase())) return false;
        // Hide group members when "Groups" toggle is on
        if (hideMembers) {
          const isGM = Object.entries(groupMembers).some(([gt, ms]) =>
            ms.some(m => topic.endsWith('/' + m.split('/').pop())) && topic !== gt
          );
          if (isGM) return false;
        }
        return true;
      })
      .sort(([a], [b]) => a.localeCompare(b));
  }, [messages, filter, hideMembers, groupMembers]);

  // Build grouped tree. When Homes is on we bucket by home slug first;
  // when Rooms is also on we nest rooms under each home. When hideMembers
  // is on we additionally hoist service groups into their own sub-buckets
  // so they render as section headers with members nested beneath.
  type GroupBucket = {
    topic: string;
    payload: TopicMessage;
    memberTopics: Array<[string, TopicMessage]>;
  };
  type RoomBucket = {
    slug: string;
    plain: Array<[string, TopicMessage]>;
    groups: GroupBucket[];
  };
  type HomeBucket = {
    slug: string;
    rooms: RoomBucket[];
    // Topics with no room (homecast/<home>/...) — plain + group variants
    plain: Array<[string, TopicMessage]>;
    groups: GroupBucket[];
    allTopicCount: number;
  };
  const topicTree = useMemo<HomeBucket[] | null>(() => {
    // Build the tree whenever any grouping axis is active. Even with Homes
    // and Rooms both off, Groups-on still needs the tree so group buckets
    // can render as section headers.
    if (!groupByHome && !groupByRoom && !hideMembers) return null;

    // Resolve the set of member-accessory topics in the current messages map
    // so we can skip them (they'll render inside their group). Only applied
    // when the Groups toggle is on (hideMembers=true).
    const memberTopicSet = new Set<string>();
    if (hideMembers) {
      for (const [, members] of Object.entries(groupMembers)) {
        for (const memberSlug of members) {
          const short = memberSlug.split('/').pop();
          if (!short) continue;
          const full = Object.keys(messages).find(t => t.endsWith('/' + short));
          if (full) memberTopicSet.add(full);
        }
      }
    }

    const buildGroup = (topic: string, payload: TopicMessage): GroupBucket => {
      const members = groupMembers[topic] || [];
      const memberTopics: Array<[string, TopicMessage]> = [];
      for (const memberSlug of members) {
        const short = memberSlug.split('/').pop();
        if (!short) continue;
        const full = Object.keys(messages).find(t => t.endsWith('/' + short));
        if (full && messages[full]) memberTopics.push([full, messages[full]]);
      }
      return { topic, payload, memberTopics };
    };

    const byHome = new Map<string, HomeBucket>();
    const ensureHome = (slug: string) => {
      if (!byHome.has(slug)) byHome.set(slug, { slug, rooms: [], plain: [], groups: [], allTopicCount: 0 });
      return byHome.get(slug)!;
    };
    const ensureRoom = (h: HomeBucket, slug: string) => {
      let r = h.rooms.find(r => r.slug === slug);
      if (!r) { r = { slug, plain: [], groups: [] }; h.rooms.push(r); }
      return r;
    };

    for (const entry of filteredTopics) {
      const [topic, msg] = entry;
      const p = topic.split('/');
      const isHomecast = p[0] === 'homecast';
      const homeSlug = groupByHome && isHomecast && p.length >= 2 ? p[1] : '';
      const roomSlug = groupByRoom && isHomecast && p.length >= 4 ? p[2] : '';
      const isGroup = hideMembers && !!groupMembers[topic];

      // Hide member-accessories from the plain list — they render inside their group
      if (hideMembers && !isGroup && memberTopicSet.has(topic)) continue;

      const h = ensureHome(homeSlug);
      h.allTopicCount += 1;

      if (groupByRoom && roomSlug) {
        const r = ensureRoom(h, roomSlug);
        if (isGroup) r.groups.push(buildGroup(topic, msg));
        else r.plain.push(entry);
      } else {
        // No room segment — park at the home level
        if (isGroup) h.groups.push(buildGroup(topic, msg));
        else h.plain.push(entry);
      }
    }

    const arr = Array.from(byHome.values());
    arr.sort((a, b) => (!a.slug ? 1 : !b.slug ? -1 : a.slug.localeCompare(b.slug)));
    for (const h of arr) {
      h.rooms.sort((a, b) => (!a.slug ? 1 : !b.slug ? -1 : a.slug.localeCompare(b.slug)));
      for (const r of h.rooms) r.groups.sort((a, b) => a.topic.localeCompare(b.topic));
      h.groups.sort((a, b) => a.topic.localeCompare(b.topic));
    }
    return arr;
  }, [filteredTopics, groupByHome, groupByRoom, hideMembers, groupMembers, messages]);

  if (needsMqttSync) return null;

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
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between gap-2">
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
      {error && <div className="max-w-4xl mx-auto px-4 pt-3"><div className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2">{error}</div></div>}

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-3">
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
            the count + Homes/Rooms/Groups pills wrap to a second line
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
                <button onClick={() => { setHideMembers(v => !v); setOpenGroupKeys(new Set()); }}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${hideMembers ? 'bg-primary text-primary-foreground border-primary' : 'text-muted-foreground border-muted hover:text-foreground'}`}>
                  Groups
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


        {/* Topics */}
        {filteredTopics.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {connected ? 'Waiting for messages...' : 'Connect to see device state from your homes'}
          </div>
        ) : (() => {
          // --- Shared topic row renderer ---
          const getEffectivePayload = (topic: string, payload: string) => {
            if (!groupMembers[topic]) return payload;
            // Prefer the group's own retained payload when it has real content —
            // the server now aggregates group state (any-member-on semantics).
            try {
              const p = JSON.parse(payload);
              if (p && Object.keys(p).length > 0 && !p.members) return payload;
            } catch {}
            // Fallback for placeholder `{}` (only member list arrived, group state
            // not yet published by an older relay).
            for (const ms of (groupMembers[topic] || [])) {
              const mt = Object.keys(messages).find(t => t.endsWith('/' + ms.split('/').pop()));
              if (mt && messages[mt]?.payload) {
                try { const p = JSON.parse(messages[mt].payload); if (Object.keys(p).length > 0 && !p.members) return messages[mt].payload; } catch {}
              }
            }
            return payload;
          };

          const expandTopic = (topic: string) => {
            const ep = getEffectivePayload(topic, messages[topic]?.payload || '{}');
            setExpandedTopic(topic); setRawMode(false); updateUrlParams({ topic, view: null });
            try { setPublishValue(JSON.stringify(JSON.parse(ep), null, 2)); } catch { setPublishValue(ep); }
          };

          const renderDetailPanel = (topic: string, _payload: string, _timestamp: number, insetPx?: number) => {
            const ep = getEffectivePayload(topic, messages[topic]?.payload || '{}');
            const hasChevronSlot = hideMembers && Object.keys(groupMembers).length > 0;
            const ml = Math.max(insetPx || 0, 12) + (hasChevronSlot ? 44 : 16);
            const members = groupMembers[topic];
            const topicHome = homeForSlug(topic.split('/')[1] || '');
            const homeOffline = topicHome?.relayConnected === false;
            return (
              <div className="my-1 mr-3 border rounded-lg bg-background overflow-hidden" style={{ marginLeft: ml }}>
                {/* Header: status + Controls/JSON toggle */}
                <div className="flex items-center justify-between px-3 py-1.5 border-b bg-muted/20">
                  <span className="text-[10px] text-muted-foreground flex items-center gap-1.5">
                    {availability[topic] && (
                      <span className={`inline-flex items-center gap-1 ${availability[topic] === 'offline' ? 'text-muted-foreground' : 'text-green-600 dark:text-green-400'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${availability[topic] === 'offline' ? 'bg-muted-foreground/50' : 'bg-green-500'}`} />
                        {availability[topic]}
                      </span>
                    )}
                    {messages[topic]?.updates > 1 && <span>{messages[topic].updates} updates</span>}
                  </span>
                  <div className="flex border rounded overflow-hidden">
                    <button onClick={() => { setRawMode(false); updateUrlParams({ view: null }); }} className={`px-2 py-0.5 text-[10px] ${!rawMode ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}>Controls</button>
                    <button onClick={() => { setRawMode(true); updateUrlParams({ view: 'json' }); }} className={`px-2 py-0.5 text-[10px] border-l ${rawMode ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}>JSON</button>
                  </div>
                </div>
                {/* Relay-offline hint */}
                {homeOffline && (
                  <div className="px-3 py-1.5 border-b text-[10px] text-amber-700 dark:text-amber-400 bg-amber-500/10">
                    Relay offline — publishes won't reach the device.
                  </div>
                )}
                {/* Controls / JSON */}
                <div className="px-3 py-2">
                  {rawMode ? (
                    <div className="space-y-1.5">
                      <textarea ref={(el) => { if (el) { el.style.height = 'auto'; el.style.height = el.scrollHeight + 'px'; } }} value={publishValue} onChange={(e) => { setPublishValue(e.target.value); const t = e.target; t.style.height = 'auto'; t.style.height = t.scrollHeight + 'px'; }} className="w-full font-mono text-[11px] bg-background border rounded p-1.5 outline-none focus:border-primary resize-y min-h-[40px]" />
                      <div className="flex justify-end">
                        <button onClick={() => publishToSet(topic, publishValue)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90">
                          <Send className="h-3 w-3" /> Publish
                        </button>
                      </div>
                    </div>
                  ) : (
                    <PropertyEditor payload={ep} onPublish={(k, v) => publishProp(topic, k, v)} />
                  )}
                </div>
                {/* Group members footer */}
                {members && members.length > 0 && (
                  <div className="px-3 py-1.5 border-t text-[10px] text-muted-foreground font-mono">
                    <span className="text-purple-500 dark:text-purple-400 mr-1">ᴳ</span>
                    {members.map((s: string) => s.split('/').pop()?.replace(/-[a-f0-9]{4,}$/, '')).join(' · ')}
                  </div>
                )}
              </div>
            );
          };

          const renderCollapsedRow = (topic: string, payload: string, timestamp: number, opts?: { depth?: number; short?: boolean }) => {
            const avail = availability[topic];
            const isOffline = avail === 'offline';
            const isRecent = Date.now() - timestamp < 8000;
            const ep = getEffectivePayload(topic, payload);
            const isThisExpanded = expandedTopic === topic;
            const depth = opts?.depth || 0;
            const insetPx = depth * 16 + (opts?.short ? 20 : 0);

            return (
              <div key={isRecent ? `${topic}-${timestamp}` : topic}>
                <button onClick={() => { if (isThisExpanded) { setExpandedTopic(null); updateUrlParams({ topic: null, view: null }); } else expandTopic(topic); }}
                  className={`w-full flex items-center gap-2 pr-3 py-1.5 text-left hover:bg-muted/50 ${isOffline ? 'opacity-40' : ''} ${isRecent ? 'animate-mqtt-flash' : ''}`}
                  style={{ paddingLeft: Math.max(insetPx, 12) }}>
                  {avail && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOffline ? 'bg-muted-foreground/50' : 'bg-green-500'}`} />}
                  <span className="font-mono text-xs text-muted-foreground min-w-0 truncate">
                    {opts?.short ? <TopicPath topic={topic} short /> : <TopicPath topic={topic} />}
                  </span>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[11px]"><FmtVal payload={ep} /></span>
                    <span className="text-[10px] text-muted-foreground tabular-nums w-16 text-right">{new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</span>
                    {messages[topic]?.updates > 1 && <span className="text-[9px] text-muted-foreground bg-muted rounded px-1 tabular-nums">{messages[topic].updates}</span>}
                  </span>
                </button>
                {isThisExpanded && renderDetailPanel(topic, payload, timestamp, insetPx)}
              </div>
            );
          };

          // Group header — same shape as the room/home header (chevron + mono slug + right-count).
          // Right-side state chip opens the PropertyEditor; header body toggles member expansion.
          const renderGroupBucket = (g: { topic: string; payload: TopicMessage; memberTopics: Array<[string, TopicMessage]> }, headerDepth: number) => {
            const groupSlug = g.topic.split('/').pop() || g.topic;
            const isOpen = openGroupKeys.has(g.topic);
            const ep = getEffectivePayload(g.topic, g.payload.payload);
            const headerPadLeft = 12 + headerDepth * 16;
            const topicDepth = headerDepth + 1;
            const isEditorOpen = expandedTopic === g.topic;
            const toggleMembers = () => setOpenGroupKeys(prev => { const n = new Set(prev); if (n.has(g.topic)) n.delete(g.topic); else n.add(g.topic); return n; });
            const openEditor = () => {
              if (isEditorOpen) { setExpandedTopic(null); updateUrlParams({ topic: null, view: null }); }
              else expandTopic(g.topic);
            };
            return (
              <div key={g.topic}>
                <div className="w-full flex items-stretch bg-muted/30 hover:bg-muted/50 text-xs font-semibold">
                  <button
                    onClick={toggleMembers}
                    className="shrink-0 flex items-center justify-center text-muted-foreground hover:text-foreground"
                    style={{ paddingLeft: headerPadLeft, paddingRight: 4 }}
                    title={isOpen ? 'Collapse members' : 'Expand members'}
                  >
                    {isOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                  </button>
                  <button
                    onClick={openEditor}
                    className="flex-1 flex items-center justify-between pr-3 py-1.5 text-left"
                    title="Edit group state"
                  >
                    <span className="font-mono truncate">{groupSlug}</span>
                    <span className="flex items-center gap-2 shrink-0">
                      <span className="font-mono text-[11px] font-normal"><FmtVal payload={ep} /></span>
                      <span className="text-[10px] text-muted-foreground font-normal tabular-nums">{g.memberTopics.length}</span>
                    </span>
                  </button>
                </div>
                {isEditorOpen && renderDetailPanel(g.topic, g.payload.payload, g.payload.timestamp, headerPadLeft)}
                {isOpen && (
                  <div className="divide-y">
                    {g.memberTopics.map(([t, m]) =>
                      renderCollapsedRow(t, m.payload, m.timestamp, { depth: topicDepth, short: true })
                    )}
                  </div>
                )}
              </div>
            );
          };

          // Room-section renderer. headerDepth=0 when rooms are the outer
          // grouping; headerDepth=1 when rooms are nested inside a home.
          const renderRoomBucket = (r: RoomBucket, headerDepth: number) => {
            const topicDepth = headerDepth;
            const bodyCount = r.plain.length + r.groups.length;
            const renderBody = (innerDepth: number) => (
              <>
                {r.groups.map(g => renderGroupBucket(g, innerDepth))}
                {r.plain.map(([topic, { payload, timestamp }]) =>
                  renderCollapsedRow(topic, payload, timestamp, { depth: innerDepth, short: true })
                )}
              </>
            );
            if (!r.slug) {
              return <div key="_noroom" className="divide-y">{renderBody(topicDepth)}</div>;
            }
            const isOpen = openRooms.has(r.slug);
            const headerPadLeft = 12 + headerDepth * 16;
            return (
              <div key={r.slug}>
                <button onClick={() => setOpenRooms(prev => { const n = new Set(prev); if (n.has(r.slug)) n.delete(r.slug); else n.add(r.slug); return n; })}
                  className="w-full flex items-center justify-between pr-3 py-1.5 bg-muted/30 hover:bg-muted/50 text-xs font-semibold"
                  style={{ paddingLeft: headerPadLeft }}>
                  <span className="flex items-center gap-1.5">
                    {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                    <span className="font-mono">{r.slug}</span>
                  </span>
                  <span className="text-[10px] text-muted-foreground font-normal tabular-nums">{bodyCount}</span>
                </button>
                {isOpen && (
                  <div className="divide-y">{renderBody(topicDepth + 1)}</div>
                )}
              </div>
            );
          };

          // --- Grouped rendering ---
          if (topicTree) {
            // Render a home bucket's body at a given depth
            const renderHomeBody = (h: HomeBucket, rowDepth: number) => (
              <>
                {/* Groups first, then loose accessories, then rooms */}
                {h.groups.map(g => renderGroupBucket(g, rowDepth))}
                {h.plain.map(([topic, { payload, timestamp }]) =>
                  renderCollapsedRow(topic, payload, timestamp, { depth: rowDepth, short: rowDepth > 0 })
                )}
                {groupByRoom && h.rooms.map(r => renderRoomBucket(r, rowDepth))}
              </>
            );
            return (
              <div className="border rounded-lg overflow-hidden divide-y">
                {topicTree.map(homeBucket => {
                  // Not grouping by home (single unlabeled bucket) — render body flat at depth 0
                  if (!groupByHome) {
                    return <div key="_rooms" className="divide-y">{renderHomeBody(homeBucket, 0)}</div>;
                  }
                  const homeSlug = homeBucket.slug;
                  if (!homeSlug) {
                    return <div key="_nohome" className="divide-y">{renderHomeBody(homeBucket, 0)}</div>;
                  }
                  const isOpen = openHomes.has(homeSlug);
                  return (
                    <div key={homeSlug}>
                      <button onClick={() => setOpenHomes(prev => { const n = new Set(prev); if (n.has(homeSlug)) n.delete(homeSlug); else n.add(homeSlug); return n; })}
                        className="w-full flex items-center justify-between px-3 py-1.5 bg-muted/20 hover:bg-muted/40 text-xs font-semibold">
                        <span className="flex items-center gap-1.5">
                          {isOpen ? <ChevronDown className="h-3 w-3 text-muted-foreground" /> : <ChevronRight className="h-3 w-3 text-muted-foreground" />}
                          <span className="font-mono">{homeSlug}</span>
                        </span>
                        <span className="text-[10px] text-muted-foreground font-normal tabular-nums">{homeBucket.allTopicCount}</span>
                      </button>
                      {isOpen && (
                        <div className="divide-y">{renderHomeBody(homeBucket, 1)}</div>
                      )}
                    </div>
                  );
                })}
              </div>
            );
          }

          // --- Flat rendering (current behavior) ---
          return (
            <div className="border rounded-lg divide-y overflow-hidden">
              {filteredTopics.map(([topic, { payload, timestamp }]) =>
                renderCollapsedRow(topic, payload, timestamp)
              )}
            </div>
          );
        })()}

      </div>

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

