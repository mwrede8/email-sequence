import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "Email Sequence",
  description: "Build email sequences, run them over a CSV, draft into Gmail.",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-neutral-50 text-neutral-900">
        <header className="border-b border-neutral-200 bg-white">
          <div className="max-w-6xl mx-auto px-6 h-14 flex items-center gap-6">
            <Link href="/" className="font-semibold tracking-tight">
              Email Sequence
            </Link>
            <nav className="flex items-center gap-1 text-sm">
              <Link
                href="/sequences"
                className="px-3 py-1.5 rounded hover:bg-neutral-100 text-neutral-700 hover:text-neutral-900"
              >
                Sequences
              </Link>
              <Link
                href="/campaigns"
                className="px-3 py-1.5 rounded hover:bg-neutral-100 text-neutral-700 hover:text-neutral-900"
              >
                Campaigns
              </Link>
            </nav>
          </div>
        </header>
        <main className="flex-1 max-w-6xl w-full mx-auto px-6 py-8">
          {children}
        </main>
        <footer className="border-t border-neutral-200 bg-white">
          <div className="max-w-6xl mx-auto px-6 py-3 text-xs text-neutral-500 flex items-center gap-4">
            <span>Local-only. Runtime: Python worker + Apps Script.</span>
            <Link
              href="https://github.com/mwrede8/email-sequence"
              className="underline hover:text-neutral-900"
              target="_blank"
              rel="noopener"
            >
              GitHub
            </Link>
          </div>
        </footer>
      </body>
    </html>
  );
}
