export default function HomePage() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 md:p-12">
      <div className="w-full max-w-2xl rounded-xl border border-zinc-800 bg-zinc-900/50 p-8 shadow-2xl backdrop-blur-sm">
        <div className="flex items-center gap-3">
          <div className="h-3 w-3 rounded-full bg-emerald-500 animate-pulse" />
          <span className="text-xs font-semibold uppercase tracking-wider text-emerald-400">
            Stage 1: Core Foundation Active
          </span>
        </div>

        <h1 className="mt-4 text-3xl font-bold tracking-tight text-white">
          Utopia
        </h1>

        <p className="mt-2 text-sm leading-relaxed text-zinc-400">
          An open-source, pseudonymous, community-first social platform. Users can
          be anonymous to each other, but not free from accountability. Feeds and
          moderation are explainable, deterministic, and transparent.
        </p>

        <div className="mt-6 rounded-lg border border-amber-500/20 bg-amber-500/10 p-4 text-xs text-amber-300">
          <p className="font-semibold">Security Gate Notice:</p>
          <p className="mt-1 text-amber-200/80">
            Public registration is disabled by default (
            <code className="rounded bg-amber-950/60 px-1 py-0.5 text-amber-300">
              ALLOW_PUBLIC_REGISTRATION=false
            </code>
            ) pending pre-launch registration abuse controls.
          </p>
        </div>

        <div className="mt-6 flex flex-wrap items-center gap-3">
          <a
            href="/c"
            className="inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Explore Communities (/c) →
          </a>
          <a
            href="/login"
            className="inline-flex items-center justify-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Sign In
          </a>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-4 border-t border-zinc-800 pt-6 text-xs text-zinc-500">
          <div>
            <span className="font-medium text-zinc-400">Stack:</span> Next.js 15,
            PostgreSQL 16, Prisma ORM, Tailwind CSS
          </div>
          <div>
            <span className="font-medium text-zinc-400">Status:</span> Phase 0 /
            Stage 1 Core Foundation
          </div>
        </div>
      </div>
    </main>
  );
}
