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

export function mapMedicalConditions(freeText) {
  return request('/api/onboarding/map-conditions', {
    method: 'POST',
    body: JSON.stringify({ freeText }),
  });
}

export function createRecipient(data) {
  return request('/api/onboarding/create-recipient', {
    method: 'POST',
    body: JSON.stringify(data),
  });
}

export function generatePlan(recipientId) {
  return request(`/api/onboarding/generate-plan/${recipientId}`, { method: 'POST' });
}

export function swapExercise(rotationId, dayOffset, exerciseIndex, newExerciseId) {
  return request(`/api/onboarding/plan/${rotationId}/swap`, {
    method: 'PUT',
    body: JSON.stringify({ dayOffset, exerciseIndex, newExerciseId }),
  });
}

export function approvePlan(rotationId) {
  return request(`/api/onboarding/plan/${rotationId}/approve`, { method: 'POST' });
}

export function sendTestMessage(recipientId) {
  return request(`/api/onboarding/send-test/${recipientId}`, { method: 'POST' });
}

export function getFilteredCatalog(recipientId) {
  return request(`/api/onboarding/catalog/filtered/${recipientId}`);
}

export function getRotation(recipientId) {
  return request(`/api/onboarding/recipients/${recipientId}/rotation`);
}

export function exerciseGifUrl(catalogId) {
  return `${BASE_URL}/media/exercise-gif/${catalogId}`;
}
