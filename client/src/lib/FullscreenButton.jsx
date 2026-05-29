export default function FullscreenButton({ isFullscreen, onToggle, className, hint }) {
  const label = isFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa';
  const title = hint ? `${label} (${hint})` : label;
  return (
    <button className={className} onClick={onToggle} aria-label={label} title={title}>
      {isFullscreen ? (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M9 3v6H3M21 9h-6V3M3 15h6v6M15 21v-6h6"/>
        </svg>
      ) : (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M3 9V3h6M21 9V3h-6M3 15v6h6M21 15v6h-6"/>
        </svg>
      )}
    </button>
  );
}
