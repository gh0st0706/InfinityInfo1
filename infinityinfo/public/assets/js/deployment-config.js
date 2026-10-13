// Use the local FastAPI server during development and Vercel routes in production.
const localHosts = new Set(["localhost", "127.0.0.1"]);
window.INFINITYINFO_API_URL = localHosts.has(window.location.hostname)
  ? "http://127.0.0.1:8000"
  : "/api";
