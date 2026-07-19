import { registerBackHandler, tryBackHandlers } from './backActions.js';

describe('backActions', () => {
  it('sin handlers devuelve false', () => {
    expect(tryBackHandlers()).toBe(false);
  });

  it('un handler que devuelve true marca el evento como manejado', () => {
    const un = registerBackHandler(() => true);
    expect(tryBackHandlers()).toBe(true);
    un();
  });

  it('handlers que devuelven false no manejan el evento', () => {
    const un = registerBackHandler(() => false);
    expect(tryBackHandlers()).toBe(false);
    un();
  });

  it('al desregistrar, el handler deja de consultarse', () => {
    const fn = vi.fn(() => true);
    const un = registerBackHandler(fn);
    un();
    expect(tryBackHandlers()).toBe(false);
    expect(fn).not.toHaveBeenCalled();
  });

  it('el primer handler que devuelve true detiene la cadena', () => {
    const second = vi.fn(() => true);
    const un1 = registerBackHandler(() => true);
    const un2 = registerBackHandler(second);
    expect(tryBackHandlers()).toBe(true);
    expect(second).not.toHaveBeenCalled();
    un1(); un2();
  });

  it('un handler que lanza no bloquea a los demás', () => {
    const un1 = registerBackHandler(() => { throw new Error('x'); });
    const un2 = registerBackHandler(() => true);
    expect(tryBackHandlers()).toBe(true);
    un1(); un2();
  });
});
