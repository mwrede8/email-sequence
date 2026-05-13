# email-sequence

Compose an email sequence. Run it over a CSV. Get one Gmail draft per prospect per step, ready for an Apps Script sender to release on schedule.

## Layout

```
app/
  sequences/        Tab 1 — sequence builder (subject / body / mode / delay / gif token)
  campaigns/        Tab 2 — pick a sequence, upload CSV, download manifest
lib/                Shared types + localStorage helpers
worker/             Python: manifest.json → labeled Gmail drafts
apps-script/        Cron sender: promotes due drafts → sent
```

## Loop

1. **Build a sequence** at `/sequences`. Use `{{variable}}` tokens for any per-prospect field. Click *Insert gif placeholder* to drop `[[gif:{{gif_url}}]]` at the cursor — this turns `gif_url` into a required CSV column. Apps Script fetches each row's URL and CID-inlines it on send.
2. **Start a campaign** at `/campaigns`. Pick the sequence, upload a CSV with one column per `{{var}}` plus an `email` column, pick a start date, **Download manifest.json**.
3. **Click "Create drafts in Gmail"** — the campaign page POSTs the manifest to `/api/drafts/run`, which auto-creates `worker/.venv` on first call, installs dependencies, and spawns the worker. Output streams back live. Or click **Dry run** to preview without touching Gmail. The button is hidden on the Vercel-hosted deploy because Gmail OAuth needs your local token; run `npm run dev` locally to use it.

   (Equivalent CLI: `python worker/draft_writer.py manifest.json`.)
4. **Apps Script sender** ticks every 5–15 min, finds drafts whose `send-after-…` time has passed, CID-inlines the gif for `[[gif_token]]`, threads replies, and sends.

## Variables / CSV

If your sequence body says

```
Hi {{first_name}}, working with {{customer_team}} at {{customer}} on {{use_case_1}} and {{use_case_2}}…
```

your CSV needs these columns:

```
email,first_name,customer_team,customer,use_case_1,use_case_2
```

Missing-column detection happens at upload time. Missing per-row values are left as `{{name}}` literals so they're easy to spot in the preview before you draft.

## Local dev

```bash
npm install
npm run dev
# → http://localhost:3000
```

## Why not just generate drafts from the web app?

Gmail OAuth in a Vercel serverless function needs a refresh token + scope-approved app, and any third-party OAuth flow on a personal Gmail eventually pages someone on Trust & Safety. The Python worker runs on your laptop with your own credentials and never leaves your machine.

## See also

- [worker/README.md](worker/README.md) — Gmail OAuth, label scheme, `--dry-run` flag.
- [apps-script/README.md](apps-script/README.md) — install, gif URLs, trigger setup.
