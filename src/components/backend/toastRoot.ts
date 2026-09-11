/**
 * The single bottom-right toast stack shared by every admin toast.
 *
 * Both the per-pane `StatusMessage` and the shell-level `SaveStatusIndicator`
 * portal into this one container, so the save status and an ordinary toast stack
 * instead of landing on top of each other.
 */
export function getToastRoot(): HTMLElement {
  let el = document.getElementById('be-toast-root');
  if (!el) {
    el = document.createElement('div');
    el.id = 'be-toast-root';
    el.className = 'be-toast-container';
    document.body.appendChild(el);
  }
  return el;
}
