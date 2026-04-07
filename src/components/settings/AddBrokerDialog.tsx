import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Loader2, CheckCircle2, XCircle } from 'lucide-react';
import { testMQTTConnection, addMQTTBroker, updateMQTTBroker } from '@/lib/mqtt-bridge';
import type { MQTTBrokerConfig } from '@/lib/mqtt-bridge';
import { toast } from 'sonner';

interface AddBrokerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  homeId: string;
  editBroker?: MQTTBrokerConfig;
  onSaved: () => void;
}

export function AddBrokerDialog({ open, onOpenChange, homeId, editBroker, onSaved }: AddBrokerDialogProps) {
  const isEditing = !!editBroker;

  const [name, setName] = useState(editBroker?.name ?? '');
  const [host, setHost] = useState(editBroker?.host ?? '');
  const [port, setPort] = useState(String(editBroker?.port ?? 1883));
  const [username, setUsername] = useState(editBroker?.username ?? '');
  const [password, setPassword] = useState('');
  const [useTLS, setUseTLS] = useState(editBroker?.useTLS ?? false);
  const [haDiscovery, setHaDiscovery] = useState(editBroker?.haDiscovery ?? true);
  const [topicPrefix, setTopicPrefix] = useState(editBroker?.topicPrefix ?? 'homecast');

  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<{ success: boolean; error?: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const resetForm = () => {
    setName(editBroker?.name ?? '');
    setHost(editBroker?.host ?? '');
    setPort(String(editBroker?.port ?? 1883));
    setUsername(editBroker?.username ?? '');
    setPassword('');
    setUseTLS(editBroker?.useTLS ?? false);
    setHaDiscovery(editBroker?.haDiscovery ?? true);
    setTopicPrefix(editBroker?.topicPrefix ?? 'homecast');
    setTesting(false);
    setTestResult(null);
    setSaving(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await testMQTTConnection({
        host,
        port: parseInt(port) || 1883,
        username: username || undefined,
        password: password || undefined,
        useTLS,
      });
      setTestResult(result);
    } catch (e: any) {
      setTestResult({ success: false, error: e.message });
    } finally {
      setTesting(false);
    }
  };

  const handleSave = async () => {
    if (!host.trim()) {
      toast.error('Host is required');
      return;
    }

    setSaving(true);
    try {
      if (isEditing && editBroker) {
        const updates: Record<string, any> = {
          name: name || host,
          host,
          port: parseInt(port) || 1883,
          username: username || '',
          useTLS,
          topicPrefix: topicPrefix || 'homecast',
          haDiscovery,
          haDiscoveryPrefix: 'homeassistant',
        };
        if (password) updates.password = password;
        await updateMQTTBroker(homeId, editBroker.id, updates);
        toast.success('Broker updated');
      } else {
        await addMQTTBroker(homeId, {
          name: name || host,
          host,
          port: parseInt(port) || 1883,
          username: username || undefined,
          password: password || undefined,
          useTLS,
          topicPrefix: topicPrefix || 'homecast',
          haDiscovery,
          haDiscoveryPrefix: 'homeassistant',
        });
        toast.success('Broker added');
      }
      onSaved();
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || 'Failed to save broker');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="sm:max-w-sm" style={{ zIndex: 10050 }}>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit MQTT Broker' : 'Add MQTT Broker'}</DialogTitle>
          <DialogDescription className="sr-only">{isEditing ? 'Edit broker settings' : 'Connect to an MQTT broker'}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label className="text-xs">Name</Label>
            <Input
              placeholder="My Mosquitto"
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoFocus
            />
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Host</Label>
              <Input
                placeholder="192.168.1.100"
                value={host}
                onChange={(e) => setHost(e.target.value)}
              />
            </div>
            <div className="w-20 space-y-1.5">
              <Label className="text-xs">Port</Label>
              <Input
                placeholder="1883"
                value={port}
                onChange={(e) => setPort(e.target.value)}
              />
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Username</Label>
              <Input
                placeholder="optional"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                autoComplete="off"
              />
            </div>
            <div className="flex-1 space-y-1.5">
              <Label className="text-xs">Password</Label>
              <Input
                type="password"
                placeholder={isEditing && editBroker?.hasPassword ? '••••••' : 'optional'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete="off"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Topic Prefix</Label>
            <Input
              placeholder="homecast"
              value={topicPrefix}
              onChange={(e) => setTopicPrefix(e.target.value)}
            />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">Use TLS</Label>
            <Switch checked={useTLS} onCheckedChange={setUseTLS} />
          </div>

          <div className="flex items-center justify-between">
            <Label className="text-xs">HA Auto-Discovery</Label>
            <Switch checked={haDiscovery} onCheckedChange={setHaDiscovery} />
          </div>

          {testResult && (
            <div className={`flex items-center gap-2 text-xs rounded-md px-3 py-2 ${testResult.success ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-red-500/10 text-red-700 dark:text-red-400'}`}>
              {testResult.success ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
              {testResult.success ? 'Connection successful' : testResult.error || 'Connection failed'}
            </div>
          )}

          <div className="flex gap-2 justify-end pt-1">
            <Button
              variant="outline"
              size="sm"
              onClick={handleTest}
              disabled={!host.trim() || testing}
            >
              {testing && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              Test Connection
            </Button>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={!host.trim() || saving}
            >
              {saving && <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />}
              {isEditing ? 'Save' : 'Add Broker'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
