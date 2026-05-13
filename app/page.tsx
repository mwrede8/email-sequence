import Link from "next/link";

export default function Home() {
  return (
    <div className="space-y-8">
      <section>
        <h1 className="text-3xl font-semibold tracking-tight">
          Build a sequence. Run it over a CSV. Draft it.
        </h1>
        <p className="mt-2 text-neutral-600 max-w-2xl">
          A two-step tool. Compose an email sequence (new threads, replies, delays).
          Upload a CSV with one row per prospect. The Python worker writes one Gmail
          draft per step per prospect, labeled for the Apps Script sender to release
          on schedule.
        </p>
      </section>

      <section className="grid sm:grid-cols-2 gap-4">
        <Link
          href="/sequences"
          className="block rounded-lg border border-neutral-200 bg-white p-5 hover:border-neutral-400 transition"
        >
          <div className="text-sm font-medium">1. Sequences</div>
          <div className="mt-1 text-sm text-neutral-600">
            Compose steps. Subject + body. New thread or reply. Delay days.
            Insert <code className="font-mono text-xs">[[gif_token]]</code>.
          </div>
        </Link>
        <Link
          href="/campaigns"
          className="block rounded-lg border border-neutral-200 bg-white p-5 hover:border-neutral-400 transition"
        >
          <div className="text-sm font-medium">2. Campaigns</div>
          <div className="mt-1 text-sm text-neutral-600">
            Pick a sequence, upload the CSV, render previews, download the
            manifest the Python worker consumes.
          </div>
        </Link>
      </section>

      <section className="rounded-lg border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900 space-y-2">
        <div className="font-medium">How it fits together</div>
        <ol className="list-decimal pl-5 space-y-1">
          <li>Build a sequence in the <strong>Sequences</strong> tab. Use
            <code className="bg-white px-1 rounded mx-1 font-mono">{`{{variable}}`}</code>
            tokens for per-prospect fields.</li>
          <li>In <strong>Campaigns</strong>, upload a CSV with one column per token plus
            an <code className="bg-white px-1 rounded mx-1 font-mono">email</code> column.</li>
          <li>Download the rendered manifest JSON.</li>
          <li>Run <code className="bg-white px-1 rounded font-mono">python worker/draft_writer.py manifest.json</code>
            — it creates one labeled Gmail draft per prospect per step.</li>
          <li>The Apps Script sender promotes drafts on schedule, inlines the gif,
            and threads replies under the prior step.</li>
        </ol>
      </section>
    </div>
  );
}
