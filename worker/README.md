# worker/

CSV → Gmail drafts step of the pipeline.

```bash
cd worker
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

# One-time: download an OAuth client ID (Desktop app) from
# https://console.cloud.google.com → APIs & Services → Credentials.
# Enable the Gmail API on the project. Save the JSON as worker/credentials.json.

# Then, for each campaign:
python draft_writer.py /path/to/manifest.json
# or to inspect:
python draft_writer.py /path/to/manifest.json --dry-run
```

First run pops a browser to authorize. Token is cached in `token.json` next to the script.

## Label scheme

For each draft the worker creates these labels:

- `<prefix>/step-<N>/send-after-<YYYY-MM-DDTHH-MM>` — sender uses this to decide what's due.
- `<prefix>/to/<email>` — convenient grouping per recipient.
- `<prefix>/mode-<new|reply>` — sender uses this to choose threading behavior.
- `<prefix>/reply-to-step-<M>` — when mode is reply, points at the parent step.

The Apps Script sender (`apps-script/sender.gs`) reads these on a cron tick.
