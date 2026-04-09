import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { Radio, Send, Search, Wifi, WifiOff, Code, SlidersHorizontal, Home, User, ChevronDown, ChevronRight, Clock, Activity } from 'lucide-react';
import { GET_ME, GET_CACHED_HOMES } from '@/lib/graphql/queries';

const CREATE_MQTT_TOKEN = gql`
  mutation CreateMqttToken { createMqttToken }
`;

interface TopicMessage { payload: string; timestamp: number; updates: number; }

const RANGES: Record<string, { min: number; max: number }> = {
  brightness: { min: 0, max: 100 }, color_temp: { min: 50, max: 500 },
  hue: { min: 0, max: 360 }, saturation: { min: 0, max: 100 },
  speed: { min: 0, max: 100 }, target: { min: 0, max: 100 },
  volume: { min: 0, max: 100 }, battery: { min: 0, max: 100 },
};
const BOOLS = new Set(['on', 'active', 'mute', 'motion', 'contact', 'locked']);

export default function MQTTBrowser() {
  const [createMqttToken] = useMutation(CREATE_MQTT_TOKEN);
  const [connected, setConnected] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [messages, setMessages] = useState<Record<string, TopicMessage>>({});
  const [filter, setFilter] = useState('');
  const [expandedTopic, setExpandedTopic] = useState<string | null>(null);
  const [rawMode, setRawMode] = useState(false);
  const [publishValue, setPublishValue] = useState('');
  const [selectedHome, setSelectedHome] = useState<string | null>(null);
  const [selectedRoom, setSelectedRoom] = useState<string | null>(null);
  const [availability, setAvailability] = useState<Record<string, string>>({});  // baseTopic → "online"|"offline"
  const [publishHistory, setPublishHistory] = useState<Array<{ topic: string; payload: string; timestamp: number }>>([]);
  const [showHistory, setShowHistory] = useState(false);
  const [showConnInfo, setShowConnInfo] = useState(false);
  const [connStats, setConnStats] = useState({ connectedAt: 0, totalMessages: 0, clientId: '' });
  const [msgRate, setMsgRate] = useState(0);
  const msgTimestamps = useRef<number[]>([]);
  const clientRef = useRef<any>(null);
  const mqttLibRef = useRef<any>(null);
  const userDisconnected = useRef(false);

  const { data: meData } = useQuery(GET_ME, { fetchPolicy: 'cache-first' });
  const { data: homesData } = useQuery(GET_CACHED_HOMES, { fetchPolicy: 'cache-first' });
  const user = meData?.me;

  const homes = useMemo(() => {
    const raw: Array<{ id: string; name: string; role?: string; mqttEnabled?: boolean }> = homesData?.cachedHomes ?? [];
    const byName = new Map<string, typeof raw[0]>();
    for (const h of raw) {
      const existing = byName.get(h.name);
      if (!existing || h.role === 'owner') byName.set(h.name, h);
    }
    return Array.from(byName.values());
  }, [homesData]);

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

  // Find the home slug that matches a home name
  const homeSlugForName = useCallback((name: string) => {
    const prefix = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    return Object.keys(topicCountByHome).find(slug => slug.startsWith(prefix)) || null;
  }, [topicCountByHome]);

  // Load mqtt.js
  useEffect(() => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/mqtt@5.10.0/dist/mqtt.min.js';
    s.onload = () => { mqttLibRef.current = (window as any).mqtt; };
    document.head.appendChild(s);
    return () => { s.remove(); };
  }, []);

  const connect = useCallback(async () => {
    if (!mqttLibRef.current) { setError('MQTT library not loaded yet'); return; }
    setConnecting(true); setError(null); userDisconnected.current = false;
    try {
      let token: string | null = null;
      try {
        const { data } = await createMqttToken();
        token = data?.createMqttToken;
      } catch {
        const jwt = document.cookie.split('; ').find(c => c.startsWith('hc_token='))?.split('=')[1];
        if (jwt) {
          const api = location.hostname.includes('staging') ? 'https://staging.api.homecast.cloud' : 'https://api.homecast.cloud';
          const r = await fetch(api + '/graphql', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${decodeURIComponent(jwt)}` }, body: JSON.stringify({ query: 'mutation { createMqttToken }' }) });
          token = (await r.json())?.data?.createMqttToken;
        }
      }
      if (!token) throw new Error('Sign in at homecast.cloud first');
      const cid = 'browser_' + Math.random().toString(36).slice(2, 8);
      const client = mqttLibRef.current.connect('wss://mqtt.homecast.cloud:8084/mqtt', { username: '', password: token, clientId: cid, clean: true });
      client.on('connect', () => { setConnected(true); setConnecting(false); setConnStats({ connectedAt: Date.now(), totalMessages: 0, clientId: cid }); client.subscribe('homecast/#'); });
      client.on('message', (topic: string, payload: Buffer) => {
        const text = payload.toString();
        msgTimestamps.current.push(Date.now());
        setConnStats(prev => ({ ...prev, totalMessages: prev.totalMessages + 1 }));
        // Track availability topics separately
        if (topic.endsWith('/availability')) {
          const baseTopic = topic.replace(/\/availability$/, '');
          setAvailability(prev => ({ ...prev, [baseTopic]: text }));
          return;  // Don't show availability as a separate topic row
        }
        setMessages(prev => ({ ...prev, [topic]: { payload: text, timestamp: Date.now(), updates: (prev[topic]?.updates ?? 0) + 1 } }));
      });
      client.on('error', (err: Error) => { setError(err.message); setConnecting(false); setConnected(false); });
      client.on('close', () => { setConnected(false); setConnecting(false); });
      clientRef.current = client;
    } catch (e: any) { setError(e.message || 'Connection failed'); setConnecting(false); }
  }, [createMqttToken]);

  const disconnect = useCallback(() => {
    userDisconnected.current = true;
    clientRef.current?.end(); clientRef.current = null; setConnected(false);
  }, []);

  const addToHistory = useCallback((topic: string, payload: string) => {
    setPublishHistory(prev => [{ topic, payload, timestamp: Date.now() }, ...prev].slice(0, 20));
  }, []);

  const publishToSet = useCallback((topic: string, payload: string) => {
    if (!clientRef.current || !connected) return;
    const t = topic.endsWith('/set') ? topic : topic + '/set';
    clientRef.current.publish(t, payload);
    addToHistory(t, payload);
  }, [connected, addToHistory]);

  const publishProp = useCallback((topic: string, key: string, value: any) => {
    if (!clientRef.current || !connected) return;
    const t = topic.endsWith('/set') ? topic : topic + '/set';
    const p = JSON.stringify({ [key]: value });
    clientRef.current.publish(t, p);
    addToHistory(t, p);
  }, [connected, addToHistory]);

  // Auto-connect (only once, not after manual disconnect)
  useEffect(() => {
    const t = setTimeout(() => {
      if (mqttLibRef.current && !connected && !connecting && !userDisconnected.current) connect();
    }, 500);
    return () => clearTimeout(t);
  }, [connect, connected, connecting]);

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

  // Filter topics by search + home + room
  const filteredTopics = useMemo(() => {
    return Object.entries(messages)
      .filter(([topic]) => {
        if (filter && !topic.toLowerCase().includes(filter.toLowerCase())) return false;
        if (selectedHome) {
          const slug = homeSlugForName(selectedHome);
          if (slug && !topic.split('/')[1]?.startsWith(slug.split('-').slice(0, -1).join('-'))) {
            // Match by slug prefix (without the hash suffix)
            const parts = topic.split('/');
            if (parts[0] !== 'homecast' || parts[1] !== slug) return false;
          }
          if (selectedRoom) {
            const parts = topic.split('/');
            if (parts.length < 3 || parts[2] !== selectedRoom) return false;
          }
        }
        return true;
      })
      .sort(([a], [b]) => a.localeCompare(b));
  }, [messages, filter, selectedHome, selectedRoom, homeSlugForName]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 sticky top-0 z-10">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <img src="/icon-192.png" alt="Homecast" className="h-6 w-6 rounded" />
            <h1 className="text-lg font-semibold">MQTT Browser</h1>
          </div>
          <div className="flex items-center gap-3">
            {user && (
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <User className="h-3 w-3" />
                <span>{user.email}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              {connected ? <Wifi className="h-3.5 w-3.5 text-green-500" /> : connecting ? null : <WifiOff className="h-3.5 w-3.5 text-muted-foreground" />}
              <span className={`text-[11px] ${connected ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}`}>
                {connected ? 'Connected' : connecting ? 'Connecting...' : 'Disconnected'}
              </span>
            </div>
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
        {/* Homes */}
        {homes.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {homes.map(home => {
                const slug = homeSlugForName(home.name);
                const count = slug ? topicCountByHome[slug] ?? 0 : 0;
                const isSelected = selectedHome === home.name;

                return (
                  <button
                    key={home.id}
                    onClick={() => {
                      if (isSelected) { setSelectedHome(null); setSelectedRoom(null); }
                      else { setSelectedHome(home.name); setSelectedRoom(null); }
                    }}
                    className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-[11px] transition-colors border ${
                      isSelected
                        ? 'border-primary bg-primary/10 text-primary'
                        : home.mqttEnabled
                          ? 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10 text-foreground'
                          : 'border-border bg-muted/30 hover:bg-muted/50 text-muted-foreground'
                    }`}
                  >
                    <Home className="h-3 w-3" />
                    <span className="font-medium">{home.name}</span>
                    {home.mqttEnabled ? (
                      <span className="text-[9px] text-green-600 dark:text-green-400">{count > 0 ? count : 'on'}</span>
                    ) : (
                      <span className="text-[9px]">off</span>
                    )}
                    {isSelected && <ChevronDown className="h-3 w-3" />}
                  </button>
                );
              })}
            </div>

            {/* Room chips when a home is selected */}
            {selectedHome && (() => {
              const slug = homeSlugForName(selectedHome);
              const rooms = slug ? roomsByHome[slug] : [];
              if (!rooms || rooms.length === 0) return null;
              return (
                <div className="flex flex-wrap gap-1 pl-4">
                  {rooms.map(room => (
                    <button
                      key={room}
                      onClick={() => setSelectedRoom(selectedRoom === room ? null : room)}
                      className={`px-2 py-0.5 rounded text-[10px] transition-colors ${
                        selectedRoom === room
                          ? 'bg-primary/10 text-primary border border-primary/30'
                          : 'bg-muted/50 text-muted-foreground hover:bg-muted border border-transparent'
                      }`}
                    >
                      {room.replace(/-[a-f0-9]{4}$/, '')}
                    </button>
                  ))}
                </div>
              );
            })()}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input type="text" placeholder="Search topics..." value={filter} onChange={(e) => setFilter(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 text-xs bg-muted/30 border rounded-md outline-none focus:border-primary font-mono" />
        </div>

        {/* Topic count + clear */}
        {Object.keys(messages).length > 0 && (
          <div className="flex items-center justify-between">
            <p className="text-[11px] text-muted-foreground">
              {filteredTopics.length === Object.keys(messages).length
                ? `${Object.keys(messages).length} topics`
                : `${filteredTopics.length} of ${Object.keys(messages).length} topics`}
            </p>
            <button onClick={() => setMessages({})} className="text-[10px] text-muted-foreground hover:text-foreground transition-colors">
              Clear view
            </button>
          </div>
        )}

        {/* Topics */}
        {filteredTopics.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {connected ? 'Waiting for messages...' : 'Connect to see device state from your homes'}
          </div>
        ) : (
          <div className="border rounded-lg divide-y overflow-hidden">
            {filteredTopics.map(([topic, { payload, timestamp }]) => {
              const isExpanded = expandedTopic === topic;
              const isRecent = Date.now() - timestamp < 2000;

              if (isExpanded) {
                const msg = messages[topic];
                return (
                  <div key={topic} className="bg-muted/20 border-l-2 border-l-primary">
                    {/* Clickable header — click topic to collapse */}
                    <button
                      onClick={() => setExpandedTopic(null)}
                      className="w-full flex items-center justify-between px-3 py-2 text-left hover:bg-muted/30 transition-colors"
                    >
                      <span className="font-mono text-xs"><TopicPath topic={topic} /></span>
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[11px]"><FmtVal payload={payload} /></span>
                        <span className="text-[10px] text-muted-foreground tabular-nums w-11 text-right">
                          {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        {msg.updates > 1 && <span className="text-[9px] text-muted-foreground bg-muted rounded px-1 tabular-nums">{msg.updates}</span>}
                      </div>
                    </button>
                    {/* Info bar */}
                    <div className="px-3 pb-1.5 flex items-center justify-between">
                      <span className="text-[10px] text-muted-foreground">
                        {availability[topic] && (
                          <span className={`inline-flex items-center gap-1 mr-2 ${availability[topic] === 'offline' ? 'text-muted-foreground' : 'text-green-600 dark:text-green-400'}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${availability[topic] === 'offline' ? 'bg-muted-foreground/50' : 'bg-green-500'}`} />
                            {availability[topic]}
                          </span>
                        )}
                        {msg.updates} update{msg.updates !== 1 ? 's' : ''} · last {new Date(timestamp).toLocaleTimeString()} · publishes to <span className="font-mono">/set</span>
                      </span>
                      <div className="flex border rounded overflow-hidden">
                        <button onClick={() => setRawMode(false)} className={`px-2 py-0.5 text-[10px] ${!rawMode ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}>Controls</button>
                        <button onClick={() => setRawMode(true)} className={`px-2 py-0.5 text-[10px] border-l ${rawMode ? 'bg-muted text-foreground font-medium' : 'text-muted-foreground hover:text-foreground'}`}>JSON</button>
                      </div>
                    </div>
                    {/* Controls / JSON */}
                    <div className="px-3 pb-3">
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
                        <PropertyEditor payload={payload} onPublish={(k, v) => publishProp(topic, k, v)} />
                      )}
                    </div>
                  </div>
                );
              }

              const avail = availability[topic];
              const isOffline = avail === 'offline';

              return (
                <button key={topic} onClick={() => { setExpandedTopic(topic); setRawMode(false); try { setPublishValue(JSON.stringify(JSON.parse(payload), null, 2)); } catch { setPublishValue(payload); } }}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left hover:bg-muted/50 transition-all ${isRecent ? 'bg-green-500/5' : ''} ${isOffline ? 'opacity-40' : ''}`}>
                  {avail && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOffline ? 'bg-muted-foreground/50' : 'bg-green-500'}`} />}
                  <span className="font-mono text-xs text-muted-foreground min-w-0 truncate"><TopicPath topic={topic} /></span>
                  <span className="ml-auto flex items-center gap-2 shrink-0">
                    <span className="font-mono text-[11px]"><FmtVal payload={payload} /></span>
                    <span className="text-[10px] text-muted-foreground tabular-nums w-11 text-right">{new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                    {messages[topic].updates > 1 && <span className="text-[9px] text-muted-foreground bg-muted rounded px-1 tabular-nums">{messages[topic].updates}</span>}
                  </span>
                </button>
              );
            })}
          </div>
        )}
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

        {/* Connection Info */}
        {connected && (
          <div className="space-y-1">
            <button onClick={() => setShowConnInfo(!showConnInfo)} className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors">
              {showConnInfo ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              <Activity className="h-3 w-3" />
              Connection Info
            </button>
            {showConnInfo && (
              <div className="border rounded-md px-3 py-2 text-[11px] text-muted-foreground space-y-0.5">
                <div className="flex justify-between"><span>Broker</span><span className="font-mono">mqtt.homecast.cloud:8084</span></div>
                <div className="flex justify-between"><span>Client ID</span><span className="font-mono">{connStats.clientId}</span></div>
                <div className="flex justify-between"><span>Messages</span><span className="tabular-nums">{connStats.totalMessages}</span></div>
                <div className="flex justify-between"><span>Rate</span><span className="tabular-nums">{msgRate} msg/s</span></div>
                <div className="flex justify-between"><span>Uptime</span><span className="tabular-nums">{connStats.connectedAt ? formatUptime(Date.now() - connStats.connectedAt) : '-'}</span></div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function formatUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function PropertyEditor({ payload, onPublish }: { payload: string; onPublish: (k: string, v: any) => void }) {
  let props: Record<string, any> = {};
  try { props = JSON.parse(payload); } catch { return <p className="text-xs text-muted-foreground">Cannot parse</p>; }
  return <div className="space-y-1">{Object.entries(props).map(([k, v]) => <PropRow key={k} name={k} value={v} onPublish={onPublish} />)}</div>;
}

function PropRow({ name, value, onPublish }: { name: string; value: any; onPublish: (k: string, v: any) => void }) {
  const [localVal, setLocalVal] = useState(value);
  useEffect(() => { setLocalVal(value); }, [value]);

  const isBool = BOOLS.has(name) || typeof value === 'boolean';
  const isNum = typeof value === 'number' && !isBool;
  const range = RANGES[name];

  if (isBool) {
    const on = localVal === true || localVal === 1;
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className="text-xs text-muted-foreground">{name}</span>
        <button onClick={() => { const nv = !on; setLocalVal(nv); onPublish(name, nv); }}
          className={`relative w-9 h-[18px] rounded-full transition-colors ${on ? 'bg-green-500' : 'bg-muted-foreground/30'}`}>
          <span className={`absolute top-[2px] w-[14px] h-[14px] rounded-full bg-white shadow transition-transform ${on ? 'left-[19px]' : 'left-[2px]'}`} />
        </button>
      </div>
    );
  }

  if (isNum && range) {
    return (
      <div className="flex items-center gap-2 py-0.5">
        <span className="text-xs text-muted-foreground w-20 shrink-0">{name}</span>
        <input type="range" min={range.min} max={range.max} value={localVal}
          onChange={(e) => setLocalVal(Number(e.target.value))}
          onMouseUp={() => onPublish(name, localVal)}
          onTouchEnd={() => onPublish(name, localVal)}
          className="flex-1 h-1 accent-primary cursor-pointer" />
        <input type="number" value={localVal} min={range.min} max={range.max}
          onChange={(e) => setLocalVal(Number(e.target.value))}
          onBlur={() => onPublish(name, localVal)}
          onKeyDown={(e) => { if (e.key === 'Enter') onPublish(name, localVal); }}
          className="w-12 text-[11px] font-mono text-right bg-background border rounded px-1 py-0.5 outline-none focus:border-primary" />
      </div>
    );
  }

  if (isNum) {
    return (
      <div className="flex items-center justify-between py-0.5">
        <span className="text-xs text-muted-foreground">{name}</span>
        <input type="number" value={localVal} onChange={(e) => setLocalVal(Number(e.target.value))}
          onBlur={() => onPublish(name, localVal)}
          onKeyDown={(e) => { if (e.key === 'Enter') onPublish(name, localVal); }}
          className="w-16 text-[11px] font-mono text-right bg-background border rounded px-1 py-0.5 outline-none focus:border-primary" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-0.5">
      <span className="text-xs text-muted-foreground">{name}</span>
      <input type="text" value={String(localVal)} onChange={(e) => setLocalVal(e.target.value)}
        onBlur={() => onPublish(name, localVal)}
        onKeyDown={(e) => { if (e.key === 'Enter') onPublish(name, localVal); }}
        className="w-28 text-[11px] font-mono bg-background border rounded px-1 py-0.5 outline-none focus:border-primary" />
    </div>
  );
}

function TopicPath({ topic }: { topic: string }) {
  const p = topic.split('/');
  if (p[0] === 'homecast' && p.length >= 4) {
    return <><span className="text-blue-500">{p[1]}</span>/<span className="text-purple-400">{p[2]}</span>/<span className="text-foreground">{p.slice(3).join('/')}</span></>;
  }
  return <>{topic}</>;
}

function FmtVal({ payload }: { payload: string }) {
  try {
    const obj = JSON.parse(payload);
    return <>{Object.entries(obj).map(([k, v], i) => (
      <span key={k}>
        {i > 0 && <span className="text-muted-foreground"> · </span>}
        <span className="text-muted-foreground">{k}: </span>
        {v === true ? <span className="text-green-500">on</span> : v === false ? <span className="text-red-400">off</span> : typeof v === 'number' ? <span className="text-amber-400">{v}</span> : <span>{String(v)}</span>}
      </span>
    ))}</>;
  } catch { return <>{payload}</>; }
}
