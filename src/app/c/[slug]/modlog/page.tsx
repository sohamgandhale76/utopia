import { notFound } from "next/navigation";
import Link from "next/link";
import { getPublicCommunity } from "@/features/communities/service";
import { getCommunityModLog, PublicModLogEntry } from "@/features/moderation/service";
import { ModActionType } from "@prisma/client";

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps) {
  const { slug } = await params;
  try {
    const community = await getPublicCommunity(slug);
    return {
      title: `Moderation Transparency Log — ${community.name} | Insta-pro`,
      description: `Public moderation audit trail for c/${community.slug}. All moderation actions are transparent and explainable.`,
    };
  } catch {
    return {
      title: "Moderation Log Not Found | Insta-pro",
    };
  }
}

function getActionBadgeStyle(actionType: ModActionType) {
  switch (actionType) {
    case ModActionType.REMOVE_POST:
    case ModActionType.REMOVE_COMMENT:
      return "border-rose-500/30 bg-rose-500/10 text-rose-400";
    case ModActionType.ISSUE_SANCTION:
      return "border-amber-500/30 bg-amber-500/10 text-amber-400";
    case ModActionType.REVOKE_SANCTION:
      return "border-emerald-500/30 bg-emerald-500/10 text-emerald-400";
    case ModActionType.DISMISS_REPORT:
      return "border-zinc-500/30 bg-zinc-500/10 text-zinc-400";
    default:
      return "border-zinc-500/30 bg-zinc-500/10 text-zinc-300";
  }
}

export default async function CommunityModLogPage({ params }: PageProps) {
  const { slug } = await params;

  let community;
  try {
    community = await getPublicCommunity(slug);
  } catch {
    notFound();
  }

  const logs: PublicModLogEntry[] = await getCommunityModLog(slug, 50);

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 max-w-4xl mx-auto">
      {/* Breadcrumb Navigation */}
      <nav className="flex items-center gap-2 text-xs text-zinc-500 mb-6">
        <Link href="/" className="hover:text-zinc-300 transition-colors">
          Home
        </Link>
        <span>/</span>
        <Link href="/c" className="hover:text-zinc-300 transition-colors">
          Communities
        </Link>
        <span>/</span>
        <Link href={`/c/${community.slug}`} className="font-mono text-zinc-400 hover:text-zinc-200">
          c/{community.slug}
        </Link>
        <span>/</span>
        <span className="font-mono text-indigo-400">modlog</span>
      </nav>

      {/* Header */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-6 shadow-xl backdrop-blur-sm mb-8">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold tracking-tight text-white">
                Moderation Log
              </h1>
              <span className="rounded-md border border-indigo-500/30 bg-indigo-500/10 px-2 py-0.5 font-mono text-xs font-medium text-indigo-300">
                /c/{community.slug}/modlog
              </span>
            </div>
            <p className="mt-2 text-xs text-zinc-400 max-w-2xl leading-relaxed">
              Public audit trail of all moderation actions in {community.name}. Every action includes the acting moderator&apos;s username and an explainable public rationale. Private reporter data and internal notes are never exposed.
            </p>
          </div>
          <Link
            href={`/c/${community.slug}`}
            className="self-start sm:self-auto rounded-lg border border-zinc-800 bg-zinc-950 px-3 py-1.5 text-xs font-medium text-zinc-300 hover:border-zinc-700 hover:text-white transition-colors"
          >
            ← Back to Community
          </Link>
        </div>
      </div>

      {/* Mod Actions Table / Feed */}
      {logs.length === 0 ? (
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-900/30 p-12 text-center">
          <p className="text-sm text-zinc-400">No moderation actions recorded in this community yet.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {logs.map((log) => (
            <div
              key={log.id}
              className="rounded-xl border border-zinc-800/80 bg-zinc-900/40 p-4 transition-colors hover:border-zinc-750"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 pb-2 border-b border-zinc-800/50">
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-md border px-2 py-0.5 font-mono text-[10px] font-semibold uppercase ${getActionBadgeStyle(
                      log.actionType
                    )}`}
                  >
                    {log.actionType.replace("_", " ")}
                  </span>
                  <span className="text-xs text-zinc-400">
                    by{" "}
                    <span className="font-mono font-medium text-zinc-200">
                      @{log.moderatorUsername}
                    </span>
                  </span>
                </div>
                <time
                  dateTime={log.createdAt.toISOString()}
                  className="text-[11px] text-zinc-500 font-mono"
                >
                  {new Date(log.createdAt).toLocaleString(undefined, {
                    month: "short",
                    day: "numeric",
                    year: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </time>
              </div>

              <div className="mt-3">
                <p className="text-xs text-zinc-200 leading-relaxed font-medium">
                  {log.reason}
                </p>
                {log.targetDescription && (
                  <p className="mt-1 text-[11px] text-zinc-400 font-mono">
                    Target: {log.targetDescription}
                  </p>
                )}
                {log.sanctionExpiresAt && (
                  <p className="mt-0.5 text-[11px] text-amber-400/80 font-mono">
                    Expires: {new Date(log.sanctionExpiresAt).toLocaleDateString()}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
