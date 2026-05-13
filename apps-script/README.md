# apps-script/

Cron-driven sender. Promotes labeled drafts → sent on the schedule the worker baked into label names.

## Install

1. https://script.google.com → **New project**.
2. Project settings → **Show "appsscript.json" manifest file in editor**.
3. Replace the editor contents with the matching files in this folder:
   - `appsscript.json` (scopes)
   - `sender.gs` (logic)
4. **Triggers** (clock icon) → add trigger:
   - Function: `tick`
   - Event source: Time-driven
   - Type of time-based trigger: **Minutes timer**
   - Every **5 minutes** (or 15 — whichever cadence you want).
5. Run `tick` once manually to grant scopes.

## Editing config

Open `sender.gs`. The top of the file has `LABEL_ROOTS`, `GIF_URLS`, and
`SIGNATURE`. Add gif URLs you want inlined whenever a draft contains
`[[gif_token]]`. They get fetched via `UrlFetchApp`, so they must be
publicly reachable.

## Label scheme expected from the worker

```
seq/<sequence-id>/step-<N>/send-after-<YYYY-MM-DDTHH-MM>
seq/<sequence-id>/to/<email>
seq/<sequence-id>/mode-<new|reply>
seq/<sequence-id>/reply-to-step-<M>   (only when mode=reply)
```

After a send, the `send-after-*` label is replaced with
`seq/<sequence-id>/step-<N>/sent-at-<YYYY-MM-DDTHH-MM>`.
