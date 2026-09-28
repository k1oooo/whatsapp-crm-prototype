import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Every owner's business row is created lazily on their first dashboard visit (see
 * app/dashboard/layout.tsx), not at signup. Every server page under /dashboard needs to look
 * that row up by owner_id, so this is the one place that does it — including the "row doesn't
 * exist yet, make it" fallback — instead of each page hand-rolling its own lookup and bailing
 * out to redirect("/dashboard") the moment it comes back empty.
 *
 * That per-page duplication was the cause of a real bug: pages other than the dashboard layout
 * itself (pipeline, AI settings, knowledge, follow-ups, WhatsApp settings) had no fallback, so a
 * business row that hadn't been created yet — or a request that raced the layout's own
 * create-on-first-visit logic — sent the owner straight back to /dashboard on every click,
 * looking like those pages were simply broken.
 */
export async function getOrCreateBusiness<T>(
  supabase: SupabaseClient,
  user: User,
  columns: string,
): Promise<T | null> {
  const { data: business } = await supabase
    .from("businesses")
    .select(columns)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (business) return business as unknown as T;

  const name = (user.user_metadata?.business_name as string | undefined)?.trim() || "My business";
  // The 14-day trial row is created by a database trigger on this insert (migration 0012), not
  // here: an owner is deliberately not allowed to insert into subscriptions themselves.
  const { data: created, error } = await supabase
    .from("businesses")
    .insert({ owner_id: user.id, name })
    .select(columns)
    .single();
  if (created) return created as unknown as T;

  if (error?.code === "23505") {
    // Another request for the same owner (a double click, two open tabs, a link prefetch that
    // raced this one) created the row a moment ago. Read it back instead of failing.
    const { data: again } = await supabase
      .from("businesses")
      .select(columns)
      .eq("owner_id", user.id)
      .maybeSingle();
    return (again as unknown as T) ?? null;
  }

  return null;
}
