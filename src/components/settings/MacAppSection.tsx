import { Switch } from '@/components/ui/switch';
import HomeKit from '@/native/homekit-bridge';

interface MacAppSectionProps {
  launchAtLogin: boolean;
  setLaunchAtLogin: (value: boolean) => void;
}

export function MacAppSection({
  launchAtLogin,
  setLaunchAtLogin,
}: MacAppSectionProps) {
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm">Open at Login</p>
          <p className="text-xs text-muted-foreground">Start Homecast when you log in to your Mac</p>
        </div>
        <Switch
          checked={launchAtLogin}
          onCheckedChange={async (checked) => {
            setLaunchAtLogin(checked);
            try {
              const result = await HomeKit.setLaunchAtLogin(checked);
              setLaunchAtLogin(result.launchAtLogin);
            } catch {
              setLaunchAtLogin(!checked);
            }
          }}
        />
      </div>
    </div>
  );
}
