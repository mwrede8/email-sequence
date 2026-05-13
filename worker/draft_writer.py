"""Render a campaign manifest into Gmail drafts.

Reads manifest.json (produced by the email-sequencer web UI) and creates one
Gmail draft per (recipient, step). Each draft is labeled

    <labelPrefix>/step-<N>/send-after-<YYYY-MM-DDTHH:MM>
    <labelPrefix>/to/<email>

so the Apps Script sender can find drafts that are due and thread replies
correctly.

First run will pop a browser for OAuth and save token.json next to this script.

Usage:
    python worker/draft_writer.py path/to/manifest.json
    python worker/draft_writer.py path/to/manifest.json --dry-run
"""
from __future__ import annotations

import argparse
import base64
import json
import os
import sys
from email.mime.text import MIMEText
from pathlib import Path
from typing import Any

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = [
    "https://www.googleapis.com/auth/gmail.compose",
    "https://www.googleapis.com/auth/gmail.labels",
    "https://www.googleapis.com/auth/gmail.modify",
]
HERE = Path(__file__).resolve().parent


def get_service():
    creds: Credentials | None = None
    token_path = HERE / "token.json"
    creds_path = HERE / "credentials.json"
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not creds_path.exists():
                sys.exit(
                    f"Missing {creds_path}. Download an OAuth client ID "
                    "(Desktop app) from console.cloud.google.com and save it here."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(creds_path), SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json())
    return build("gmail", "v1", credentials=creds, cache_discovery=False)


def ensure_label(service, name: str, cache: dict[str, str]) -> str:
    if name in cache:
        return cache[name]
    labels = service.users().labels().list(userId="me").execute().get("labels", [])
    by_name = {lbl["name"]: lbl["id"] for lbl in labels}
    if name in by_name:
        cache[name] = by_name[name]
        return by_name[name]
    body = {"name": name, "labelListVisibility": "labelShow", "messageListVisibility": "show"}
    created = service.users().labels().create(userId="me", body=body).execute()
    cache[name] = created["id"]
    return created["id"]


def build_message(to: str, subject: str, body: str) -> dict[str, Any]:
    msg = MIMEText(body, "plain", "utf-8")
    msg["to"] = to
    msg["subject"] = subject
    raw = base64.urlsafe_b64encode(msg.as_bytes()).decode("utf-8")
    return {"raw": raw}


def slug_iso(iso: str) -> str:
    # e.g. 2026-05-20T13:00:00.000Z -> 2026-05-20T13-00
    s = iso.split(".")[0].split("+")[0].rstrip("Z")
    if len(s) >= 16:
        return s[:13] + "-" + s[14:16]
    return s.replace(":", "-")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("manifest", help="path to manifest.json")
    ap.add_argument(
        "--dry-run",
        action="store_true",
        help="print what would be created without touching Gmail",
    )
    args = ap.parse_args()

    manifest = json.loads(Path(args.manifest).read_text())
    label_prefix = manifest["labelPrefix"].rstrip("/")
    drafts = manifest["drafts"]
    seq_name = manifest.get("sequenceName", "?")

    print(f"Sequence: {seq_name}")
    print(f"Label prefix: {label_prefix}")
    print(f"Drafts to create: {len(drafts)}")

    if args.dry_run:
        for d in drafts[:5]:
            print(
                f"  → step {d['step']} {d['mode']} to {d['to']} "
                f"after {d['sendAfter']}: {d['subject'][:50]!r}"
            )
        if len(drafts) > 5:
            print(f"  … and {len(drafts) - 5} more")
        return

    service = get_service()
    label_cache: dict[str, str] = {}

    created = 0
    errors = 0
    for d in drafts:
        try:
            message = build_message(
                to=d["to"],
                # Reply steps inherit subject from the parent — the Apps Script
                # sender prefixes "Re:" on send. Until then we keep the rendered
                # subject (or fall back to the step number) so the draft is
                # findable in the UI.
                subject=d["subject"] or f"(reply step {d['step']})",
                body=d["body"],
            )
            draft = (
                service.users()
                .drafts()
                .create(userId="me", body={"message": message})
                .execute()
            )
            msg_id = draft["message"]["id"]

            wanted_labels = [
                f"{label_prefix}/step-{d['step']}/send-after-{slug_iso(d['sendAfter'])}",
                f"{label_prefix}/to/{d['to']}",
                f"{label_prefix}/mode-{d['mode']}",
            ]
            if d["mode"] == "reply" and d.get("replyToStep"):
                wanted_labels.append(
                    f"{label_prefix}/reply-to-step-{d['replyToStep']}"
                )

            label_ids = [ensure_label(service, n, label_cache) for n in wanted_labels]
            service.users().messages().modify(
                userId="me",
                id=msg_id,
                body={"addLabelIds": label_ids},
            ).execute()
            created += 1
            print(f"  ✓ step {d['step']} → {d['to']} ({d['mode']})")
        except HttpError as e:
            errors += 1
            print(f"  ✗ {d['to']} step {d['step']}: {e}", file=sys.stderr)

    print(f"\nCreated {created} drafts. {errors} errors.")
    if errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
