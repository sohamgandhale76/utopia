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
