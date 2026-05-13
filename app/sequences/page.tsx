"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractVariables,
  loadSequences,
  saveSequences,
  uid,
} from "@/lib/storage";
import type { Sequence, Step, SendMode } from "@/lib/types";
import { GIF_TOKEN } from "@/lib/types";
import CsvColumnsHint from "@/app/_components/CsvColumnsHint";

function emptySequence(): Sequence {
  return {
    id: uid("seq_"),
    name: "New sequence",
    labelPrefix: "seq/new-sequence",
    steps: [
      { subject: "", body: "", mode: "new", delayDays: 0 },
    ],
    updatedAt: new Date().toISOString(),
  };
}

function defaultReplyTarget(idx: number, steps: Step[]): number {
  for (let k = idx - 1; k >= 0; k--) {
    if (steps[k].mode === "new") return k + 1;
  }
  return 1;
}

function normalizeSteps(steps: Step[]): Step[] {
  return steps.map((s, i) => {
    if (i === 0 && s.mode !== "new") {
      return { ...s, mode: "new", replyToStep: undefined, delayDays: 0 };
    }
    if (s.mode === "reply" && i > 0) {
      const target = s.replyToStep ?? defaultReplyTarget(i, steps);
      return { ...s, replyToStep: Math.min(Math.max(1, target), i) };
    }
    return s;
  });
}

export default function SequencesPage() {
  const [sequences, setSequences] = useState<Sequence[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  useEffect(() => {
    const loaded = loadSequences();
    if (loaded.length === 0) {
      const first = emptySequence();
      setSequences([first]);
      setActiveId(first.id);
      saveSequences([first]);
    } else {
      setSequences(loaded);
      setActiveId(loaded[0].id);
    }
  }, []);

  const active = useMemo(
    () => sequences.find((s) => s.id === activeId) ?? null,
    [sequences, activeId],
  );

  const updateActive = useCallback(
    (patch: Partial<Sequence> | ((s: Sequence) => Sequence)) => {
      setSequences((prev) => {
        const next = prev.map((s) => {
          if (s.id !== activeId) return s;
          const merged = typeof patch === "function" ? patch(s) : { ...s, ...patch };
          return { ...merged, updatedAt: new Date().toISOString() };
        });
        saveSequences(next);
        return next;
      });
    },
    [activeId],
  );

  function addSequence() {
    const seq = emptySequence();
    const next = [seq, ...sequences];
    setSequences(next);
    setActiveId(seq.id);
    saveSequences(next);
  }

  function deleteSequence(id: string) {
    if (!confirm("Delete this sequence? This can't be undone.")) return;
    const next = sequences.filter((s) => s.id !== id);
    setSequences(next);
    if (activeId === id) setActiveId(next[0]?.id ?? null);
    saveSequences(next);
  }

  function duplicateSequence(id: string) {
    const orig = sequences.find((s) => s.id === id);
    if (!orig) return;
    const copy: Sequence = {
      ...orig,
      id: uid("seq_"),
      name: orig.name + " (copy)",
      updatedAt: new Date().toISOString(),
    };
    const next = [copy, ...sequences];
    setSequences(next);
    setActiveId(copy.id);
    saveSequences(next);
  }

  if (!active) {
    return (
      <div className="space-y-4">
        <h1 className="text-2xl font-semibold tracking-tight">Sequences</h1>
        <button
          onClick={addSequence}
          className="rounded-md bg-neutral-900 text-white text-sm px-4 py-2"
        >
          + New sequence
        </button>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[220px_1fr] gap-6 min-h-[60vh]">
      <aside className="space-y-2">
        <button
          onClick={addSequence}
          className="w-full rounded-md bg-neutral-900 text-white text-sm px-3 py-2 hover:bg-neutral-800"
        >
          + New sequence
        </button>
        <ul className="space-y-1">
          {sequences.map((s) => (
            <li key={s.id}>
              <button
                onClick={() => setActiveId(s.id)}
                className={`w-full text-left rounded px-3 py-2 text-sm border ${
                  s.id === activeId
                    ? "border-neutral-900 bg-white"
                    : "border-transparent hover:bg-neutral-100"
                }`}
              >
                <div className="font-medium truncate">{s.name}</div>
                <div className="text-xs text-neutral-500">
                  {s.steps.length} step{s.steps.length === 1 ? "" : "s"}
                </div>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <SequenceEditor
        key={active.id}
        sequence={active}
        onChange={updateActive}
        onDelete={() => deleteSequence(active.id)}
        onDuplicate={() => duplicateSequence(active.id)}
      />
    </div>
  );
}

function SequenceEditor({
  sequence,
  onChange,
  onDelete,
  onDuplicate,
}: {
  sequence: Sequence;
  onChange: (patch: Partial<Sequence> | ((s: Sequence) => Sequence)) => void;
  onDelete: () => void;
  onDuplicate: () => void;
}) {
  const cumulative = sequence.steps.reduce<number[]>((acc, s, i) => {
    const last = acc.length > 0 ? acc[acc.length - 1] : 0;
    acc.push(i === 0 ? 0 : last + s.delayDays);
    return acc;
  }, []);

  const allText = sequence.steps.map((s) => s.subject + " " + s.body).join(" ");
  const variables = extractVariables(allText);

  function updateStep(idx: number, patch: Partial<Step>) {
    onChange((s) => ({
      ...s,
      steps: normalizeSteps(
        s.steps.map((st, i) => (i === idx ? { ...st, ...patch } : st)),
      ),
    }));
  }

  function addStep(mode: SendMode) {
    onChange((s) => {
      const isFirst = s.steps.length === 0;
      const next: Step = {
        subject: "",
        body: "",
        mode: isFirst ? "new" : mode,
        delayDays: isFirst ? 0 : 2,
      };
      return { ...s, steps: normalizeSteps([...s.steps, next]) };
    });
  }

  function removeStep(idx: number) {
    onChange((s) => ({
      ...s,
      steps: normalizeSteps(s.steps.filter((_, i) => i !== idx)),
    }));
  }

  function moveStep(idx: number, dir: -1 | 1) {
    onChange((s) => {
      const j = idx + dir;
      if (j < 0 || j >= s.steps.length) return s;
      const next = [...s.steps];
      [next[idx], next[j]] = [next[j], next[idx]];
      return { ...s, steps: normalizeSteps(next) };
    });
  }

  return (
    <section className="space-y-5">
      <div className="flex items-center gap-3">
        <input
          value={sequence.name}
          onChange={(e) => onChange({ name: e.target.value })}
          className="text-2xl font-semibold tracking-tight bg-transparent outline-none border-b border-transparent focus:border-neutral-300 flex-1 min-w-0"
        />
        <button
          onClick={onDuplicate}
          className="text-xs px-2 py-1 rounded border border-neutral-300 hover:bg-neutral-100"
        >
          duplicate
        </button>
        <button
          onClick={onDelete}
          className="text-xs px-2 py-1 rounded border border-red-300 text-red-700 hover:bg-red-50"
        >
          delete
        </button>
      </div>

      <div className="flex items-center gap-3 text-sm">
        <label className="text-neutral-600">Label prefix</label>
        <input
          value={sequence.labelPrefix}
          onChange={(e) => onChange({ labelPrefix: e.target.value })}
          placeholder="seq/my-sequence"
          className="font-mono text-xs flex-1 max-w-md rounded-md border border-neutral-300 bg-white px-3 py-1.5"
        />
        <span className="text-xs text-neutral-500">
          Worker labels each draft as{" "}
          <code className="font-mono">
            {sequence.labelPrefix || "seq/…"}/step-N/send-after-…
          </code>
        </span>
      </div>

      {variables.length > 0 && (
        <CsvColumnsHint
          variables={variables}
          sequenceName={sequence.name}
          steps={sequence.steps}
        />
      )}

      <ol className="space-y-3">
        {sequence.steps.map((s, i) => (
          <StepCard
            key={i}
            idx={i}
            step={s}
            cumulativeDay={cumulative[i]}
            totalSteps={sequence.steps.length}
            onPatch={(p) => updateStep(i, p)}
            onRemove={() => removeStep(i)}
            onMoveUp={() => moveStep(i, -1)}
            onMoveDown={() => moveStep(i, 1)}
          />
        ))}
      </ol>

      <div className="flex gap-2">
        <button
          onClick={() => addStep("new")}
          className="text-sm px-3 py-1.5 rounded border border-blue-300 bg-blue-50 text-blue-900 hover:bg-blue-100"
        >
          + New thread
        </button>
        <button
          onClick={() => addStep("reply")}
          disabled={sequence.steps.length === 0}
          className="text-sm px-3 py-1.5 rounded border border-amber-300 bg-amber-50 text-amber-900 hover:bg-amber-100 disabled:opacity-40"
        >
          + Reply
        </button>
      </div>
    </section>
  );
}

function StepCard({
  idx,
  step,
  cumulativeDay,
  totalSteps,
  onPatch,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  idx: number;
  step: Step;
  cumulativeDay: number;
  totalSteps: number;
  onPatch: (p: Partial<Step>) => void;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const bodyRef = useRef<HTMLTextAreaElement | null>(null);

  function insertAtCursor(token: string) {
    const el = bodyRef.current;
    if (!el) {
      onPatch({ body: step.body + token });
      return;
    }
    const start = el.selectionStart ?? step.body.length;
    const end = el.selectionEnd ?? step.body.length;
    const next = step.body.slice(0, start) + token + step.body.slice(end);
    onPatch({ body: next });
    // restore caret after render
    requestAnimationFrame(() => {
      el.focus();
      const pos = start + token.length;
      el.setSelectionRange(pos, pos);
    });
  }

  return (
    <li className="rounded-lg border border-neutral-200 bg-white p-4 space-y-3">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs font-mono text-neutral-500 w-6">
          #{idx + 1}
        </span>

        {idx === 0 ? (
          <span className="text-xs px-2 py-0.5 rounded bg-blue-100 text-blue-900 font-medium">
            New thread
          </span>
        ) : (
          <>
            <select
              value={step.mode}
              onChange={(e) =>
                onPatch({
                  mode: e.target.value as SendMode,
                  replyToStep:
                    e.target.value === "reply"
                      ? (step.replyToStep ?? idx)
                      : undefined,
                })
              }
              className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
            >
              <option value="new">new thread</option>
              <option value="reply">reply</option>
            </select>
            {step.mode === "reply" && (
              <select
                value={step.replyToStep ?? idx}
                onChange={(e) =>
                  onPatch({ replyToStep: parseInt(e.target.value, 10) || 1 })
                }
                className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs"
              >
                {Array.from({ length: idx }, (_, k) => k + 1).map((n) => (
                  <option key={n} value={n}>
                    to step #{n}
                  </option>
                ))}
              </select>
            )}
            <label className="text-xs text-neutral-600 inline-flex items-center gap-1">
              delay
              <input
                type="number"
                min={0}
                max={365}
                value={step.delayDays}
                onChange={(e) =>
                  onPatch({
                    delayDays: Math.max(
                      0,
                      parseInt(e.target.value || "0", 10) || 0,
                    ),
                  })
                }
                className="w-14 rounded border border-neutral-300 px-2 py-0.5 text-xs"
              />{" "}
              days
            </label>
          </>
        )}

        <span className="text-xs text-neutral-500">day +{cumulativeDay}</span>

        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={onMoveUp}
            disabled={idx === 0}
            className="text-xs px-1.5 py-0.5 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-30"
            aria-label="move up"
          >
            ↑
          </button>
          <button
            onClick={onMoveDown}
            disabled={idx === totalSteps - 1}
            className="text-xs px-1.5 py-0.5 rounded border border-neutral-300 hover:bg-neutral-100 disabled:opacity-30"
            aria-label="move down"
          >
            ↓
          </button>
          <button
            onClick={onRemove}
            disabled={totalSteps === 1}
            className="text-xs px-2 py-0.5 rounded border border-red-300 text-red-700 hover:bg-red-50 disabled:opacity-30"
          >
            remove
          </button>
        </div>
      </div>

      <input
        value={step.subject}
        onChange={(e) => onPatch({ subject: e.target.value })}
        placeholder={
          step.mode === "reply"
            ? "(reply uses the parent step's subject)"
            : "Subject"
        }
        disabled={step.mode === "reply"}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm disabled:bg-neutral-100 disabled:text-neutral-500"
      />

      <textarea
        ref={bodyRef}
        value={step.body}
        onChange={(e) => onPatch({ body: e.target.value })}
        placeholder={`Hi {{first_name}},\n\n…\n\nBest,\nMichael`}
        rows={8}
        className="w-full rounded-md border border-neutral-300 bg-white px-3 py-2 text-sm font-mono leading-relaxed"
      />

      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={() => insertAtCursor(GIF_TOKEN)}
          className="text-xs px-2 py-1 rounded border border-purple-300 bg-purple-50 text-purple-900 hover:bg-purple-100"
          title="Inserts [[gif_token]] at the cursor; Apps Script CID-inlines a gif when sending."
        >
          + Insert gif token
        </button>
        <span className="text-xs text-neutral-400 font-mono">{GIF_TOKEN}</span>
        <span className="text-xs text-neutral-500 ml-auto">
          {step.body.length} chars
        </span>
      </div>
    </li>
  );
}
