const BASE = import.meta.env.VITE_API_BASE || '';
const TOKEN_KEY = 'epubreader.token';
const USER_KEY = 'epubreader.user';

export function getToken() { return localStorage.getItem(TOKEN_KEY); }
export function setToken(t) { localStorage.setItem(TOKEN_KEY, t); }
export function getUser() {
  const raw = localStorage.getItem(USER_KEY);
  return raw ? JSON.parse(raw) : null;
}
export function setUser(u) { localStorage.setItem(USER_KEY, JSON.stringify(u)); }
export function clearAuth() {
  localStorage.removeItem(TOKEN_KEY);
  localStorage.removeItem(USER_KEY);
}

async function call(path, { method = 'GET', body, formData, headers = {} } = {}) {
  const token = getToken();
  const finalHeaders = { ...headers };
  if (token) finalHeaders.Authorization = `Bearer ${token}`;
  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    finalHeaders['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }
  const res = await fetch(BASE + path, { method, headers: finalHeaders, body: payload });
  if (res.status === 401) {
    clearAuth();
    if (location.pathname !== '/login') location.assign('/login');
    throw new Error('unauthorized');
  }
  if (!res.ok) {
    let err = { error: 'request_failed', status: res.status };
    try { err = await res.json(); } catch {}
    throw Object.assign(new Error(err.error || 'request_failed'), { status: res.status, body: err });
  }
  if (res.status === 204) return null;
  const ct = res.headers.get('content-type') || '';
  if (ct.includes('application/json')) return res.json();
  return res;
}

export const api = {
  loginGoogle: (credential) => call('/api/auth/google', { method: 'POST', body: { credential } }),
  listBooks: () => call('/api/books'),
  uploadBook: (file) => {
    const fd = new FormData();
    fd.append('file', file);
    return call('/api/books', { method: 'POST', formData: fd });
  },
  deleteBooks: (ids) => call('/api/books', { method: 'DELETE', body: { ids } }),
  getProgress: (bookId) => call(`/api/books/${bookId}/progress`),
  putProgress: (bookId, cfi, percentage) =>
    call(`/api/books/${bookId}/progress`, { method: 'PUT', body: { cfi, percentage } }),
};

export function bookFileUrl(bookId) {
  return `${BASE}/api/books/${bookId}/file`;
}
export function bookCoverUrl(bookId) {
  return `${BASE}/api/books/${bookId}/cover`;
}
