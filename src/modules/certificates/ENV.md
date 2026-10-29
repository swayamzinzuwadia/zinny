# certificates: environment variables

| Variable | Needed | What it does |
|---|---|---|
| `CERTIFICATE_VERIFY_BASE_URL` | **Production: yes.** Dev: no. | The public address of the app, for example `https://app.zinny.in`. Every certificate PDF prints a QR code and a link to `<this>/verify/<code>`, and a PDF never changes after it is issued, so set this before the first certificate is issued. In production, issuing refuses to run without it (the event handler fails and retries until it is set). In development, and in demo runs of a production build (`ZINNY_DEMO=1`), it defaults to `http://localhost:$PORT`. |

Certificates also use the core storage settings (`STORAGE_DRIVER`, `STORAGE_DIR`, `S3_*`, `STORAGE_SIGNING_SECRET`; see `docs/plan/contracts.md` section 7) for the PDFs and signature images. Nothing else is needed.

## Files the server must ship

The PDF fonts are read at run time from two npm packages:

- `node_modules/@expo-google-fonts/lexend/{300Light,400Regular,600SemiBold}/*.ttf`
- `node_modules/@expo-google-fonts/libre-baskerville/{400Regular,400Regular_Italic,700Bold}/*.ttf`

The paths are written literally from `process.cwd()` in `render/fonts.ts`, which Next's output file tracing follows. If a deployment ever reports a missing `.ttf`, add those globs to `outputFileTracingIncludes` in `next.config.ts`.
