import {
  Activity as ActivityIcon,
  Battery,
  Boxes,
  CircleDot,
  ShieldAlert,
  Sparkles,
  Thermometer,
  Zap,
} from 'lucide-react';
import type { CategoryId } from '@/history/categories';

export const CATEGORY_ICONS: Record<CategoryId, React.ComponentType<{ className?: string }>> = {
  climate: Thermometer,
  activity: ActivityIcon,
  safety: ShieldAlert,
  energy: Zap,
  battery: Battery,
  groups: Boxes,
  virtual: Sparkles,
  other: CircleDot,
};
