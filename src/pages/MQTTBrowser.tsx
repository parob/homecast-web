import { useState, useEffect, useRef, useCallback } from 'react';
import { useMutation } from '@apollo/client/react';
import { gql } from '@apollo/client/core';
import { Radio, Send, Trash2, Search, Wifi, WifiOff, Code, SlidersHorizontal } from 'lucide-react';

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
      const { data } = await createMqttToken();
      const token = data?.createMqttToken;
      if (!token) throw new Error('Failed to create MQTT token');

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

      client.on('error', (err: Error) => {
        setError(err.message);
        setConnecting(false);
        setConnected(false);
      });

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
    const setTopic = topic.endsWith('/set') ? topic : topic + '/set';
    clientRef.current.publish(setTopic, payload);
  }, [connected]);

  const publishProperty = useCallback((topic: string, key: string, value: any) => {
    if (!clientRef.current || !connected) return;
    const setTopic = topic.endsWith('/set') ? topic : topic + '/set';
    clientRef.current.publish(setTopic, JSON.stringify({ [key]: value }));
  }, [connected]);

  const clearMessages = useCallback(() => { setMessages({}); }, []);

  // Auto-connect on mount
  useEffect(() => {
    const timer = setTimeout(() => {
      if (mqttLibRef.current && !connected && !connecting) connect();
    }, 500);
    return () => clearTimeout(timer);
  }, [connect, connected, connecting]);

  useEffect(() => { return () => { clientRef.current?.end(); }; }, []);

  const filteredTopics = Object.entries(messages)
    .filter(([topic]) => !filter || topic.toLowerCase().includes(filter.toLowerCase()))
    .sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="border-b">
        <div className="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Radio className="h-5 w-5 text-muted-foreground" />
            <h1 className="text-lg font-semibold">MQTT Browser</h1>
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5 text-sm">
              {connected ? (
                <>
                  <Wifi className="h-4 w-4 text-green-500" />
                  <span className="text-green-600 dark:text-green-400">Connected</span>
                  <span className="text-muted-foreground">· {Object.keys(messages).length} topics</span>
                </>
              ) : connecting ? (
                <span className="text-muted-foreground">Connecting...</span>
              ) : (
                <>
                  <WifiOff className="h-4 w-4 text-muted-foreground" />
                  <span className="text-muted-foreground">Disconnected</span>
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

      <div className="max-w-4xl mx-auto px-4 py-4">
        <div className="flex gap-2 mb-3">
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
                        try {
                          setPublishValue(JSON.stringify(JSON.parse(payload), null, 2));
                        } catch { setPublishValue(payload); }
                      }
                    }}
                    className={`w-full flex items-center gap-3 px-3 py-2 text-left hover:bg-muted/50 transition-all ${isRecent ? 'bg-green-500/5' : ''}`}
                  >
                    <span className="font-mono text-xs text-muted-foreground min-w-0 flex-shrink truncate">
                      <TopicPath topic={topic} />
                    </span>
                    <span className="ml-auto flex items-center gap-3 flex-shrink-0">
                      <span className="font-mono text-xs max-w-[300px] truncate">
                        <FormattedValue payload={payload} />
                      </span>
                      <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                        {new Date(timestamp).toLocaleTimeString()}
                        {messages[topic].updates > 1 && ` · ${messages[topic].updates}x`}
                      </span>
                    </span>
                  </button>

                  {isExpanded && (
                    <div className="px-3 py-3 bg-muted/30 border-t space-y-3">
                      {/* Mode toggle */}
                      <div className="flex items-center justify-between">
                        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                          {topic.endsWith('/set') ? topic : topic + '/set'}
                        </p>
                        <div className="flex gap-1">
                          <button
                            onClick={() => setRawMode(false)}
                            className={`p-1 rounded ${!rawMode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            title="Visual editor"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                          </button>
                          <button
                            onClick={() => setRawMode(true)}
                            className={`p-1 rounded ${rawMode ? 'bg-muted text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
                            title="Raw JSON"
                          >
                            <Code className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>

                      {rawMode ? (
                        /* Raw JSON editor */
                        <div className="space-y-2">
                          <textarea
                            value={publishValue}
                            onChange={(e) => setPublishValue(e.target.value)}
                            className="w-full font-mono text-xs bg-background border rounded-md p-2 outline-none focus:border-primary resize-none"
                            rows={4}
                          />
                          <div className="flex justify-end">
                            <button
                              onClick={() => publishToSet(topic, publishValue)}
                              className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
                            >
                              <Send className="h-3.5 w-3.5" /> Publish
                            </button>
                          </div>
                        </div>
                      ) : (
                        /* Visual property editor */
                        <PropertyEditor
                          payload={payload}
                          onPublish={(key, value) => publishProperty(topic, key, value)}
                        />
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
        <button
          onClick={() => onPublish(name, boolVal ? false : true)}
          className={`relative w-10 h-5 rounded-full transition-colors ${boolVal ? 'bg-green-500' : 'bg-muted-foreground/30'}`}
        >
          <span className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-transform ${boolVal ? 'left-[22px]' : 'left-0.5'}`} />
        </button>
      </div>
    );
  }

  if (isNumber && range) {
    return (
      <div className="flex items-center gap-3 py-1">
        <span className="text-sm text-muted-foreground w-24 shrink-0">{name}</span>
        <input
          type="range"
          min={range.min}
          max={range.max}
          step={range.step ?? 1}
          value={value}
          onChange={(e) => {}}
          onMouseUp={(e) => onPublish(name, Number((e.target as HTMLInputElement).value))}
          onTouchEnd={(e) => onPublish(name, Number((e.target as HTMLInputElement).value))}
          className="flex-1 h-1.5 accent-primary cursor-pointer"
        />
        <input
          type="number"
          value={value}
          onChange={(e) => {}}
          onBlur={(e) => { const v = Number(e.target.value); if (!isNaN(v)) onPublish(name, v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value); if (!isNaN(v)) onPublish(name, v); } }}
          className="w-14 text-xs font-mono text-right bg-background border rounded px-1.5 py-1 outline-none focus:border-primary"
          min={range.min}
          max={range.max}
        />
      </div>
    );
  }

  if (isNumber) {
    return (
      <div className="flex items-center justify-between py-1">
        <span className="text-sm text-muted-foreground">{name}</span>
        <input
          type="number"
          defaultValue={value}
          onBlur={(e) => { const v = Number(e.target.value); if (!isNaN(v)) onPublish(name, v); }}
          onKeyDown={(e) => { if (e.key === 'Enter') { const v = Number((e.target as HTMLInputElement).value); if (!isNaN(v)) onPublish(name, v); } }}
          className="w-20 text-xs font-mono text-right bg-background border rounded px-1.5 py-1 outline-none focus:border-primary"
        />
      </div>
    );
  }

  // String / other
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-sm text-muted-foreground">{name}</span>
      <input
        type="text"
        defaultValue={String(value)}
        onBlur={(e) => onPublish(name, e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') onPublish(name, (e.target as HTMLInputElement).value); }}
        className="w-32 text-xs font-mono bg-background border rounded px-1.5 py-1 outline-none focus:border-primary"
      />
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
