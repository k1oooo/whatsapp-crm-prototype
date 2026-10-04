"use server";

// Reading the chat: search and loading earlier messages.
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { type Msg } from "@/components/chat/chat-thread";

/** Chats whose messages contain the search text. Row level security limits this to the owner's own chats. */
export async function searchMessages(query: string): Promise<string[]> {
  const q = query.trim().slice(0, 80);
  if (q.length < 2) return [];
  const supabase = await createClient();

  // search_leads_by_message (migration 0016) uses a trigram index and returns one row per chat,
  // newest first. Before that migration, fall back to the older scan so search keeps working.
  const { data: ranked, error: rpcError } = await supabase.rpc("search_leads_by_message", { p_query: q, p_limit: 50 });
  if (!rpcError) return ((ranked ?? []) as { lead_id: string }[]).map((r) => r.lead_id);
  log.warn("search.rpc_fallback", {}, rpcError);

  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const { data, error } = await supabase.from("messages").select("lead_id").ilike("body", like).limit(300);
  if (error) {
    log.error("search.failed", {}, error);
    return [];
  }
  return [...new Set((data ?? []).map((r) => r.lead_id as string))];
}

/** Older messages for a chat, for the "Load earlier messages" button. Oldest first. */
export async function loadEarlierMessages(
  leadId: string,
  before: string,
): Promise<{ messages: Msg[]; hasMore: boolean; error?: string }> {
  const PAGE = 100;
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("messages")
    .select("id, direction, body, sent_at, source")
    .eq("lead_id", leadId)
    .lte("sent_at", before)
    .order("sent_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(PAGE + 1);
  if (error) {
    console.error("loadEarlierMessages failed", error.code, error.message);
    return { messages: [], hasMore: false, error: "Could not load earlier messages." };
  }
  const rows = data ?? [];
  return {
    messages: rows.slice(0, PAGE).reverse() as Msg[],
    hasMore: rows.length > PAGE,
  };
}
