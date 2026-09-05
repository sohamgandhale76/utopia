import { Metadata } from "next";
import Link from "next/link";
import { searchCommunities, searchPosts, searchUsers } from "@/features/search/service";
import { searchQuerySchema } from "@/features/search/validation";
import { redirect } from "next/navigation";

export const metadata: Metadata = {
  title: "Search | Utopia",
};

interface SearchPageProps {
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const params = await searchParams;
  const rawQ = typeof params.q === "string" ? params.q : "";
  const rawType = typeof params.type === "string" ? params.type : "ALL";
  const rawCursor = typeof params.cursor === "string" ? params.cursor : undefined;

  const parsed = searchQuerySchema.safeParse({
    q: rawQ,
    type: rawType,
    cursor: rawCursor,
  });

  if (!parsed.success || parsed.data.q.length < 2) {
    return (
      <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">Search</h1>
        <p className="mt-2 text-sm text-zinc-400">
          Enter a search query of at least 2 characters.
        </p>
      </main>
    );
  }

  const { q, type, limit, cursor } = parsed.data;

  // Perform parallel fetching based on type
  const [communities, postsResult, users] = await Promise.all([
    type === "ALL" || type === "COMMUNITIES"
      ? searchCommunities(q, limit)
      : Promise.resolve([]),
    type === "ALL" || type === "POSTS"
      ? searchPosts(q, undefined, limit, cursor)
      : Promise.resolve({ posts: [], nextCursor: undefined }),
    type === "ALL" || type === "USERS"
      ? searchUsers(q, limit)
      : Promise.resolve([]),
  ]);

  const { posts, nextCursor } = postsResult;

  // Tabs for navigation
  const tabs = [
    { id: "ALL", label: "All Results" },
    { id: "COMMUNITIES", label: "Communities" },
    { id: "POSTS", label: "Posts" },
    { id: "USERS", label: "Users" },
  ];

  return (
    <main className="mx-auto max-w-4xl px-4 py-8 sm:px-6">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight text-zinc-100">
          Search Results for "{q}"
        </h1>
      </div>

      <div className="mb-6 border-b border-zinc-800">
        <nav className="-mb-px flex space-x-6">
          {tabs.map((tab) => {
            const isActive = type === tab.id;
            return (
              <Link
                key={tab.id}
                href={`/search?q=${encodeURIComponent(q)}&type=${tab.id}`}
                className={`whitespace-nowrap border-b-2 px-1 pb-4 text-sm font-medium ${
                  isActive
                    ? "border-indigo-500 text-indigo-400"
                    : "border-transparent text-zinc-400 hover:border-zinc-700 hover:text-zinc-300"
                }`}
              >
                {tab.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="space-y-10">
        {/* Communities Section */}
        {(type === "ALL" || type === "COMMUNITIES") && (
          <section>
            <h2 className="mb-4 text-lg font-semibold text-zinc-200">Communities</h2>
            {communities.length === 0 ? (
              <p className="text-sm text-zinc-500">No communities found.</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-2">
                {communities.map((comm) => (
                  <li
                    key={comm.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:bg-zinc-800/50"
                  >
                    <Link href={`/c/${comm.slug}`} className="block">
                      <div className="font-semibold text-zinc-100">c/{comm.slug}</div>
                      <div className="text-sm text-zinc-400">{comm.name}</div>
                      <div className="mt-2 text-xs text-zinc-500">
                        {comm._count.memberships} member{comm._count.memberships !== 1 && "s"}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Users Section */}
        {(type === "ALL" || type === "USERS") && (
          <section>
            <h2 className="mb-4 text-lg font-semibold text-zinc-200">Users</h2>
            {users.length === 0 ? (
              <p className="text-sm text-zinc-500">No users found.</p>
            ) : (
              <ul className="grid gap-4 sm:grid-cols-3">
                {users.map((u) => (
                  <li
                    key={u.username}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4 transition-colors hover:bg-zinc-800/50"
                  >
                    <Link href={`/u/${u.username}`} className="block">
                      <div className="font-medium text-zinc-200">u/{u.username}</div>
                      <div className="mt-1 text-xs text-zinc-500">
                        Joined {new Date(u.createdAt).toLocaleDateString()}
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Posts Section */}
        {(type === "ALL" || type === "POSTS") && (
          <section>
            <h2 className="mb-4 text-lg font-semibold text-zinc-200">Posts</h2>
            {posts.length === 0 ? (
              <p className="text-sm text-zinc-500">No posts found.</p>
            ) : (
              <div className="space-y-4">
                <ul className="space-y-4">
                  {posts.map((post) => (
                    <li
                      key={post.id}
                      className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-4"
                    >
                      {/* We only have communityId from the search results per strictly publicPostSelect, 
                          but we can link directly to the post if we know its community slug. 
                          Wait, the current routing /c/[slug]/post/[postId] requires community slug.
                          We don't have community slug in the returned posts per spec!
                          We'll just display the post title and author, and maybe link to author profile.
                      */}
                      <div className="mb-2 text-xs text-zinc-500">
                        Posted by{" "}
                        <Link
                          href={`/u/${post.author.username}`}
                          className="font-medium text-indigo-400 hover:underline"
                        >
                          u/{post.author.username}
                        </Link>
                        {" "}• {new Date(post.createdAt).toLocaleDateString()}
                      </div>
                      <h3 className="text-base font-semibold text-zinc-200">
                        {post.title}
                      </h3>
                      <p className="mt-1 line-clamp-3 text-sm text-zinc-400">
                        {post.body}
                      </p>
                    </li>
                  ))}
                </ul>
                
                {nextCursor && (
                  <div className="mt-6 flex justify-center">
                    <Link
                      href={`/search?q=${encodeURIComponent(q)}&type=${type}&cursor=${encodeURIComponent(nextCursor)}`}
                      className="rounded-md border border-zinc-700 bg-zinc-800 px-4 py-2 text-sm font-medium text-zinc-300 hover:bg-zinc-700 transition-colors"
                    >
                      Load More Posts
                    </Link>
                  </div>
                )}
              </div>
            )}
          </section>
        )}
      </div>
    </main>
  );
}
