# onboarding: environment variables

| Variable | Needed | What it does |
| --- | --- | --- |
| `KYC_ENCRYPTION_KEY` | Production | 32-byte key that encrypts students' PAN numbers (AES-256-GCM). Give it as 64 hex characters or 44 base64 characters, e.g. `openssl rand -hex 32`. Without it, development and tests use a fixed built-in key; production (unless `ZINNY_DEMO=1`) refuses to save or read a PAN. Keep it secret and never change it once PANs are stored: values encrypted with the old key can no longer be read. |

Plan payments use the core payment gateway (`gateway()`): with the mock gateway they run in test mode in development and demo deployments (`ZINNY_DEMO=1`), the same rule as student checkouts. Documents are stored through core `storage()` (`STORAGE_DRIVER`, see core docs).
