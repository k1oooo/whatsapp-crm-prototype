import { MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export default async function Inbox() {
  const supabase = await createClient();

  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("pending_decision", true);

  const needsYou = count ?? 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-8 bg-chat p-8 text-center">
      <div className="flex flex-col items-center gap-3">
        <span className="flex size-14 items-center justify-center rounded-2xl bg-card shadow-xs">
          <MessagesSquare className="size-7 text-primary" aria-hidden />
        </span>
        <h1 className="font-heading text-2xl font-bold">Pick a chat</h1>
        <p className="max-w-sm text-muted-foreground">
          {needsYou > 0
            ? "Chats that need you are at the top of the list. Open one to answer it."
            : "The assistant is handling everything. You will see a chat here when it needs you."}
        </p>
      </div>
    </div>
  );
}
