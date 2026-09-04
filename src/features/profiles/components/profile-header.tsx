import Link from "next/link";
import { formatDistanceToNow, format } from "date-fns";
import { ProfileTab } from "../validation";

interface ProfileHeaderProps {
  username: string;
  createdAt: Date;
  activeTab: ProfileTab;
}

export function ProfileHeader({
  username,
  createdAt,
  activeTab,
}: ProfileHeaderProps) {
  const createdDate = new Date(createdAt);
  const joinedRelative = formatDistanceToNow(createdDate, { addSuffix: true });
  const joinedAbsolute = format(createdDate, "MMMM d, yyyy");

  return (
    <div className="border-b border-zinc-800 pb-6 mb-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6">
        <div className="flex items-center gap-4">
          <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500/20 to-purple-500/20 border border-indigo-500/30 text-2xl text-indigo-400 font-mono font-bold shadow-inner">
            {username.slice(0, 2).toUpperCase()}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold tracking-tight text-white font-mono">
                u/{username}
              </h1>
              <span className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs font-medium text-zinc-400">
                Pseudonymous
              </span>
            </div>
            <p className="mt-1 text-xs text-zinc-500" title={joinedAbsolute}>
              Joined {joinedRelative}
            </p>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex items-center gap-2 border-b border-zinc-800/80 -mb-6">
        <Link
          href={`/u/${username}?tab=posts`}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "posts"
              ? "border-indigo-500 text-white"
              : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
          }`}
        >
          Posts
        </Link>
        <Link
          href={`/u/${username}?tab=comments`}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors ${
            activeTab === "comments"
              ? "border-indigo-500 text-white"
              : "border-transparent text-zinc-400 hover:text-zinc-200 hover:border-zinc-700"
          }`}
        >
          Comments
        </Link>
      </div>
    </div>
  );
}
