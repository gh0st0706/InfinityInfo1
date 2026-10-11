# Deploying InfinityInfo

The Vercel project serves the static site from `public/` and runs the FastAPI app from `backend/main.py`. The Vercel project root is the `infinityinfo` directory in this repository.

## Configure the API key

Before using email enrichment, add `HUNTER_API_KEY` to the Vercel project under **Settings → Environment Variables**. Set it for Production and Preview, then redeploy so Functions receive the value. Keep the variable encrypted and do not commit it to the repository.

## Upload limits

CSV, XLSX, and XLS uploads are limited to 4 MB and 1,000 rows. Vercel Function request and response bodies are limited to 4.5 MB, so the app keeps the file limit below that platform cap.

## Local development

Install dependencies from `requirements.txt`, set `HUNTER_API_KEY` in the local environment or `backend/.env`, and run the API with Uvicorn. The default CORS allowlist accepts `http://localhost:5500`, `http://127.0.0.1:5500`, and pages opened directly from disk (`null` origin). Add other development origins to `CORS_ALLOWED_ORIGINS` if needed.
