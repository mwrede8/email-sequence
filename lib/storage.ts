import type { Sequence } from "./types";

const KEY = "email-sequencer:sequences:v1";

export function loadSequences(): Sequence[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveSequences(seqs: Sequence[]) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(KEY, JSON.stringify(seqs));
}

export function uid(prefix = ""): string {
  return prefix + Math.random().toString(36).slice(2, 10);
}

// Detects {{var}} tokens (alphanumeric + underscore), returns unique names in order.
export function extractVariables(text: string): string[] {
  const re = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (!seen.has(m[1])) {
      seen.add(m[1]);
      out.push(m[1]);
    }
  }
  return out;
}

export function renderTemplate(
  text: string,
  row: Record<string, string>,
): { rendered: string; missing: string[] } {
  const missing: string[] = [];
  const rendered = text.replace(
    /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g,
    (_, name: string) => {
      if (row[name] === undefined || row[name] === "") {
        if (!missing.includes(name)) missing.push(name);
        return `{{${name}}}`;
      }
      return row[name];
    },
  );
  return { rendered, missing };
}
