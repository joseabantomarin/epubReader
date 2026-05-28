import { createContext, useContext, useState, useCallback } from 'react';
import { getToken, getUser, setToken, setUser, clearAuth, api } from '../lib/api.js';

const AuthCtx = createContext(null);

export function AuthProvider({ children }) {
  const [token, setTokenState] = useState(() => getToken());
  const [user, setUserState] = useState(() => getUser());

  const loginWithGoogle = useCallback(async (credential) => {
    const { token, user } = await api.loginGoogle(credential);
    setToken(token);
    setUser(user);
    setTokenState(token);
    setUserState(user);
    return user;
  }, []);

  const logout = useCallback(() => {
    clearAuth();
    setTokenState(null);
    setUserState(null);
  }, []);

  return (
    <AuthCtx.Provider value={{ token, user, loginWithGoogle, logout }}>
      {children}
    </AuthCtx.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
