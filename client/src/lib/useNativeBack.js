import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';

// Android back button: in /read/:id go back to library; on / minimize app
// instead of leaving the WebView in a broken state.
export function useNativeBack() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handler;
    (async () => {
      handler = await CapacitorApp.addListener('backButton', () => {
        if (location.pathname.startsWith('/read/')) navigate('/');
        else CapacitorApp.minimizeApp();
      });
    })();
    return () => { handler?.remove(); };
  }, [location.pathname, navigate]);
}
