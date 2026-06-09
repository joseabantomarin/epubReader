import { Maximize2, Minimize2 } from 'lucide-react';

export default function FullscreenButton({ isFullscreen, onToggle, className, hint }) {
  const label = isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa';
  const title = hint ? `${label} (${hint})` : label;
  return (
    <button className={className} onClick={onToggle} aria-label={label} title={title}>
      {isFullscreen ? <Minimize2 size={16} strokeWidth={2.5} /> : <Maximize2 size={16} strokeWidth={2.5} />}
    </button>
  );
}
