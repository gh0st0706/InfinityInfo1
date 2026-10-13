# Phone checker UI bundle

This React UI is mounted inside the main site's `#phone-checker` section. It is built as a browser bundle and written to `public/assets/phone-checker/`.

From this directory, run:

```sh
npm install
npm run build
```

The main site's FastAPI backend provides `/api/health`, `/api/validate`, and `/api/validate/bulk`. Number format and number type use the Python `phonenumbers` metadata package. Carrier and line-type enrichment is optional and requires `TWILIO_API_KEY` and `TWILIO_API_SECRET` on the server.
