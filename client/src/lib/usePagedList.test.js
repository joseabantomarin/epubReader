import { renderHook, act } from '@testing-library/react';
import { usePagedList, usePageSize } from './usePagedList.js';

const LIST = Array.from({ length: 25 }, (_, i) => i + 1);

describe('usePagedList', () => {
  it('recorta la primera página', () => {
    const { result } = renderHook(() => usePagedList(LIST, 10));
    expect(result.current.page).toBe(1);
    expect(result.current.pageCount).toBe(3);
    expect(result.current.paged).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  });

  it('cambia de página con setPage', () => {
    const { result } = renderHook(() => usePagedList(LIST, 10));
    act(() => result.current.setPage(3));
    expect(result.current.page).toBe(3);
    expect(result.current.paged).toEqual([21, 22, 23, 24, 25]);
  });

  it('lista vacía: una página vacía', () => {
    const { result } = renderHook(() => usePagedList([], 10));
    expect(result.current.pageCount).toBe(1);
    expect(result.current.paged).toEqual([]);
  });

  it('clampa la página cuando la lista mengua', () => {
    const { result, rerender } = renderHook(({ list }) => usePagedList(list, 10), {
      initialProps: { list: LIST },
    });
    act(() => result.current.setPage(3));
    rerender({ list: LIST.slice(0, 12) });
    expect(result.current.page).toBe(2);
    expect(result.current.paged).toEqual([11, 12]);
  });
});

describe('usePageSize', () => {
  it('10 bajo 640px, 20 en adelante, reactivo a resize', () => {
    window.innerWidth = 500;
    const { result } = renderHook(() => usePageSize());
    expect(result.current).toBe(10);
    act(() => {
      window.innerWidth = 1024;
      window.dispatchEvent(new Event('resize'));
    });
    expect(result.current).toBe(20);
  });
});
