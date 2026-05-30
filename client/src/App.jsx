import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { AuthProvider } from './auth/AuthContext.jsx';
import LibraryPage from './library/LibraryPage.jsx';
import ReaderPage from './reader/ReaderPage.jsx';
import { useNativeBack } from './lib/useNativeBack.js';
import { useSyncQueue } from './lib/useSyncQueue.js';

const READER_PATH_KEY = 'epubreader.readerPath';
const RESTORE_AT_KEY = 'epubreader.restoreAt';

function Routed() {
  useNativeBack();
  useSyncQueue();
  const navigate = useNavigate();

  // Android reloads the WebView to '/' when it reclaims the app after the
  // screen is off. Reopen the book we were in (it's cached locally). A short
  // throttle guarantees this can never become a reload/redirect loop.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (window.location.pathname !== '/') return;
    try {
      const raw = localStorage.getItem(READER_PATH_KEY);
      if (!raw) return;
      const { path, t } = JSON.parse(raw);
      if (!path || !path.startsWith('/read/') || Date.now() - t > 60 * 60 * 1000) return;
      const lastAt = Number(localStorage.getItem(RESTORE_AT_KEY) || 0);
      if (Date.now() - lastAt < 8000) return; // anti-loop: at most one restore / 8s
      localStorage.setItem(RESTORE_AT_KEY, String(Date.now()));
      navigate(path, { replace: true });
    } catch {}
  }, [navigate]);

  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    // Push the WebView below the system status bar so content doesn't get
    // hidden under the carrier/clock icons.
    import('@capacitor/status-bar').then(({ StatusBar }) => {
      StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      StatusBar.setBackgroundColor({ color: '#102060' }).catch(() => {});
    });
  }, []);
  return (
    <Routes>
      <Route path="/" element={<LibraryPage />} />
      <Route path="/read/:bookId" element={<ReaderPage />} />
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Routed />
      </BrowserRouter>
    </AuthProvider>
  );
}
