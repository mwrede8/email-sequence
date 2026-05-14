"use client";

import Papa from "papaparse";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  extractVariables,
  loadSequences,
  renderTemplate,
} from "@/lib/storage";
import type { Manifest, Sequence } from "@/lib/types";
import CsvColumnsHint from "@/app/_components/CsvColumnsHint";

type ParsedCsv = {
  headers: string[];
  rows: Record<string, string>[];
};

export default function CampaignsPage() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [sequenceId, setSequenceId] = useState<string | null>(null);
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [csvFileName, setCsvFileName] = useState<string>("");
  const [manualRows, setManualRows] = useState<Record<string, string>[]>([]);
  const [draftRow, setDraftRow] = useState<Record<string, string>>({});
  const [campaignName, setCampaignName] = useState("");
  const [startDate, setStartDate] = useState<string>(
    new Date().toISOString().slice(0, 10),
  );
  const [previewIdx, setPreviewIdx] = useState(0);
  const [hosted, setHosted] = useState<boolean | null>(null);
  const [running, setRunning] = useState(false);
  const [log, setLog] = useState<string>("");
  const logRef = useRef<HTMLPreElement | null>(null);

  useEffect(() => {
    fetch("/api/drafts/run")
      .then((r) => r.json())
      .then((d) => setHosted(Boolean(d.hosted)))
      .catch(() => setHosted(null));
  }, []);

  useEffect(() => {
    if (logRef.current) logRef.current.scrollTop = logRef.current.scrollHeight;
  }, [log]);

  useEffect(() => {
    const seqs = loadSequences();
    setSequences(seqs);
    if (seqs.length > 0) setSequenceId(seqs[0].id);
  }, []);

  const sequence = useMemo(
    () => sequences.find((s) => s.id === sequenceId) ?? null,
    [sequences, sequenceId],
  );

  const requiredVars = useMemo(() => {
    if (!sequence) return [];
    const all = sequence.steps.map((s) => s.subject + " " + s.body).join(" ");
    return extractVariables(all);
  }, [sequence]);

  // CSV columns missing required tokens. Manual rows always carry every
  // required column (the form has an input per column), so they don't
  // contribute to this check.
  const missingColumns = useMemo(() => {
    if (!csv || !sequence) return [];
    const have = new Set(csv.headers.map((h) => h.trim()));
    return ["email", ...requiredVars].filter((v) => !have.has(v));
  }, [csv, sequence, requiredVars]);

  // Merged list of prospects. CSV rows tagged source="csv", manual rows
  // source="manual" so the table can show where each came from.
  type SourcedRow = Record<string, string> & {
    __source: "csv" | "manual";
    __key: string;
  };
  const allRows: SourcedRow[] = useMemo(() => {
    const csvRows: SourcedRow[] =
      csv?.rows.map((r, i) => ({
        ...r,
        __source: "csv" as const,
        __key: `csv:${i}:${r.email ?? ""}`,
      })) ?? [];
    const manRows: SourcedRow[] = manualRows.map((r, i) => ({
      ...r,
      __source: "manual" as const,
      __key: `manual:${i}:${r.email ?? ""}`,
    }));
    return [...csvRows, ...manRows];
  }, [csv, manualRows]);

  function addManualRow() {
    if (!draftRow.email || !draftRow.email.trim()) return;
    const cleaned: Record<string, string> = {};
    ["email", ...requiredVars].forEach((col) => {
      cleaned[col] = (draftRow[col] ?? "").trim();
    });
    setManualRows((prev) => [...prev, cleaned]);
    setDraftRow({});
  }

  function removeRow(row: SourcedRow) {
    if (row.__source === "manual") {
      // Find by composite key: we can't trust array index after re-renders.
      const idx = parseInt(row.__key.split(":")[1] ?? "-1", 10);
      setManualRows((prev) => prev.filter((_, i) => i !== idx));
    } else if (csv) {
      const idx = parseInt(row.__key.split(":")[1] ?? "-1", 10);
      const nextRows = csv.rows.filter((_, i) => i !== idx);
      setCsv({ headers: csv.headers, rows: nextRows });
    }
  }

  function onCsvUpload(file: File) {
    setCsvFileName(file.name);
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h: string) => h.trim(),
      complete: (res) => {
        const headers = (res.meta.fields ?? []).map((h) => h.trim());
        const rows = (res.data ?? []).filter((r) => r && r.email);
        setCsv({ headers, rows });
        setPreviewIdx(0);
      },
    });
  }

  function buildManifest(): Manifest | null {
    if (!sequence || allRows.length === 0) return null;
    const base = new Date(startDate + "T09:00:00");
    const drafts: Manifest["drafts"] = [];
    allRows.forEach((row, rowIdx) => {
      let cumulative = 0;
      sequence.steps.forEach((step, stepIdx) => {
        cumulative += stepIdx === 0 ? 0 : step.delayDays;
        const sendAfter = new Date(base.getTime());
        sendAfter.setDate(sendAfter.getDate() + cumulative);
        const { rendered: subject } = renderTemplate(step.subject, row);
        const { rendered: body } = renderTemplate(step.body, row);
        drafts.push({
          to: row.email,
          rowKey:
            row.email +
            "::" +
            String(rowIdx).padStart(4, "0"),
          step: stepIdx + 1,
          mode: step.mode,
          replyToStep: step.replyToStep,
          sendAfter: sendAfter.toISOString(),
          subject,
          body,
        });
      });
    });
    return {
      sequenceId: sequence.id,
      sequenceName: sequence.name,
      labelPrefix: sequence.labelPrefix,
      generatedAt: new Date().toISOString(),
      drafts,
    };
  }

  async function runDrafts(dryRun: boolean) {
    const m = buildManifest();
    if (!m) return;
    setRunning(true);
    setLog("");
    try {
      const r = await fetch("/api/drafts/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ manifest: m, dryRun }),
      });
      if (!r.ok) {
        const text = await r.text();
        try {
          const err = JSON.parse(text);
          if (err.error === "hosted") {
            setLog(err.message);
            return;
          }
        } catch {}
        setLog(text || `HTTP ${r.status}`);
        return;
      }
      const reader = r.body?.getReader();
      if (!reader) {
        setLog("(no response body)");
        return;
      }
      const dec = new TextDecoder();
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        setLog((prev) => prev + dec.decode(value, { stream: true }));
      }
    } catch (e) {
      setLog((prev) => prev + "\n[client error] " + (e as Error).message);
    } finally {
      setRunning(false);
    }
  }

  function downloadManifest() {
    const m = buildManifest();
    if (!m) return;
    const blob = new Blob([JSON.stringify(m, null, 2)], {
      type: "application/json",
    });
    const a = document.createElement("a");
    const tag = (campaignName || sequence?.name || "campaign")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "");
    a.href = URL.createObjectURL(blob);
    a.download = `manifest-${tag}-${new Date()
      .toISOString()
      .slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  const ready =
    !!sequence && allRows.length > 0 && missingColumns.length === 0;
  const previewRow = allRows[previewIdx];
  const previewDrafts =
    sequence && previewRow
      ? sequence.steps.map((step, i) => {
          const { rendered: subject } = renderTemplate(step.subject, previewRow);
          const { rendered: body } = renderTemplate(step.body, previewRow);
          return { i, mode: step.mode, replyToStep: step.replyToStep, subject, body, delayDays: step.delayDays };
        })
      : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Campaigns</h1>
        <p className="text-sm text-neutral-600 mt-1">
          Pick a sequence, upload a CSV, download the manifest, run the worker.
        </p>
      </div>

      <section className="grid sm:grid-cols-2 gap-4">
        <div className="space-y-2">
          <label className="text-sm font-medium">Sequence</label>
          {sequences.length === 0 ? (
            <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No sequences yet. Build one in the{" "}
              <a href="/sequences" className="underline">
                Sequences
              </a>{" "}
              tab first.
            </div>
          ) : (
            <select
              value={sequenceId ?? ""}
              onChange={(e) => setSequenceId(e.target.value)}
              className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
            >
              {sequences.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} · {s.steps.length} step
                  {s.steps.length === 1 ? "" : "s"}
                </option>
              ))}
            </select>
          )}
          {sequence && (
            <div className="text-xs text-neutral-500">
              Label prefix:{" "}
              <code className="font-mono">{sequence.labelPrefix}</code>
            </div>
          )}
        </div>

        <div className="space-y-2">
          <label className="text-sm font-medium">Campaign name</label>
          <input
            value={campaignName}
            onChange={(e) => setCampaignName(e.target.value)}
            placeholder="e.g. potash-may-w3"
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
          <label className="text-sm font-medium block">Start date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm"
          />
        </div>
      </section>

      {requiredVars.length > 0 && sequence && (
        <CsvColumnsHint
          variables={requiredVars}
          sequenceName={sequence.name}
          steps={sequence.steps}
        />
      )}

      <section className="space-y-3">
        <label className="text-sm font-medium">Prospects</label>

        <div className="space-y-2">
          <input
            type="file"
            accept=".csv,text/csv"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) onCsvUpload(f);
            }}
            className="block w-full text-sm file:mr-3 file:rounded file:border-0 file:bg-neutral-900 file:text-white file:px-3 file:py-1.5 file:text-xs"
          />
          {csv && (
            <div className="text-xs text-neutral-600">
              <code className="font-mono">{csvFileName}</code> ·{" "}
              {csv.rows.length} rows · columns:{" "}
              {csv.headers.map((h) => (
                <code
                  key={h}
                  className="font-mono bg-neutral-100 px-1 py-0.5 rounded mr-1"
                >
                  {h}
                </code>
              ))}
            </div>
          )}
          {csv && missingColumns.length > 0 && (
            <div className="text-xs text-red-700">
              Missing columns:{" "}
              {missingColumns.map((c) => (
                <code key={c} className="font-mono bg-white px-1 rounded mr-1">
                  {c}
                </code>
              ))}
            </div>
          )}
        </div>

        {sequence && (
          <details className="rounded-md border border-neutral-200 bg-white p-3" open={manualRows.length > 0 || !csv}>
            <summary className="text-sm font-medium cursor-pointer select-none">
              Add a prospect by hand
              {manualRows.length > 0 && (
                <span className="ml-2 text-xs text-neutral-500 font-normal">
                  ({manualRows.length} added)
                </span>
              )}
            </summary>
            <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-2">
              {["email", ...requiredVars].map((col) => (
                <label key={col} className="text-xs text-neutral-700">
                  <span className="font-mono">{col}</span>
                  <input
                    value={draftRow[col] ?? ""}
                    onChange={(e) =>
                      setDraftRow((prev) => ({
                        ...prev,
                        [col]: e.target.value,
                      }))
                    }
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        addManualRow();
                      }
                    }}
                    placeholder={
                      col === "email"
                        ? "alice@example.com"
                        : col === "gif_url"
                          ? "https://…"
                          : ""
                    }
                    className="mt-0.5 w-full rounded-md border border-neutral-300 bg-white px-2 py-1.5 text-sm"
                  />
                </label>
              ))}
            </div>
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                onClick={addManualRow}
                disabled={!draftRow.email || !draftRow.email.trim()}
                className="text-sm px-3 py-1.5 rounded-md bg-neutral-900 text-white hover:bg-neutral-800 disabled:opacity-40"
              >
                + Add prospect
              </button>
              <span className="text-xs text-neutral-500">
                Enter in any field also adds.
              </span>
            </div>
          </details>
        )}

        {allRows.length > 0 && (
          <div className="rounded-md border border-neutral-200 bg-white overflow-hidden">
            <div className="px-3 py-2 text-xs font-medium border-b border-neutral-200 bg-neutral-50">
              {allRows.length} prospect{allRows.length === 1 ? "" : "s"} queued
              {csv && manualRows.length > 0 && (
                <span className="text-neutral-500 font-normal">
                  {" "}
                  · {csv.rows.length} from CSV + {manualRows.length} manual
                </span>
              )}
            </div>
            <ul className="divide-y divide-neutral-200 max-h-48 overflow-y-auto">
              {allRows.map((row) => (
                <li
                  key={row.__key}
                  className="flex items-center gap-2 px-3 py-1.5 text-xs"
                >
                  <span className="font-mono">{row.email || "(no email)"}</span>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded ${
                      row.__source === "manual"
                        ? "bg-purple-100 text-purple-900"
                        : "bg-neutral-100 text-neutral-700"
                    }`}
                  >
                    {row.__source}
                  </span>
                  <span className="ml-auto text-neutral-500 truncate">
                    {requiredVars
                      .slice(0, 2)
                      .map((v) => `${v}=${row[v] || "—"}`)
                      .join(" · ")}
                  </span>
                  <button
                    onClick={() => removeRow(row)}
                    className="text-neutral-400 hover:text-red-700"
                    title="Remove"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {ready && previewRow && (
        <section className="space-y-3">
          <div className="flex items-center gap-3">
            <h2 className="text-sm font-semibold">Preview</h2>
            <div className="flex items-center gap-1 text-xs">
              <button
                onClick={() => setPreviewIdx(Math.max(0, previewIdx - 1))}
                disabled={previewIdx === 0}
                className="px-2 py-0.5 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-30"
              >
                ←
              </button>
              <span className="font-mono text-neutral-600">
                {previewIdx + 1} / {allRows.length} · {previewRow.email}
              </span>
              <button
                onClick={() =>
                  setPreviewIdx(Math.min(allRows.length - 1, previewIdx + 1))
                }
                disabled={previewIdx >= allRows.length - 1}
                className="px-2 py-0.5 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-30"
              >
                →
              </button>
            </div>
          </div>
          <div className="space-y-2">
            {previewDrafts.map((d) => (
              <div
                key={d.i}
                className="rounded-md border border-neutral-200 bg-white p-3 text-sm"
              >
                <div className="flex items-center gap-2 text-xs text-neutral-500 mb-2">
                  <span className="font-mono">#{d.i + 1}</span>
                  <span
                    className={`px-1.5 py-0.5 rounded ${
                      d.mode === "reply"
                        ? "bg-amber-100 text-amber-900"
                        : "bg-blue-100 text-blue-900"
                    }`}
                  >
                    {d.mode === "reply"
                      ? `↳ Reply to #${d.replyToStep ?? 1}`
                      : "New thread"}
                  </span>
                  {d.i > 0 && <span>delay {d.delayDays}d</span>}
                </div>
                {d.mode === "new" && (
                  <div className="font-semibold mb-1">
                    Subject: {d.subject}
                  </div>
                )}
                <pre className="whitespace-pre-wrap font-mono text-xs leading-relaxed text-neutral-800">
                  {d.body}
                </pre>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="space-y-3 pt-3 border-t border-neutral-200">
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => runDrafts(false)}
            disabled={!ready || running || hosted === true}
            className="rounded-md bg-emerald-700 text-white text-sm px-4 py-2 hover:bg-emerald-800 disabled:opacity-40"
            title={
              hosted === true
                ? "Hosted on Vercel — run npm run dev locally to use this button"
                : undefined
            }
          >
            {running ? "Running…" : "Create drafts in Gmail"}
          </button>
          <button
            onClick={() => runDrafts(true)}
            disabled={!ready || running || hosted === true}
            className="rounded-md border border-neutral-300 bg-white text-sm px-4 py-2 hover:bg-neutral-100 disabled:opacity-40"
          >
            Dry run
          </button>
          <button
            onClick={downloadManifest}
            disabled={!ready}
            className="rounded-md border border-neutral-300 bg-white text-sm px-4 py-2 hover:bg-neutral-100 disabled:opacity-40"
          >
            Download manifest.json
          </button>
          <span className="text-xs text-neutral-500">
            {hosted === true ? (
              <>
                Hosted preview — open{" "}
                <code className="font-mono">http://localhost:3003</code> to
                draft into your Gmail.
              </>
            ) : hosted === false ? (
              <>
                Local mode. The button spawns{" "}
                <code className="font-mono">
                  python worker/draft_writer.py
                </code>
                .
              </>
            ) : (
              "Detecting environment…"
            )}
          </span>
        </div>
        {log && (
          <pre
            ref={logRef}
            className="rounded-md border border-neutral-200 bg-neutral-900 text-neutral-100 p-3 text-xs font-mono whitespace-pre-wrap max-h-64 overflow-y-auto"
          >
            {log}
          </pre>
        )}
      </section>
    </div>
  );
}
