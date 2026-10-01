import type { Metadata } from "next";
import { MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Inbox" };

export default async function Inbox() {
  const supabase = await createClient();

  const { count } = await supabase
    .from("leads")
    .select("id", { count: "exact", head: true })
    .eq("pending_decision", true);

  const needsYou = count ?? 0;

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 md:gap-8 bg-chat p-4 md:p-8 text-center">
      <div className="flex flex-col items-center gap-2 md:gap-3">
        <MessagesSquare
          className="size-8 md:size-10 text-primary"
          aria-hidden
        />
        <h1 className="font-heading text-xl md:text-2xl font-bold">
          Pick a chat
        </h1>
        <p className="max-w-xs md:max-w-sm text-sm md:text-base text-muted-foreground">
          {needsYou > 0
            ? "Chats that need you are at the top of the list. Open one to answer it."
            : "The assistant is handling everything. You will see a chat here when it needs you."}
        </p>
      </div>
    </div>
  );
}
