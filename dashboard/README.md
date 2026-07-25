# Caregiver Dashboard

React (Vite) frontend for the WhatsApp Flow caregiver dashboard. See the [repo root README](../README.md) for the full project overview.

In production this is built and served as static files by the backend Express service (same origin, no separate hosting needed - see `backend/src/app.js` and the `build` script in `backend/package.json`).

## Local development

```bash
npm install
npm run dev
```

Requires the backend running on `http://localhost:3000` (see `vite.config.js` for the dev proxy).
