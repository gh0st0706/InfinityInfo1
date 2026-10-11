# Deploying InfinityInfo

The frontend and API live in one Git repository, but deploy as separate services. Vercel serves the static site; Render runs FastAPI.

## Vercel frontend

1. Import the GitHub repository into Vercel.
2. Set **Root Directory** to `infinityinfo`.
3. Leave the build command empty and set **Output Directory** to `.`. The site is plain HTML, CSS, and JavaScript, so it needs no build step.
4. Deploy and note the Vercel origin, such as `https://your-project.vercel.app`.

## Render API

1. In Render, create a Blueprint from the same repository. Select the repository-root `render.yaml` file.
2. Set `HUNTER_API_KEY` to the API key used by the backend.
3. Set `CORS_ALLOWED_ORIGINS` to the Vercel origin, without a trailing slash. Add any custom Vercel domain as another comma-separated origin.
4. Deploy the `infinityinfo-api` web service and copy its public URL, such as `https://infinityinfo-api.onrender.com`.

The Blueprint sets the backend root directory to `infinityinfo/backend`, installs `requirements.txt`, starts Uvicorn on Render's assigned port, and uses `/` as its health check.

## Connect the frontend to Render

In `assets/js/deployment-config.js`, replace the local URL with the Render URL:

```js
window.INFINITYINFO_API_URL = "https://infinityinfo-api.onrender.com";
```

Commit and push that change. Vercel will redeploy the frontend. The backend's CORS allowlist must include the exact Vercel origin, including `https://` and excluding any path or trailing slash.

For local development, the default CORS allowlist accepts `http://localhost:5500`, `http://127.0.0.1:5500`, and pages opened directly from disk (`null` origin). Add another local origin to `CORS_ALLOWED_ORIGINS` if your development server uses a different port.
