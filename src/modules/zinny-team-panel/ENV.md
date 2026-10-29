# zinny-team-panel environment variables

All optional. They set Zinny's own details as the seller on Zinny's invoices to universities.

| Variable | Default | What it is |
|---|---|---|
| `ZINNY_LEGAL_NAME` | `Zinny Learning Private Limited` | Seller name on Zinny invoices |
| `ZINNY_GSTIN` | not set | Zinny's GSTIN, printed on invoices |
| `ZINNY_STATE_CODE` | `27` | Zinny's GST state code. Same state as the university: CGST + SGST; otherwise IGST |
| `ZINNY_ADDRESS` | `Mumbai, Maharashtra` | Seller address |
| `ZINNY_INVOICE_PREFIX` | `ZNY` | Up to 4 characters; numbers look like `ZNY/26-27/0001` |

The hourly job `zinny-team-panel.licence-alerts` runs through `GET /api/jobs/run?every=hour` (cron, `CRON_SECRET`).
