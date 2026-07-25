// Same-origin by default (dashboard is served by the same Express backend);
// override with VITE_API_URL if the dashboard is ever hosted separately.
const BASE_URL = import.meta.env.VITE_API_URL || '';
const TOKEN_KEY = 'whatsapp_flow_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token) {
  localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken() {
  localStorage.removeItem(TOKEN_KEY);
}

async function request(path, options = {}) {
  const token = getToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.json();
}

export function login(email, password) {
  return request('/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
}

export function getRecipients() {
  return request('/api/recipients');
}

export function getRecipientStats(id, days) {
  return request(`/api/recipients/${id}/stats?days=${days}`);
}
