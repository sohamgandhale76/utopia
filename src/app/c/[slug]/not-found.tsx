import Link from "next/link";

export default function CommunityNotFound() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-4 py-16 text-center">
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-8 md:p-12 max-w-md w-full shadow-2xl">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-zinc-800 text-2xl mb-4">
          🔍
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-white">
          Community Not Found
        </h1>
        <p className="mt-2 text-sm text-zinc-400">
          The requested community does not exist or may have used a different slug.
        </p>
        <div className="mt-6 flex flex-col sm:flex-row items-center justify-center gap-3">
          <Link
            href="/c"
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-indigo-500"
          >
            Explore Communities
          </Link>
          <Link
            href="/c/create"
            className="w-full sm:w-auto inline-flex items-center justify-center rounded-lg border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition-colors hover:bg-zinc-800"
          >
            Create it
          </Link>
        </div>
      </div>
    </main>
  );
}
