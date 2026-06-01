import { describe, it, expect, beforeEach } from 'vitest';
import { DEFAULTS, loadSettings, saveSettings } from './readerSettings.js';

describe('readerSettings pageTransition', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults pageTransition to fade', () => {
    expect(DEFAULTS.pageTransition).toBe('fade');
    expect(loadSettings().pageTransition).toBe('fade');
  });

  it('persists and reloads pageTransition', () => {
    saveSettings({ ...DEFAULTS, pageTransition: 'slide' });
    expect(loadSettings().pageTransition).toBe('slide');
  });

  it('fills pageTransition default when missing from stored JSON', () => {
    localStorage.setItem('epubreader.readerSettings', JSON.stringify({ theme: 'dark' }));
    const s = loadSettings();
    expect(s.theme).toBe('dark');
    expect(s.pageTransition).toBe('fade');
  });
});
