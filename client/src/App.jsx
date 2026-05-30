import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { AuthProvider } from './auth/AuthContext.jsx';
import LibraryPage from './library/LibraryPage.jsx';
import ReaderPage from './reader/ReaderPage.jsx';
import { useNativeBack } from './lib/useNativeBack.js';
import { useSyncQueue } from './lib/useSyncQueue.js';

const READER_PATH_KEY = 'epubreader.readerPath';

function Routed() {
  useNativeBack();
  useSyncQueue();
  const navigate = useNavigate();

  // Android may reload the WebView when the screen is off / app is
  // backgrounded, which resets the SPA to '/'. If we were in a book recently,
  // restore that route so the reader reopens at the saved position.
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    if (window.location.pathname !== '/') return;
    try {
      const raw = localStorage.getItem(READER_PATH_KEY);
      if (!raw) return;
      const { path, t } = JSON.parse(raw);
      if (path && path.startsWith('/read/') && Date.now() - t < 60 * 60 * 1000) {
        navigate(path, { replace: true });
      }
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
