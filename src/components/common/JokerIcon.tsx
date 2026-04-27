import type { ReactElement } from 'react';
import { useTheme, type ThemeId } from '@/context/ThemeContext';

interface IconProps {
  size?: number;
}

type IconComponent = (props: IconProps) => ReactElement;

const strokeProps = (size: number) => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2 as const,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
});

const CallFriendIcon: IconComponent = ({ size = 24 }) => (
  <svg {...strokeProps(size)} aria-hidden="true">
    <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z" />
  </svg>
);

const PlayerOutIcon: IconComponent = ({ size = 24 }) => (
  <svg {...strokeProps(size)} aria-hidden="true">
    <circle cx="9" cy="7" r="4" />
    <path d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
    <line x1="17" y1="8" x2="22" y2="13" />
    <line x1="22" y1="8" x2="17" y2="13" />
  </svg>
);

const SoloAnswerIcon: IconComponent = ({ size = 24 }) => (
  <svg {...strokeProps(size)} aria-hidden="true">
    <circle cx="12" cy="12" r="10" />
    <circle cx="12" cy="12" r="6" />
    <circle cx="12" cy="12" r="2" />
  </svg>
);

const AskAiIcon: IconComponent = ({ size = 24 }) => (
  <svg {...strokeProps(size)} aria-hidden="true">
    <path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3z" />
    <path d="M19 14l.9 2.6L22 17l-2.1.4L19 20l-.9-2.6L16 17l2.1-.4L19 14z" />
    <path d="M5 15l.6 1.9L7 17l-1.4.1L5 19l-.6-1.9L3 17l1.4-.1L5 15z" />
  </svg>
);

const DoubleAnswerIcon: IconComponent = ({ size = 24 }) => (
  <svg {...strokeProps(size)} aria-hidden="true">
    <path d="M2 13l4 4 9-11" />
    <path d="M11 17l9-11" />
  </svg>
);

const StummIcon: IconComponent = ({ size = 24 }) => (
  <svg {...strokeProps(size)} aria-hidden="true">
    <polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5" />
    <line x1="23" y1="9" x2="17" y2="15" />
    <line x1="17" y1="9" x2="23" y2="15" />
  </svg>
);

const BASE_ICONS: Record<string, IconComponent> = {
  'call-friend': CallFriendIcon,
  'player-out': PlayerOutIcon,
  'solo-answer': SoloAnswerIcon,
  'ask-ai': AskAiIcon,
  'double-answer': DoubleAnswerIcon,
  stumm: StummIcon,
};

// Theme-specific icon overrides — optional, keyed by theme then joker id.
// Unspecified combinations fall back to BASE_ICONS.
const THEME_ICONS: Partial<Record<ThemeId, Record<string, IconComponent>>> = {};

interface JokerIconProps {
  id: string;
  /** Override the theme used for icon lookup (admin passes `adminTheme`). */
  theme?: ThemeId;
  /** Pixel size of the SVG. Default 24. */
  size?: number;
}

export default function JokerIcon({ id, theme, size }: JokerIconProps) {
  const { activeTheme } = useTheme();
  const resolvedTheme = theme ?? activeTheme;
  const themeIcon = THEME_ICONS[resolvedTheme]?.[id];
  const Icon = themeIcon ?? BASE_ICONS[id];
  if (!Icon) return null;
  return <Icon size={size} />;
}

export function hasJokerIcon(id: string): boolean {
  return id in BASE_ICONS;
}
