# privacy: environment variables

| Variable | Needed | What it does |
| --- | --- | --- |
| `PRIVACY_IP_SALT` | Production | Secret salt for the scrambled IP address stored with each consent (SHA-256). Any long random string, e.g. `openssl rand -hex 32`. Without it a fixed development salt is used. Don't change it once consents are recorded, or old and new hashes stop matching. |
| `PRIVACY_GRIEVANCE_NAME` | Production | The grievance officer's name shown on `/privacy#grievance` (Act s.8(10), Rule 9). Default: "Grievance Officer, Zinny". |
| `PRIVACY_GRIEVANCE_EMAIL` | Production | The grievance officer's email. Default: `grievance@zinny.in`. |
| `PRIVACY_GRIEVANCE_PHONE` | Optional | A phone number for the grievance officer, shown when set. |
| `PRIVACY_GRIEVANCE_ADDRESS` | Optional | A postal address for the grievance officer, shown when set. |

`ZINNY_LEGAL_NAME` (zinny-team-panel) names the Data Fiduciary on the notice. Guardian consent links use `APP_URL` (identity) for their address.
