export type SendMode = "new" | "reply";

export type Step = {
  subject: string;
  body: string;
  mode: SendMode;
  // 1-indexed step this reply threads under. Required when mode === "reply".
  replyToStep?: number;
  // Days after the prior step. Ignored on step 1.
  delayDays: number;
};

export type Sequence = {
  id: string;
  name: string;
  // Default Gmail label prefix for drafts generated from this sequence.
  // The worker appends `/step-N` and `/send-after-<iso>` per draft.
  labelPrefix: string;
  steps: Step[];
  updatedAt: string;
};

// What the worker reads. One file per campaign run.
export type Manifest = {
  sequenceId: string;
  sequenceName: string;
  labelPrefix: string;
  generatedAt: string;
  // Per-prospect, per-step rendered drafts.
  drafts: Array<{
    to: string;
    rowKey: string;
    step: number;
    mode: SendMode;
    replyToStep?: number;
    sendAfter: string;
    subject: string;
    body: string;
  }>;
};

// Token inserted by the "Insert gif" button. After the worker substitutes
// {{gif_url}} from the CSV, the resulting draft body contains
// `[[gif:https://example.com/anim.gif]]`. The Apps Script sender matches
// `\[\[gif:(.+?)\]\]`, fetches that URL, and CID-inlines it on send.
//
// If you want multiple gif slots in one sequence, change the variable name
// (e.g. `[[gif:{{gif_url_1}}]]`, `[[gif:{{gif_url_2}}]]`) and add matching
// CSV columns.
export const GIF_TOKEN = "[[gif:{{gif_url}}]]";
