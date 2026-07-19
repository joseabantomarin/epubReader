import { useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { App as CapacitorApp } from '@capacitor/app';
import { tryBackHandlers } from './backActions.js';

// Android back button: in /read/:id go back to library; on / minimize app
// instead of leaving the WebView in a broken state. Screens can override the
// default by registering a handler in backActions (e.g. undo an in-book jump).
export function useNativeBack() {
  const navigate = useNavigate();
  const location = useLocation();
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return;
    let handler;
    (async () => {
      handler = await CapacitorApp.addListener('backButton', () => {
        if (tryBackHandlers()) return;
        if (location.pathname.startsWith('/read/')) navigate('/');
        else CapacitorApp.minimizeApp();
      });
    })();
    return () => { handler?.remove(); };
  }, [location.pathname, navigate]);
}
