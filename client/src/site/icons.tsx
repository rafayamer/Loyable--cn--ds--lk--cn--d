// Icon registry — keeps content.ts free of JSX. Maps string keys → lucide icons.
import {
  QrCode, Award, Send, BarChart3, Users, Gift, Sparkles, Heart, Star,
  MessageSquare, Repeat, Crown, Bot, Store, Coffee, Scissors, Dumbbell,
  ShoppingBag, Building2, Smartphone, Zap, TrendingUp, Bell, type LucideIcon,
} from 'lucide-react';

export const ICONS: Record<string, LucideIcon> = {
  QrCode, Award, Send, BarChart3, Users, Gift, Sparkles, Heart, Star,
  MessageSquare, Repeat, Crown, Bot, Store, Coffee, Scissors, Dumbbell,
  ShoppingBag, Building2, Smartphone, Zap, TrendingUp, Bell,
};

export const Icon = ({ name, size = 20, className = '', style = {} }: { name: string; size?: number; className?: string; style?: React.CSSProperties }) => {
  const C = ICONS[name] ?? Sparkles;
  return <C size={size} className={className} style={style} />;
};
