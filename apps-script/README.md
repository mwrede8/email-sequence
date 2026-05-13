# apps-script/

The continuous sender. Reads the labels the Python worker stamps onto drafts, sends what's due, and deletes drafts the recipient no longer needs.

## What it does each tick

1. Finds every label named `<prefix>/step-<N>/send-after-<YYYY-MM-DDTHH-MM>` whose timestamp has passed.
2. For each due draft on that label:
   - **New-thread step** → sends as a fresh email, swaps in a random CID-inlined gif for `[[gif_token]]`, deletes the draft, labels the sent thread.
   - **Reply step** → finds the parent step's sent thread, replies on it, deletes the standalone draft.
3. Walks every `<prefix>/to/<email>` label: if that prospect replied to *anything* under this prefix, every pending draft to that prospect gets deleted. They never hear from you again on this sequence.

## Setup (3 minutes, once)

1. https://script.google.com → **New project**, name it `email-sequencer`.
2. **Settings** → toggle **Show "appsscript.json" manifest file in editor**.
3. Replace the editor contents with the matching files in this folder:
   - `appsscript.json` (scopes — paste over the existing manifest)
   - `sender.gs` (logic — rename `Code.gs` if you like)
4. (Optional) Edit the config block at the top of `sender.gs`:
   ```js
   const TRIGGER_MINUTES = 5;     // cadence
   const SIGNATURE       = "";    // appended before send
   ```
   Gif URLs are now per-prospect: every body token looks like
   `[[gif:<url>]]` (the worker bakes `{{gif_url}}` from your CSV into that
   shape). Sender fetches the URL on send and CID-inlines it. Empty URL
   or failed fetch → the token is silently dropped.
5. From the Apps Script editor, select **`installTrigger`** in the function dropdown and click **Run**. Approve the scopes prompt. Done — a 5-minute time-driven trigger is now installed.

## Day-to-day

- **`tick`** — what the trigger calls. You shouldn't need to run it manually.
- **`status`** — log dump: what's due right now, and which pending drafts will be cleaned because the prospect replied. Run this any time to peek without touching anything.
- **`uninstallTrigger`** — pauses the loop. Run again to re-arm with `installTrigger`.

## Label scheme the worker writes

```
seq/<sequence-id>/step-<N>/send-after-<YYYY-MM-DDTHH-MM>   ← pending
seq/<sequence-id>/step-<N>/sent-at-<YYYY-MM-DDTHH-MM>      ← after send (added by this script)
seq/<sequence-id>/step-<N>                                  ← step marker
seq/<sequence-id>/to/<email>                                ← recipient grouping
seq/<sequence-id>/mode-<new|reply>
seq/<sequence-id>/reply-to-step-<M>                         ← reply steps only
```

Change `LABEL_ROOT` at the top of `sender.gs` if you want to use something other than `seq` (must match the `labelPrefix` you set per sequence in the web UI).
