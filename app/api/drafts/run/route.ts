import { spawn, ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

// This endpoint shells out to worker/draft_writer.py with the manifest the
// browser just posted. It depends on the user's local Gmail OAuth token, so
// it's gated to non-production environments — on Vercel it returns a hint.
export const runtime = "nodejs";

function isHosted(): boolean {
  return (
    process.env.VERCEL === "1" ||
    process.env.VERCEL_ENV === "production" ||
    process.env.VERCEL_ENV === "preview"
  );
}

function venvPython(workerDir: string): string {
  return path.join(workerDir, ".venv", "bin", "python");
}

// Spawn a command and pipe stdout+stderr through `send`. Resolves with the exit
// code so the route can decide whether to continue.
function runStreamed(
  send: (s: string) => void,
  cmd: string,
  args: string[],
  cwd: string,
): Promise<number> {
  return new Promise((resolve) => {
    let child: ChildProcessWithoutNullStreams;
    try {
      child = spawn(cmd, args, {
        cwd,
        env: { ...process.env, PYTHONUNBUFFERED: "1" },
      });
    } catch (e) {
      send(`\n[spawn error] ${(e as Error).message}\n`);
      resolve(-1);
      return;
    }
    child.stdout.on("data", (d: Buffer) => send(d.toString("utf-8")));
    child.stderr.on("data", (d: Buffer) => send(d.toString("utf-8")));
    child.on("error", (err: Error) => {
      send(`\n[spawn error] ${err.message}\n`);
      resolve(-1);
    });
    child.on("close", (code: number | null) => resolve(code ?? -1));
  });
}

async function ensureVenv(
  send: (s: string) => void,
  workerDir: string,
): Promise<boolean> {
  const py = venvPython(workerDir);
  if (existsSync(py)) return true;
  send("Setting up worker venv (first run only)…\n");
  send("$ python3 -m venv worker/.venv\n");
  const ven = await runStreamed(send, "python3", ["-m", "venv", ".venv"], workerDir);
  if (ven !== 0) {
    send(`\nvenv creation failed (exit ${ven}).\n`);
    return false;
  }
  send("$ worker/.venv/bin/pip install -q -r worker/requirements.txt\n");
  const pipExit = await runStreamed(
    send,
    path.join(workerDir, ".venv", "bin", "pip"),
    ["install", "-q", "-r", path.join(workerDir, "requirements.txt")],
    workerDir,
  );
  if (pipExit !== 0) {
    send(`\npip install failed (exit ${pipExit}).\n`);
    return false;
  }
  send("venv ready.\n\n");
  return true;
}

export async function POST(req: Request) {
  if (isHosted()) {
    return NextResponse.json(
      {
        error: "hosted",
        message:
          "Gmail drafting needs your local OAuth token. Run `npm run dev` and use this button from http://localhost:3003 instead — or download the manifest and run `python worker/draft_writer.py manifest.json`.",
      },
      { status: 503 },
    );
  }

  let manifest: unknown;
  let dryRun = false;
  try {
    const body = await req.json();
    manifest = body.manifest;
    dryRun = Boolean(body.dryRun);
  } catch {
    return NextResponse.json({ error: "bad-json" }, { status: 400 });
  }
  if (!manifest || typeof manifest !== "object") {
    return NextResponse.json({ error: "no-manifest" }, { status: 400 });
  }

  const projectRoot = process.cwd();
  const workerDir = path.join(projectRoot, "worker");
  const script = path.join(workerDir, "draft_writer.py");
  if (!existsSync(script)) {
    return NextResponse.json(
      { error: "missing-worker", path: script },
      { status: 500 },
    );
  }
  const manifestsDir = path.join(workerDir, "manifests");
  mkdirSync(manifestsDir, { recursive: true });
  const stamp = new Date()
    .toISOString()
    .replace(/[:.]/g, "-")
    .replace(/Z$/, "");
  const manifestPath = path.join(manifestsDir, `manifest-${stamp}.json`);
  writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));

  const args = [script, manifestPath];
  if (dryRun) args.push("--dry-run");

  const stream = new ReadableStream({
    async start(controller) {
      const enc = new TextEncoder();
      const send = (chunk: string) =>
        controller.enqueue(enc.encode(chunk));

      send(
        `(manifest written to ${path.relative(projectRoot, manifestPath)})\n`,
      );

      const ok = await ensureVenv(send, workerDir);
      if (!ok) {
        send("\n[aborted: venv setup failed]\n");
        controller.close();
        return;
      }

      const python = venvPython(workerDir);
      send(
        `$ worker/.venv/bin/python worker/draft_writer.py ${path.basename(manifestPath)}${dryRun ? " --dry-run" : ""}\n\n`,
      );
      const code = await runStreamed(send, python, args, projectRoot);
      send(`\n[exit ${code}]\n`);
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}

export async function GET() {
  return NextResponse.json({
    hosted: isHosted(),
    cwd: process.cwd(),
  });
}
