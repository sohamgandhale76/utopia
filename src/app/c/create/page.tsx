import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentUser } from "@/features/auth/session";
import { CreateCommunityForm } from "@/features/communities/components/create-community-form";

export const metadata = {
  title: "Create a Community | Utopia",
  description: "Create a new pseudonymous community on Utopia.",
};

export default async function CreateCommunityPage() {
  const user = await getCurrentUser();

  if (!user) {
    redirect("/login");
  }

  return (
    <main className="min-h-screen px-4 py-8 md:px-8 max-w-2xl mx-auto">
      {/* Header */}
      <div className="mb-8 border-b border-zinc-800 pb-6">
        <div className="flex items-center gap-2 mb-2">
          <Link
            href="/c"
            className="text-xs font-medium text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            ← Communities
          </Link>
          <span className="text-zinc-600">/</span>
          <span className="text-xs font-semibold uppercase tracking-wider text-indigo-400">
            Create
          </span>
        </div>
        <h1 className="text-3xl font-bold tracking-tight text-white">
          Create a Community
        </h1>
        <p className="mt-1 text-sm text-zinc-400">
          Set up a new pseudonymous community. As the creator, you will automatically become the initial OWNER.
        </p>
      </div>

      {/* Interactive Form */}
      <CreateCommunityForm />
    </main>
  );
}
