import { renderHook, waitFor } from '@testing-library/react';
import { useNativeBack } from './useNativeBack.js';
import { registerBackHandler } from './backActions.js';

const h = vi.hoisted(() => ({
  navigateMock: vi.fn(),
  minimizeApp: vi.fn(),
  listeners: {},
}));

vi.mock('react-router-dom', () => ({
  useNavigate: () => h.navigateMock,
  useLocation: () => ({ pathname: '/read/42' }),
}));
vi.mock('@capacitor/core', () => ({ Capacitor: { isNativePlatform: () => true } }));
vi.mock('@capacitor/app', () => ({
  App: {
    addListener: async (event, cb) => { h.listeners[event] = cb; return { remove: () => {} }; },
    minimizeApp: h.minimizeApp,
  },
}));

describe('useNativeBack', () => {
  beforeEach(() => {
    h.navigateMock.mockClear();
    h.minimizeApp.mockClear();
    delete h.listeners.backButton;
  });

  it('sin handlers registrados, en /read/ navega a la biblioteca', async () => {
    renderHook(() => useNativeBack());
    await waitFor(() => expect(h.listeners.backButton).toBeTypeOf('function'));
    h.listeners.backButton();
    expect(h.navigateMock).toHaveBeenCalledWith('/');
  });

  it('un handler que devuelve true corta el comportamiento por defecto', async () => {
    const unregister = registerBackHandler(() => true);
    renderHook(() => useNativeBack());
    await waitFor(() => expect(h.listeners.backButton).toBeTypeOf('function'));
    h.listeners.backButton();
    expect(h.navigateMock).not.toHaveBeenCalled();
    expect(h.minimizeApp).not.toHaveBeenCalled();
    unregister();
  });
});
