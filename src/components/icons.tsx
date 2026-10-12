/** Tiny line icons — 16px, currentColor, decorative (labels carry meaning). */
const base = {
  width: 16,
  height: 16,
  viewBox: '0 0 16 16',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.4,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
  'aria-hidden': true,
};

export const SoundOnIcon = () => (
  <svg {...base}><path d="M2.5 6.2h2.2L8 3.5v9L4.7 9.8H2.5z" /><path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.9a5.8 5.8 0 0 1 0 8.2" /></svg>
);
export const SoundOffIcon = () => (
  <svg {...base}><path d="M2.5 6.2h2.2L8 3.5v9L4.7 9.8H2.5z" /><path d="M10.5 6l3.5 4M14 6l-3.5 4" /></svg>
);
export const PlayIcon = () => (
  <svg {...base}><path d="M5 3.5v9l7-4.5z" /></svg>
);
export const StopIcon = () => (
  <svg {...base}><rect x="4" y="4" width="8" height="8" rx="1.2" /></svg>
);
export const CaptureIcon = () => (
  <svg {...base}><circle cx="8" cy="8" r="5.3" /><circle cx="8" cy="8" r="2" /></svg>
);
export const ResetIcon = () => (
  <svg {...base}><path d="M3 8a5 5 0 1 0 1.6-3.7" /><path d="M3 2.8v2.6h2.6" /></svg>
);
export const SlidersIcon = () => (
  <svg {...base}><path d="M3 4.5h10M3 11.5h10" /><circle cx="6" cy="4.5" r="1.5" fill="currentColor" /><circle cx="10.5" cy="11.5" r="1.5" fill="currentColor" /></svg>
);
export const CloseIcon = () => (
  <svg {...base}><path d="M4 4l8 8M12 4l-8 8" /></svg>
);
