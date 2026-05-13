/**
 * sender.gs — continuously promote email-sequencer drafts, clean up
 * drafts no longer needed.
 *
 * Setup (3 minutes, one time):
 *   1. https://script.google.com → New project, name it "email-sequencer".
 *   2. Settings → toggle "Show 'appsscript.json' manifest in editor".
 *   3. Paste this file as Code.gs and the matching appsscript.json into the editor.
 *   4. Drop a few public gif URLs into GIF_URLS below if you want gif inlining.
 *   5. Run `installTrigger` once from the Apps Script editor (it'll prompt for
 *      scopes). After that, it runs itself every TRIGGER_MINUTES minutes
 *      forever.
 *   6. (Optional) Run `status` any time to see what's pending and what would
 *      be cleaned up on the next tick.
 *
 * What each tick does:
 *   - Promotes drafts whose label `<prefix>/step-N/send-after-<iso>` is due:
 *       · new-thread steps → send a fresh email (CID-inlines gif if present).
 *       · reply steps     → reply on the parent step's sent thread, delete
 *                           the standalone draft.
 *   - Cleans up: if a prospect replied to *any* thread in this sequence,
 *     deletes every still-pending draft for that recipient under the same
 *     prefix. Nothing else should bother them.
 */

// ─── config ─────────────────────────────────────────────────────────────────
const TRIGGER_MINUTES = 5;     // cadence
const LABEL_ROOT      = "seq"; // must match the worker's labelPrefix's first segment
const SIGNATURE       = "";    // appended after the body, before send. Plain text.
const SCAN_LIMIT      = 100;   // max threads pulled per label per tick
// Gif inlining: bodies contain `[[gif:<url>]]` tokens (the worker bakes
// `{{gif_url}}` from your CSV into that shape). The sender fetches each URL,
// inlines as CID, and replaces the token with <img src="cid:..."> on send.
// ────────────────────────────────────────────────────────────────────────────

function installTrigger() {
  uninstallTrigger();
  ScriptApp.newTrigger("tick").timeBased().everyMinutes(TRIGGER_MINUTES).create();
  Logger.log("✓ trigger installed: tick every " + TRIGGER_MINUTES + " minutes");
}

function uninstallTrigger() {
  let n = 0;
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "tick") {
      ScriptApp.deleteTrigger(t);
      n++;
    }
  });
  if (n > 0) Logger.log("removed " + n + " existing tick trigger(s)");
}

function tick() {
  const ctx = newCtx();
  const promoted = promoteDueDrafts(ctx);
  const cleaned  = cleanupRepliedRecipients(ctx);
  Logger.log("tick: promoted=" + promoted + " cleaned=" + cleaned);
}

function status() {
  const ctx  = newCtx();
  const due  = listDueDrafts(ctx);
  const dead = listCleanupCandidates(ctx);
  Logger.log("DUE NOW (" + due.length + "):");
  due.forEach(function (d) { Logger.log("  " + d); });
  Logger.log("CLEANUP CANDIDATES (" + dead.length + "):");
  dead.forEach(function (d) { Logger.log("  " + d); });
}

// ─── tick context: cache expensive calls within one run ─────────────────────
function newCtx() {
  return {
    now: new Date(),
    _drafts: null,
    _labels: null,
    getAllDrafts: function () {
      if (!this._drafts) this._drafts = GmailApp.getDrafts();
      return this._drafts;
    },
    getAllLabels: function () {
      if (!this._labels) this._labels = GmailApp.getUserLabels();
      return this._labels;
    },
    findDraftOnThread: function (threadId) {
      const drafts = this.getAllDrafts();
      for (let i = 0; i < drafts.length; i++) {
        if (drafts[i].getMessage().getThread().getId() === threadId) return drafts[i];
      }
      return null;
    },
    forgetDrafts: function () { this._drafts = null; },
  };
}

function rootLabelOk(name) {
  return name === LABEL_ROOT || name.indexOf(LABEL_ROOT + "/") === 0;
}

// ─── promote ────────────────────────────────────────────────────────────────
function promoteDueDrafts(ctx) {
  const sendAfterRe = /^(.+?)\/step-(\d+)\/send-after-(.+)$/;
  const labels = ctx.getAllLabels().filter(function (l) {
    return rootLabelOk(l.getName()) && sendAfterRe.test(l.getName());
  });

  let count = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const m = label.getName().match(sendAfterRe);
    const prefix = m[1];
    const stepNum = parseInt(m[2], 10);
    const due = parseSlugIso(m[3]);
    if (!due || due > ctx.now) continue;

    const threads = label.getThreads(0, SCAN_LIMIT);
    for (let j = 0; j < threads.length; j++) {
      try {
        if (promoteThread(ctx, threads[j], prefix, stepNum, label)) count++;
      } catch (e) {
        Logger.log("promote error: " + e + "\n" + (e.stack || ""));
      }
    }
  }
  return count;
}

function promoteThread(ctx, thread, prefix, stepNum, dueLabel) {
  const draft = ctx.findDraftOnThread(thread.getId());
  if (!draft) return false;
  const draftMsg = draft.getMessage();

  const to = draftMsg.getTo() || labelLookup(thread, prefix, "/to/");
  if (!to) {
    Logger.log("no recipient on thread " + thread.getId() + " — skipping");
    return false;
  }

  // If the recipient already replied to anything in this prefix, drop this
  // draft and move on (handled more thoroughly by cleanup, but cheap to check).
  if (recipientReplied(prefix, to)) {
    Logger.log("skip step " + stepNum + " to " + to + " — already replied");
    draft.deleteDraft();
    thread.removeLabel(dueLabel);
    ctx.forgetDrafts();
    return false;
  }

  const isReply = thread.getLabels().some(function (l) {
    return l.getName() === prefix + "/mode-reply";
  });

  let body = draftMsg.getPlainBody();
  if (SIGNATURE) body = body + "\n\n" + SIGNATURE;

  const built = buildHtmlWithGif(body);

  if (isReply) {
    const parentStep = readReplyTargetStep(thread, prefix);
    const parent = findParentSentThread(prefix, to, parentStep);
    if (!parent) {
      Logger.log("reply step " + stepNum + " to " + to + " — parent step " + parentStep + " not sent yet, will retry");
      return false;
    }
    parent.reply("", { htmlBody: built.htmlBody, inlineImages: built.inlineImages });
    draft.deleteDraft();
    ctx.forgetDrafts();

    swapSendAfterToSentAt(parent, prefix, stepNum, dueLabel);
    parent.addLabel(ensureLabel(prefix + "/step-" + stepNum));
  } else {
    const subject = draftMsg.getSubject() || "(no subject)";
    GmailApp.sendEmail(to, subject, body, {
      htmlBody: built.htmlBody,
      inlineImages: built.inlineImages,
    });
    draft.deleteDraft();
    ctx.forgetDrafts();

    // Find the just-sent thread to apply tracking labels.
    const sent = GmailApp.search(
      'in:sent to:' + to + ' subject:"' + subject.replace(/"/g, "") + '" newer_than:1d',
      0, 1,
    );
    if (sent.length > 0) {
      swapSendAfterToSentAt(sent[0], prefix, stepNum, dueLabel);
      sent[0].addLabel(ensureLabel(prefix + "/to/" + to));
      sent[0].addLabel(ensureLabel(prefix + "/step-" + stepNum));
      sent[0].addLabel(ensureLabel(prefix + "/mode-new"));
    } else {
      // Couldn't find the sent thread (rare). Still clear the due label off the
      // original draft thread so we don't try again.
      thread.removeLabel(dueLabel);
    }
  }

  return true;
}

// ─── cleanup: prospect already replied → drop pending drafts to them ────────
function cleanupRepliedRecipients(ctx) {
  const toLabelRe = /^(.+?)\/to\/(.+)$/;
  const labels = ctx.getAllLabels().filter(function (l) {
    return rootLabelOk(l.getName()) && toLabelRe.test(l.getName());
  });

  let cleaned = 0;
  for (let i = 0; i < labels.length; i++) {
    const label = labels[i];
    const m = label.getName().match(toLabelRe);
    const prefix = m[1];
    const email = m[2];

    if (!recipientReplied(prefix, email)) continue;

    const threads = label.getThreads(0, SCAN_LIMIT);
    for (let j = 0; j < threads.length; j++) {
      const thread = threads[j];
      const hasSendAfter = thread.getLabels().some(function (l) {
        return /\/send-after-/.test(l.getName());
      });
      if (!hasSendAfter) continue;

      const draft = ctx.findDraftOnThread(thread.getId());
      if (!draft) continue;
      draft.deleteDraft();
      ctx.forgetDrafts();
      // Strip the send-after label so the scanner doesn't churn on it again.
      thread.getLabels().forEach(function (lbl) {
        if (/\/send-after-/.test(lbl.getName())) thread.removeLabel(lbl);
      });
      cleaned++;
      Logger.log("cleaned: " + email + " step thread " + thread.getId() + " — recipient replied");
    }
  }
  return cleaned;
}

function recipientReplied(prefix, email) {
  // We only count messages FROM the prospect on a thread that has our
  // /to/<email> label — that filters out unrelated mail.
  const q = 'from:' + email + ' label:"' + prefix + '/to/' + email + '"';
  return GmailApp.search(q, 0, 1).length > 0;
}

// ─── status helpers ─────────────────────────────────────────────────────────
function listDueDrafts(ctx) {
  const sendAfterRe = /^(.+?)\/step-(\d+)\/send-after-(.+)$/;
  const out = [];
  ctx.getAllLabels().forEach(function (l) {
    if (!rootLabelOk(l.getName())) return;
    const m = l.getName().match(sendAfterRe);
    if (!m) return;
    const due = parseSlugIso(m[3]);
    if (!due || due > ctx.now) return;
    const threads = l.getThreads(0, SCAN_LIMIT);
    threads.forEach(function (t) {
      const to = labelLookup(t, m[1], "/to/") || "(unknown)";
      out.push("step " + m[2] + " to " + to + " (due " + m[3] + ")");
    });
  });
  return out;
}

function listCleanupCandidates(ctx) {
  const out = [];
  const toLabelRe = /^(.+?)\/to\/(.+)$/;
  ctx.getAllLabels().forEach(function (l) {
    if (!rootLabelOk(l.getName())) return;
    const m = l.getName().match(toLabelRe);
    if (!m) return;
    if (!recipientReplied(m[1], m[2])) return;
    const threads = l.getThreads(0, SCAN_LIMIT);
    threads.forEach(function (t) {
      if (t.getLabels().some(function (lbl) { return /\/send-after-/.test(lbl.getName()); })) {
        out.push(m[2] + " (replied) — pending thread " + t.getId());
      }
    });
  });
  return out;
}

// ─── gif inlining ───────────────────────────────────────────────────────────
//
// Bodies contain one or more `[[gif:<url>]]` tokens (the worker substitutes
// {{gif_url}} per prospect). Each one is fetched, attached as inline image
// with its own CID, and the token is replaced with <img src="cid:...">.
// Empty URLs and fetch failures are stripped silently — better than leaking
// `[[gif:]]` text into the email.
function buildHtmlWithGif(body) {
  let html = textToHtml(body);
  const inlineImages = {};
  const tokenRe = /\[\[gif:([^\]]*)\]\]/g;
  if (!tokenRe.test(html)) return { htmlBody: html, inlineImages: inlineImages };
  tokenRe.lastIndex = 0;

  let i = 0;
  html = html.replace(tokenRe, function (_match, rawUrl) {
    const url = rawUrl.trim();
    if (!url) return "";
    try {
      const blob = UrlFetchApp.fetch(url).getBlob().setName("anim-" + i + ".gif");
      const cid = "gif" + Date.now() + "_" + (i++);
      inlineImages[cid] = blob;
      return '<img src="cid:' + cid + '" alt="">';
    } catch (e) {
      Logger.log("gif fetch failed for " + url + ": " + e);
      return "";
    }
  });
  return { htmlBody: html, inlineImages: inlineImages };
}

// ─── small helpers ──────────────────────────────────────────────────────────
function ensureLabel(name) {
  return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
}

function swapSendAfterToSentAt(thread, prefix, stepNum, dueLabel) {
  if (dueLabel) thread.removeLabel(dueLabel);
  const sentLabel = ensureLabel(prefix + "/step-" + stepNum + "/sent-at-" + isoSlug(new Date()));
  thread.addLabel(sentLabel);
}

function labelLookup(thread, prefix, marker) {
  const re = new RegExp(
    "^" + escapeRe(prefix) + escapeRe(marker) + "(.+)$"
  );
  const labels = thread.getLabels();
  for (let i = 0; i < labels.length; i++) {
    const m = labels[i].getName().match(re);
    if (m) return m[1];
  }
  return "";
}

function readReplyTargetStep(thread, prefix) {
  const re = new RegExp("^" + escapeRe(prefix) + "/reply-to-step-(\\d+)$");
  const labels = thread.getLabels();
  for (let i = 0; i < labels.length; i++) {
    const m = labels[i].getName().match(re);
    if (m) return parseInt(m[1], 10);
  }
  return 1;
}

function findParentSentThread(prefix, to, parentStep) {
  const q =
    'label:"' + prefix + '/to/' + to + '" ' +
    'label:"' + prefix + '/step-' + parentStep + '"';
  const threads = GmailApp.search(q, 0, 5);
  const sentRe = new RegExp("/step-" + parentStep + "/sent-at-");
  for (let i = 0; i < threads.length; i++) {
    if (threads[i].getLabels().some(function (l) { return sentRe.test(l.getName()); })) {
      return threads[i];
    }
  }
  return null;
}

function parseSlugIso(slug) {
  // "2026-05-20T13-00" → Date
  const fixed = slug.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})$/, "$1:$2:00");
  const d = new Date(fixed);
  return isNaN(d.getTime()) ? null : d;
}

function isoSlug(d) {
  const pad = function (n) { return n < 10 ? "0" + n : "" + n; };
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) +
    "-" + pad(d.getMinutes())
  );
}

function escapeRe(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function textToHtml(text) {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // [[gif:<url>]] tokens are preserved verbatim; buildHtmlWithGif rewrites
  // them after escaping.
  return esc.replace(/\n/g, "<br>");
}
