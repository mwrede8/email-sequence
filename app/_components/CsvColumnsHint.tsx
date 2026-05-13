"use client";

import { useState } from "react";
import type { Step } from "@/lib/types";

export default function CsvColumnsHint({
  variables,
  sequenceName,
  steps,
}: {
  variables: string[];
  sequenceName: string;
  steps?: Step[];
}) {
  const columns = ["email", ...variables];
  const headerRow = columns.join(",");
  const promptText = buildPrompt(columns, sequenceName, steps);

  return (
    <div className="rounded-md border border-blue-200 bg-blue-50 px-3 py-3 text-xs text-blue-900 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="font-medium">
          CSV will need these columns ({columns.length}):
        </span>
        <div className="ml-auto flex items-center gap-1">
          <CopyButton text={headerRow} label="Copy header row" />
          <CopyButton text={promptText} label="Copy as Claude prompt" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1">
        {columns.map((v) => (
          <code
            key={v}
            className="font-mono bg-white px-1.5 py-0.5 rounded border border-blue-200"
          >
            {v}
          </code>
        ))}
      </div>
      <details className="text-[11px] text-blue-800">
        <summary className="cursor-pointer select-none hover:text-blue-900">
          Preview the Claude prompt
        </summary>
        <pre className="mt-1 whitespace-pre-wrap font-mono bg-white border border-blue-200 rounded p-2 max-h-48 overflow-y-auto">
          {promptText}
        </pre>
      </details>
    </div>
  );
}

function CopyButton({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(text);
        } catch {
          // Fallback for older browsers / no permissions.
          const ta = document.createElement("textarea");
          ta.value = text;
          document.body.appendChild(ta);
          ta.select();
          document.execCommand("copy");
          document.body.removeChild(ta);
        }
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      className="text-[11px] px-2 py-0.5 rounded border border-blue-300 bg-white hover:bg-blue-100"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}

function buildPrompt(
  columns: string[],
  sequenceName: string,
  steps?: Step[],
): string {
  const colList = columns.map((c) => `- ${c}`).join("\n");
  const stepsBlurb =
    steps && steps.length > 0
      ? "\n\nHere are the sequence steps so you know what each variable is used for:\n\n" +
        steps
          .map((s, i) => {
            const head =
              s.mode === "reply"
                ? `Step ${i + 1} — reply to step ${s.replyToStep ?? 1}` +
                  (i > 0 ? `, ${s.delayDays} days after` : "")
                : `Step ${i + 1} — new thread` +
                  (i > 0 ? `, ${s.delayDays} days after step ${i}` : "");
            const subj =
              s.mode === "new" && s.subject ? `Subject: ${s.subject}\n` : "";
            return `### ${head}\n${subj}${s.body || "(empty)"}`;
          })
          .join("\n\n")
      : "";

  return `I'm running an email campaign called "${sequenceName}" and need you to produce a CSV with one row per prospect.

The CSV must have exactly these columns (in order):

${colList}

Rules:
- \`email\` is the prospect's work email.
- Every other column is a value that gets substituted into the email body via \`{{column_name}}\` tokens, so write each value as it should appear in the email (no extra quotes, no curly braces).
- Keep each value to a single short phrase unless the sequence text clearly expects a longer one.
- Escape commas inside values by wrapping that cell in double quotes (standard CSV).
- Return only the CSV (header row + data rows), nothing else.${stepsBlurb}

Now please ask me for the list of prospects (names, companies, anything else you need) and then produce the CSV.`;
}
