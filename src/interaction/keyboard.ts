/**
 * Keyboard alternative to touching the fabric: the home row plays the
 * surface's regions left → right (A = lowest … ' = highest).
 */
export const NOTE_KEYS = ['KeyA', 'KeyS', 'KeyD', 'KeyF', 'KeyG', 'KeyH', 'KeyJ', 'KeyK', 'KeyL', 'Semicolon', 'Quote'];
export const NOTE_KEY_LABELS = ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', ';', "'"];

export interface KeyboardHandlers {
  onNote: (region: number, strong: boolean) => void;
  onEscape?: () => void;
  onToggleClean?: () => void;
}

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || el.isContentEditable;
}

export function attachKeyboard(h: KeyboardHandlers): () => void {
  const onKey = (e: KeyboardEvent) => {
    if (e.metaKey || e.ctrlKey || e.altKey || isTyping(e.target)) return;
    if (e.code === 'Escape') {
      h.onEscape?.();
      return;
    }
    if (e.repeat) return;
    if (e.code === 'KeyC') {
      h.onToggleClean?.();
      return;
    }
    const region = NOTE_KEYS.indexOf(e.code);
    if (region < 0) return;
    e.preventDefault();
    h.onNote(region, e.shiftKey);
  };
  window.addEventListener('keydown', onKey);
  return () => window.removeEventListener('keydown', onKey);
}
