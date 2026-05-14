/**
 * auto-send-labeled.gs — send every draft labeled "SEND READY",
 * pausing SLEEP_BETWEEN_SENDS_MS between each one so the batch
 * doesn't hit Gmail at top speed.
 *
 * Setup:
 *   1. Paste this file into a new Apps Script project.
 *   2. Run `setup` once from the editor → creates the "SEND READY"
 *      label (if missing) and installs a 1-minute time trigger.
 *   3. To send manually any time, run `sendNow`.
 *
 * Day-to-day:
 *   - Apply the "SEND READY" label to any draft you've reviewed.
 *   - On the next tick the script sends it, then sleeps 10 s before
 *     the next one in the same run.
 *
 * Runtime budget note:
 *   With SLEEP_BETWEEN_SENDS_MS = 10 000 and MAX_PER_RUN = 50, a full
 *   run takes ~500 s + send time. Consumer Apps Script execution caps
 *   at 6 min — drop MAX_PER_RUN to 25 (or raise the trigger cadence)
 *   if you're not on Workspace.
 */

const LABEL_NAME              = 'SEND READY';
const DRY_RUN                 = false;  // true = log only, false = actually send
const MIN_AGE_MINUTES         = 0;      // 0 = send immediately, no buffer
const MAX_PER_RUN             = 50;     // cap per cycle (Workspace daily cap is 2,000)
const SLEEP_BETWEEN_SENDS_MS  = 10000;  // 10 s pause between sends

function autoSendLabeledDrafts() {
  const label = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!label) {
    Logger.log('Label "' + LABEL_NAME + '" not found. Create it in Gmail first.');
    return;
  }

  const drafts = GmailApp.getDrafts();
  const now = new Date().getTime();
  const minAgeMs = MIN_AGE_MINUTES * 60 * 1000;

  let sent = 0;
  let skipped = 0;

  for (const draft of drafts) {
    if (sent >= MAX_PER_RUN) break;

    const message = draft.getMessage();
    const thread = message.getThread();
    const threadLabels = thread.getLabels().map(function (l) { return l.getName(); });

    if (threadLabels.indexOf(LABEL_NAME) === -1) continue;

    if (minAgeMs > 0) {
      const ageMs = now - message.getDate().getTime();
      if (ageMs < minAgeMs) {
        Logger.log('Skipping (too fresh, ' + Math.round(ageMs / 1000) + 's old): ' + message.getSubject());
        skipped++;
        continue;
      }
    }

    const subject = message.getSubject() || '(no subject)';
    const to = message.getTo() || '(no recipient)';

    if (DRY_RUN) {
      Logger.log('[DRY_RUN] Would send: ' + subject + ' -> ' + to);
      sent++;
      continue;
    }

    try {
      draft.send();
      Logger.log('Sent: ' + subject + ' -> ' + to);
      sent++;
      // Throttle. Skip the sleep after the final send in this run so we
      // don't waste the rest of the execution window doing nothing.
      if (sent < MAX_PER_RUN && SLEEP_BETWEEN_SENDS_MS > 0) {
        Utilities.sleep(SLEEP_BETWEEN_SENDS_MS);
      }
    } catch (e) {
      Logger.log('Error sending "' + subject + '": ' + e.toString());
    }
  }

  Logger.log('Run complete. Sent: ' + sent + ', skipped: ' + skipped);
}

/**
 * Manual one-shot: blast every Send-Ready draft right now.
 * Same as the trigger function, just labeled for clarity in the
 * Apps Script run dropdown.
 */
function sendNow() {
  autoSendLabeledDrafts();
}

/**
 * One-time helper: creates the "SEND READY" label if missing and
 * installs a 1-minute time trigger. Run this once from the editor.
 */
function setup() {
  if (!GmailApp.getUserLabelByName(LABEL_NAME)) {
    GmailApp.createLabel(LABEL_NAME);
    Logger.log('Created label: ' + LABEL_NAME);
  } else {
    Logger.log('Label "' + LABEL_NAME + '" already exists.');
  }

  // Wipe any previously installed trigger for this handler so we
  // don't end up with stale triggers stacking.
  const triggers = ScriptApp.getProjectTriggers();
  for (const t of triggers) {
    if (t.getHandlerFunction() === 'autoSendLabeledDrafts') {
      ScriptApp.deleteTrigger(t);
    }
  }

  ScriptApp.newTrigger('autoSendLabeledDrafts')
    .timeBased()
    .everyMinutes(1)
    .create();
  Logger.log('Installed 1-minute trigger.');
}
