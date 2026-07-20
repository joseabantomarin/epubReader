import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

// Diagnóstico de selección (SEL-DBG): visitar la app con ?seldbg=1 lo
// enciende (persistido en localStorage) y ?seldbg=0 lo apaga. El panel lo
// pinta ReaderPage solo cuando el flag está activo.
try {
  const dbg = new URLSearchParams(window.location.search).get('seldbg');
  if (dbg === '1') localStorage.setItem('epubreader.seldbg', '1');
  else if (dbg === '0') localStorage.removeItem('epubreader.seldbg');
} catch { /* ignore */ }

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
