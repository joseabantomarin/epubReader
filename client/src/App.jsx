import { useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { AuthProvider } from './auth/AuthContext.jsx';
import LibraryPage from './library/LibraryPage.jsx';
import ReaderPage from './reader/ReaderPage.jsx';
import { useNativeBack } from './lib/useNativeBack.js';
import { useSyncQueue } from './lib/useSyncQueue.js';

function Routed() {
  useNativeBack();
  useSyncQueue();
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
