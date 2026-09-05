import type { Metadata } from "next";
import Link from "next/link";
import { getCurrentUser } from "@/features/auth/session";
import { SignOutButton } from "@/features/auth/components/sign-out-button";
import "./globals.css";

export const metadata: Metadata = {
  title: "Utopia | Community-First Pseudonymous Social Platform",
  description:
    "An open-source, pseudonymous, community-first social platform with explainable feeds and transparent moderation.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const user = await getCurrentUser();

  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#0a0a0c] text-zinc-100 antialiased flex flex-col">
        <header className="sticky top-0 z-50 w-full border-b border-zinc-800 bg-zinc-950/80 backdrop-blur-md">
          <div className="mx-auto flex h-14 max-w-6xl items-center justify-between px-4 sm:px-6">
            <div className="flex items-center gap-6">
              <Link
                href="/"
                className="flex items-center gap-2 font-bold tracking-tight text-white hover:text-indigo-400 transition-colors"
              >
                <span className="text-indigo-500">✦</span>
                <span>Utopia</span>
              </Link>
              <nav className="flex items-center gap-4 text-sm font-medium text-zinc-400">
                <Link
                  href="/c"
                  className="hover:text-zinc-100 transition-colors"
                >
                  Communities
                </Link>
              </nav>
            </div>

            <div className="flex flex-1 items-center justify-center px-6">
              <form action="/search" method="GET" className="w-full max-w-sm">
                <div className="relative">
                  <div className="pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3">
                    <svg className="h-4 w-4 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
                    </svg>
                  </div>
                  <input
                    type="search"
                    name="q"
                    placeholder="Search communities, posts, and users..."
                    className="block w-full rounded-md border-0 bg-zinc-900/50 py-1.5 pl-10 pr-3 text-sm leading-6 text-zinc-300 placeholder:text-zinc-500 focus:bg-zinc-900 focus:ring-1 focus:ring-inset focus:ring-indigo-500 transition-colors"
                    required
                    minLength={2}
                    maxLength={100}
                  />
                  {/* Keep the default type=ALL but don't strictly require sending it as a hidden input, 
                      as the page defaults to ALL if omitted. */}
                </div>
              </form>
            </div>

            <div className="flex items-center gap-3 text-sm">
              {user ? (
                <div className="flex items-center gap-3">
                  <span className="font-mono text-xs text-zinc-400">
                    u/{user.username}
                  </span>
                  <SignOutButton />
                </div>
              ) : (
                <div className="flex items-center gap-2">
                  <Link
                    href="/login"
                    className="rounded-md px-2.5 py-1 text-xs font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                  >
                    Sign In
                  </Link>
                  <Link
                    href="/register"
                    className="rounded-md bg-indigo-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-indigo-500 transition-colors"
                  >
                    Register
                  </Link>
                </div>
              )}
            </div>
          </div>
        </header>
        <div className="flex-1">{children}</div>
      </body>
    </html>
  );
}
