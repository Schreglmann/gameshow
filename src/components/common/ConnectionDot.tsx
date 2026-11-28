import '@/styles/connection-status.css';
import { useServerOffline } from '@/hooks/useServerOffline';

/** Delay before the show admits to the audience that the server is gone. */
export const SHOW_OFFLINE_DELAY_MS = 3000;

/**
 * Small pulsing dot in the top-left corner of the show while the backend is
 * unreachable for more than 3 s. Unobtrusive on purpose: the host notices it,
 * the audience mostly doesn't. See specs/crash-recovery.md.
 *
 * `forceVisible` + `inline` are for the ThemeShowcase.
 */
export default function ConnectionDot({ forceVisible = false, inline = false }: { forceVisible?: boolean; inline?: boolean }) {
  const offline = useServerOffline(SHOW_OFFLINE_DELAY_MS);
  if (!offline && !forceVisible) return null;
  return (
    <span
      className={`connection-dot${inline ? ' connection-dot--inline' : ''}`}
      role="status"
      aria-label="Server getrennt"
      title="Server getrennt"
      data-testid="connection-dot"
    />
  );
}
