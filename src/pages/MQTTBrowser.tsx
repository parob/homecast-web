import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { useMutation, useQuery } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { Radio, Send, Trash2, Search, Wifi, WifiOff, Code, SlidersHorizontal, Home, User } from 'lucide-react';
import { GET_ME, GET_HOMES, GET_HOME_MQTT_ENABLED } from '@/lib/graphql/queries';

const CREATE_MQTT_TOKEN = gql`
  mutation CreateMqttToken {
    createMqttToken
  }
`;

interface TopicMessage {
  payload: string;
  timestamp: number;
  updates: number;
}

const PROPERTY_RANGES: Record<string, { min: number; max: number; step?: number }> = {
  brightness: { min: 0, max: 100 },
  color_temp: { min: 50, max: 500 },
  hue: { min: 0, max: 360 },
  saturation: { min: 0, max: 100 },
  speed: { min: 0, max: 100 },
  target: { min: 0, max: 100 },
  volume: { min: 0, max: 100 },
  battery: { min: 0, max: 100 },
};

const BOOLEAN_PROPS = new Set(['on', 'active', 'mute', 'motion', 'contact', 'locked']);

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
  const clientRef = useRef<any>(null);
  const mqttLibRef = useRef<any>(null);

  // Get user info + homes
  const { data: meData } = useQuery(GET_ME, { fetchPolicy: 'cache-first' });
  const { data: homesData } = useQuery(GET_HOMES, { fetchPolicy: 'cache-first' });
  const user = meData?.me;
  const homes: Array<{ id: string; name: string; accessoryCount: number }> = homesData?.homes ?? [];

  // Check mqtt_enabled for each home
  const [homeStatuses, setHomeStatuses] = useState<Record<string, boolean>>({});
  useEffect(() => {
    homes.forEach(home => {
      if (homeStatuses[home.id] !== undefined) return;
      // We can't call useQuery in a loop — use fetch instead
      const jwt = localStorage.getItem('homecast-token');
      if (!jwt) return;
      const apiBase = location.hostname.includes('staging') ? 'https://staging.api.homecast.cloud' : 'https://api.homecast.cloud';
      fetch(apiBase + '/graphql', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${jwt}` },
        body: JSON.stringify({ query: `{ homeMqttEnabled(homeId: "${home.id}") }` }),
      }).then(r => r.json()).then(d => {
        setHomeStatuses(prev => ({ ...prev, [home.id]: d?.data?.homeMqttEnabled ?? false }));
      }).catch(() => {});
    });
  }, [homes, homeStatuses]);

  // Load mqtt.js dynamically
  useEffect(() => {
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/mqtt@5.10.0/dist/mqtt.min.js';
    script.onload = () => { mqttLibRef.current = (window as any).mqtt; };
    document.head.appendChild(script);
    return () => { script.remove(); };
  }, []);

  const connect = useCallback(async () => {
    if (!mqttLibRef.current) { setError('MQTT library not loaded yet'); return; }
    setConnecting(true);
    setError(null);

    try {
      let token: string | null = null;
      try {
        const { data } = await createMqttToken();
        token = data?.createMqttToken;
      } catch {
        const jwt = document.cookie.split('; ').find(c => c.startsWith('hc_token='))?.split('=')[1];
        if (jwt) {
          const apiBase = location.hostname.includes('staging') ? 'https://staging.api.homecast.cloud' : 'https://api.homecast.cloud';
          const resp = await fetch(apiBase + '/graphql', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${decodeURIComponent(jwt)}` },
            body: JSON.stringify({ query: 'mutation { createMqttToken }' }),
          });
          const result = await resp.json();
          token = result?.data?.createMqttToken;
        }
      }
      if (!token) throw new Error('Sign in at homecast.cloud first');

      const client = mqttLibRef.current.connect('wss://mqtt.homecast.cloud:8084/mqtt', {
        username: '',
        password: token,
        clientId: 'browser_' + Math.random().toString(36).slice(2, 8),
        clean: true,
      });

      client.on('connect', () => {
        setConnected(true);
        setConnecting(false);
        client.subscribe('homecast/#');
      });

      client.on('message', (topic: string, payload: Buffer) => {
        setMessages(prev => ({
          ...prev,
          [topic]: {
            payload: payload.toString(),
            timestamp: Date.now(),
            updates: (prev[topic]?.updates ?? 0) + 1,
          },
        }));
      });

      client.on('error', (err: Error) => { setError(err.message); setConnecting(false); setConnected(false); });
      client.on('close', () => { setConnected(false); setConnecting(false); });
      clientRef.current = client;
    } catch (e: any) {
      setError(e.message || 'Connection failed');
      setConnecting(false);
    }
  }, [createMqttToken]);

  const disconnect = useCallback(() => {
    clientRef.current?.end();
    clientRef.current = null;
    setConnected(false);
  }, []);

  const publishToSet = useCallback((topic: string, payload: string) => {
    if (!clientRef.current || !connected) return;
    clientRef.current.publish(topic.endsWith('/set') ? topic : topic + '/set', payload);
  }, [connected]);

  const publishProperty = useCallback((topic: string, key: string, value: any) => {
    if (!clientRef.current || !connected) return;
    clientRef.current.publish(topic.endsWith('/set') ? topic : topic + '/set', JSON.stringify({ [key]: value }));
  }, [connected]);

  const clearMessages = useCallback(() => { setMessages({}); }, []);

  useEffect(() => {
    const timer = setTimeout(() => {
      if (mqttLibRef.current && !connected && !connecting) connect();
    }, 500);
    return () => clearTimeout(timer);
  }, [connect, connected, connecting]);

  useEffect(() => { return () => { clientRef.current?.end(); }; }, []);

  // Derive topic counts per home from messages
  const topicCountByHome = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const topic of Object.keys(messages)) {
      const parts = topic.split('/');
      if (parts[0] === 'homecast' && parts.length >= 3) {
        counts[parts[1]] = (counts[parts[1]] || 0) + 1;
      }
    }
    return counts;
  }, [messages]);

  const filteredTopics = Object.entries(messages)
    .filter(([topic]) => !filter || topic.toLowerCase().includes(filter.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

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
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <User className="h-3.5 w-3.5" />
                <span>{user.email}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5 text-sm">
              {connected ? (
                <>
                  <Wifi className="h-4 w-4 text-green-500" />
                  <span className="text-green-600 dark:text-green-400 text-xs">Connected</span>
                </>
              ) : connecting ? (
                <span className="text-muted-foreground text-xs">Connecting...</span>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground text-xs">Disconnected</span>
                </>
              )}
            </div>
            {connected ? (
              <button onClick={disconnect} className="text-xs px-3 py-1.5 rounded-md border hover:bg-muted transition-colors">
                Disconnect
              </button>
            ) : (
              <button onClick={connect} disabled={connecting} className="text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50">
                {connecting ? 'Connecting...' : 'Connect'}
              </button>
            )}
          </div>
        </div>
      </div>

      {error && (
        <div className="max-w-4xl mx-auto px-4 pt-3">
          <div className="text-sm text-red-500 bg-red-500/10 rounded-md px-3 py-2">{error}</div>
        </div>
      )}

      <div className="max-w-4xl mx-auto px-4 py-4 space-y-4">
        {/* Homes summary */}
        {homes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {homes.map(home => {
              const mqttEnabled = homeStatuses[home.id];
              const topicCount = Object.keys(topicCountByHome).find(slug =>
                slug.startsWith(home.name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, ''))
              );
              const count = topicCount ? topicCountByHome[topicCount] : 0;

              return (
                <button
                  key={home.id}
                  onClick={() => setFilter(topicCount || home.name.toLowerCase().replace(/\s+/g, '-'))}
                  className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-colors ${
                    mqttEnabled
                      ? 'border-green-500/30 bg-green-500/5 hover:bg-green-500/10'
                      : 'border-border bg-muted/30 hover:bg-muted/50 opacity-50'
                  }`}
                >
                  <Home className="h-3.5 w-3.5 text-muted-foreground" />
                  <span className="font-medium">{home.name}</span>
                  {mqttEnabled ? (
                    <span className="text-[10px] text-green-600 dark:text-green-400">
                      {count > 0 ? `${count} topics` : 'enabled'}
                    </span>
                  ) : (
                    <span className="text-[10px] text-muted-foreground">MQTT off</span>
                  )}
                </button>
              );
            })}
          </div>
        )}

        {/* Filter + Clear */}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Filter topics..."
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm bg-muted/30 border rounded-md outline-none focus:border-primary font-mono"
            />
          </div>
          {Object.keys(messages).length > 0 && (
            <button onClick={clearMessages} className="text-xs px-3 py-2 rounded-md border hover:bg-muted transition-colors text-muted-foreground">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        {/* Topic count */}
        {Object.keys(messages).length > 0 && (
          <p className="text-xs text-muted-foreground">
            {filteredTopics.length === Object.keys(messages).length
              ? `${Object.keys(messages).length} topics`
              : `${filteredTopics.length} of ${Object.keys(messages).length} topics`}
          </p>
        )}

        {/* Topic List */}
        {filteredTopics.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">
            {connected ? 'Waiting for messages...' : 'Connect to see device state from your homes'}
          </div>
        ) : (
          <div className="border rounded-lg divide-y overflow-hidden">
            {filteredTopics.map(([topic, { payload, timestamp }]) => {
              const isExpanded = expandedTopic === topic;
              const age = Date.now() - timestamp;
              const isRecent = age < 2000;

              return (
                <div key={topic}>
                  <button
                    onClick={() => {
                      if (isExpanded) {
                        setExpandedTopic(null);
                      } else {
                        setExpandedTopic(topic);
                        setRawMode(false);
                        try { setPublishValue(JSON.stringify(JSON.parse(payload), null, 2)); }
                        catch { setPublishValue(payload); }
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-all ${isRecent ? 'bg-green-500/5' : ''}`}
                  >
                    <span className="font-mono text-xs text-muted-foreground min-w-0 flex-shrink truncate">
                      <TopicPath topic={topic} />
                    </span>
                    <span className="ml-auto flex items-center gap-2 flex-shrink-0">
                      <span className="font-mono text-xs max-w-[300px] truncate">
                        <FormattedValue payload={payload} />
                      </span>
                      <span className="text-[10px] text-muted-foreground tabular-nums w-12 text-right">
                        {new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      {messages[topic].updates > 1 && (
                        <span className="text-[9px] text-muted-foreground bg-muted rounded px-1 py-0.5 tabular-nums">
                          {messages[topic].updates}
                        </span>
                      )}
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="pl-6 pr-3 py-2 bg-muted/20 border-t border-dashed space-y-1.5">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setRawMode(false)} className={`p-0.5 rounded ${!rawMode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`} title="Visual">
                          <SlidersHorizontal className="h-3 w-3" />
                        </button>
                        <button onClick={() => setRawMode(true)} className={`p-0.5 rounded ${rawMode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`} title="Raw">
                          <Code className="h-3 w-3" />
                        </button>
                      </div>

                      {rawMode ? (
                        <div className="space-y-1.5">
                          <textarea value={publishValue} onChange={(e) => setPublishValue(e.target.value)} className="w-full font-mono text-[11px] bg-background border rounded p-1.5 outline-none focus:border-primary resize-none" rows={3} />
                          <div className="flex justify-end">
                            <button onClick={() => publishToSet(topic, publishValue)} className="flex items-center gap-1 text-[11px] px-2 py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors">
                              <Send className="h-3 w-3" /> Publish
                            </button>
                          </div>
                        </div>
                      ) : (
                        <PropertyEditor payload={payload} onPublish={(key, value) => publishProperty(topic, key, value)} />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function PropertyEditor({ payload, onPublish }: { payload: string; onPublish: (key: string, value: any) => void }) {
  let props: Record<string, any> = {};
  try { props = JSON.parse(payload); } catch { return <p className="text-xs text-muted-foreground">Cannot parse payload</p>; }
  return (
    <div className="space-y-2">
      {Object.entries(props).map(([key, value]) => (
        <PropertyRow key={key} name={key} value={value} onPublish={onPublish} />
      ))}
    </div>
  );
}

function PropertyRow({ name, value, onPublish }: { name: string; value: any; onPublish: (key: string, value: any) => void }) {
  const isBool = BOOLEAN_PROPS.has(name) || typeof value === 'boolean';
  const isNumber = typeof value === 'number' && !isBool;
  const range = PROPERTY_RANGES[name];

  if (isBool) {
    const boolVal = value === true || value === 1 || value === 'on';
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-muted-foreground">{name}</span>
        <button onClick={() => onPublish(name, boolVal ? false : true)} className={`relative w-10 h-5 rounded-full transition-colors ${boolVal ? 'bg-green-500' : 'bg-muted-foreground/30'}`}>
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${boolVal ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
    );
  }

  if (isNumber && range) {
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="text-sm text-muted-foreground w-24 shrink-0">{name}</span>
        <input type="range" min={range.min} max={range.max} step={range.step ?? 1} defaultValue={value} onMouseUp={(e) => onPublish(name, Number((e.target as HTMLInputElement).value))} onTouchEnd={(e) => onPublish(name, Number((e.target as HTMLInputElement).value))} className="flex-1 h-1.5 accent-primary cursor-pointer" />
        <input type="number" defaultValue={value} onBlur={(e) => { const v = Number(e.target.value); if (!isNaN(v)) onPublish(name, v); }} onKeyDown={(e) => { if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value); if (!isNaN(v)) onPublish(name, v); } }} className="w-14 text-xs font-mono text-right bg-background border rounded px-1.5 py-1 outline-none focus:border-primary" min={range.min} max={range.max} />
      </div>
    );
  }

  if (isNumber) {
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-muted-foreground">{name}</span>
        <input type="number" defaultValue={value} onBlur={(e) => { const v = Number(e.target.value); if (!isNaN(v)) onPublish(name, v); }} onKeyDown={(e) => { if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value); if (!isNaN(v)) onPublish(name, v); } }} className="w-20 text-xs font-mono text-right bg-background border rounded px-1.5 py-1 outline-none focus:border-primary" />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{name}</span>
      <input type="text" defaultValue={String(value)} onBlur={(e) => onPublish(name, e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onPublish(name, (e.target as HTMLInputElement).value); }} className="w-32 text-xs font-mono bg-background border rounded px-1.5 py-1 outline-none focus:border-primary" />
    </div>
  );
}

function TopicPath({ topic }: { topic: string }) {
  const parts = topic.split('/');
  if (parts[0] === 'homecast' && parts.length >= 4) {
    return (
      <>
        <span className="text-blue-500">{parts[1]}</span>/
        <span className="text-purple-400">{parts[2]}</span>/
        <span className="text-foreground">{parts.slice(3).join('/')}</span>
      </>
    );
  }
  return <>{topic}</>;
}

function FormattedValue({ payload }: { payload: string }) {
  try {
    const obj = JSON.parse(payload);
    return (
      <>
        {Object.entries(obj).map(([k, v], i) => (
          <span key={k}>
            {i > 0 && <span className="text-muted-foreground"> · </span>}
            <span className="text-muted-foreground">{k}: </span>
            {v === true ? <span className="text-green-500">on</span> :
             v === false ? <span className="text-red-400">off</span> :
             typeof v === 'number' ? <span className="text-amber-400">{v}</span> :
             <span>{String(v)}</span>}
          </span>
        ))}
      </>
    );
  } catch {
    return <>{payload}</>;
  }
}
