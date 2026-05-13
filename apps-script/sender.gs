/**
 * sender.gs — promote labeled email-sequencer drafts to Sent on schedule.
 *
 * Setup:
 *   1. script.google.com → New project, paste this file in.
 *   2. Settings → Show appsscript.json. Add gmail/drive scopes (see README).
 *   3. Triggers → add a time-driven trigger calling `tick`, every 5 or 15 min.
 *   4. (Optional) Drop one or more gif URLs into the `GIF_URLS` array below.
 *   5. (Optional) Put your signature text in `SIGNATURE`.
 *
 * Each tick:
 *   - Scans labels matching `*/step-N/send-after-<iso>`.
 *   - For every draft due (ISO <= now), CID-inlines a random gif in place of
 *     [[gif_token]], threads replies under the prior step's sent message, and
 *     sends.
 *   - On success, removes `send-after-*` and adds `sent-at-<iso>`.
 */

// ---- config ----
const LABEL_ROOTS = ["seq"]; // top-level prefixes the worker uses.
const GIF_URLS = [
  // Drop a few public/CDN gif URLs here. They get fetched per send and inlined as CID.
];
const SIGNATURE = ""; // optional plain-text signature appended after body.
const SCAN_LIMIT = 50; // max threads to look at per tick.
// ---- end config ----

function tick() {
  const now = new Date();
  const sendAfterRe = /\/step-(\d+)\/send-after-([0-9T:\-]+)$/;
  const labels = GmailApp.getUserLabels()
    .filter((l) =>
      LABEL_ROOTS.some((r) => l.getName() === r || l.getName().startsWith(r + "/"))
    )
    .filter((l) => sendAfterRe.test(l.getName()));

  let promoted = 0;
  labels.forEach((label) => {
    const m = label.getName().match(sendAfterRe);
    if (!m) return;
    const stepNum = parseInt(m[1], 10);
    const sendAfter = parseSlugIso(m[2]);
    if (!sendAfter || sendAfter > now) return;

    const threads = label.getThreads(0, SCAN_LIMIT);
    threads.forEach((thread) => {
      try {
        if (promoteThread(thread, stepNum, label)) promoted++;
      } catch (e) {
        Logger.log("promote failed: " + e);
      }
    });
  });
  Logger.log("tick: promoted " + promoted + " drafts");
}

// "2026-05-20T13-00" → Date
function parseSlugIso(slug) {
  const fixed = slug.replace(/^(\d{4}-\d{2}-\d{2}T\d{2})-(\d{2})$/, "$1:$2:00");
  const d = new Date(fixed);
  return isNaN(d.getTime()) ? null : d;
}

function findRootLabelPrefix(thread) {
  const labels = thread.getLabels().map((l) => l.getName());
  // The thread should have a label like "<prefix>/step-N/send-after-..." —
  // we want "<prefix>".
  for (const name of labels) {
    const m = name.match(/^(.+?)\/step-\d+\/send-after-/);
    if (m) return m[1];
  }
  return null;
}

function promoteThread(thread, stepNum, dueLabel) {
  // Find the matching draft on this thread.
  const drafts = GmailApp.getDrafts().filter(
    (d) => d.getMessage().getThread().getId() === thread.getId()
  );
  if (drafts.length === 0) return false;
  const draft = drafts[0];
  const draftMsg = draft.getMessage();

  const prefix = findRootLabelPrefix(thread);
  if (!prefix) return false;

  const mode = thread.getLabels().some((l) => l.getName() === prefix + "/mode-reply")
    ? "reply"
    : "new";

  const to = draftMsg.getTo() || extractToFromLabels(thread, prefix);
  let body = draftMsg.getPlainBody();
  if (SIGNATURE) body = body + "\n\n" + SIGNATURE;

  // CID-inline gif token.
  let htmlBody = textToHtml(body);
  const attachments = [];
  if (htmlBody.includes("[[gif_token]]") && GIF_URLS.length > 0) {
    try {
      const url = GIF_URLS[Math.floor(Math.random() * GIF_URLS.length)];
      const blob = UrlFetchApp.fetch(url).getBlob().setName("anim.gif");
      const cid = "gif" + Date.now();
      blob.setContentTypeFromExtension && blob.setContentTypeFromExtension();
      htmlBody = htmlBody.replace(
        /\[\[gif_token\]\]/g,
        '<img src="cid:' + cid + '" alt="">'
      );
      attachments.push({ fileName: "anim.gif", mimeType: "image/gif", content: blob.getBytes(), contentId: cid });
    } catch (e) {
      Logger.log("gif inline failed: " + e);
      htmlBody = htmlBody.replace(/\[\[gif_token\]\]/g, "");
    }
  } else {
    htmlBody = htmlBody.replace(/\[\[gif_token\]\]/g, "");
  }

  let sentMessage;
  if (mode === "reply") {
    const replyToStep = readReplyTargetStep(thread, prefix);
    const parentThread = findParentSentThread(prefix, to, replyToStep);
    if (parentThread) {
      // Re-send on the parent thread.
      parentThread.reply("", {
        htmlBody: htmlBody,
        inlineImages: inlineImagesFromAttachments(attachments),
      });
      // Find the message we just added.
      const all = parentThread.getMessages();
      sentMessage = all[all.length - 1];
      // Discard the standalone draft.
      draft.deleteDraft();
    } else {
      // No parent found yet (still pending). Skip this tick.
      return false;
    }
  } else {
    // New thread: just send the draft.
    const opts = {
      htmlBody: htmlBody,
      inlineImages: inlineImagesFromAttachments(attachments),
    };
    sentMessage = draft.send().getMessages().slice(-1)[0];
    // draft.send() returns the thread; we just want a reference to mark labels below.
    if (!sentMessage) sentMessage = draftMsg;
  }

  // Move the thread: remove the "send-after" label, add a "sent-at" label.
  const sentAt = isoSlug(new Date());
  const sentLabelName = prefix + "/step-" + stepNum + "/sent-at-" + sentAt;
  thread.removeLabel(dueLabel);
  thread.addLabel(GmailApp.getUserLabelByName(sentLabelName) || GmailApp.createLabel(sentLabelName));
  return true;
}

function inlineImagesFromAttachments(attachments) {
  const out = {};
  attachments.forEach((a) => {
    if (a.contentId) out[a.contentId] = Utilities.newBlob(a.content, a.mimeType, a.fileName);
  });
  return out;
}

function readReplyTargetStep(thread, prefix) {
  const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/reply-to-step-(\\d+)$");
  for (const lbl of thread.getLabels()) {
    const m = lbl.getName().match(re);
    if (m) return parseInt(m[1], 10);
  }
  return 1;
}

function extractToFromLabels(thread, prefix) {
  const re = new RegExp("^" + prefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "/to/(.+)$");
  for (const lbl of thread.getLabels()) {
    const m = lbl.getName().match(re);
    if (m) return m[1];
  }
  return "";
}

function findParentSentThread(prefix, to, parentStep) {
  // We labeled all drafts with /to/<email> and /step-N. After sending step N,
  // the thread holds /sent-at-… for step N. Find a thread with both.
  const query =
    'label:"' + prefix + "/to/" + to + '" ' +
    'label:"' + prefix + "/step-" + parentStep + '"';
  const threads = GmailApp.search(query, 0, 5);
  // Prefer threads that already have a sent-at marker (i.e. step N has been promoted).
  const sentRe = new RegExp("/step-" + parentStep + "/sent-at-");
  for (const t of threads) {
    if (t.getLabels().some((l) => sentRe.test(l.getName()))) return t;
  }
  return threads[0] || null;
}

function isoSlug(d) {
  const pad = (n) => (n < 10 ? "0" + n : "" + n);
  return (
    d.getFullYear() +
    "-" + pad(d.getMonth() + 1) +
    "-" + pad(d.getDate()) +
    "T" + pad(d.getHours()) +
    "-" + pad(d.getMinutes())
  );
}

function textToHtml(text) {
  const esc = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
  // Preserve the gif token verbatim — we'll swap it after escaping.
  return esc.replace(/\n/g, "<br>");
}
