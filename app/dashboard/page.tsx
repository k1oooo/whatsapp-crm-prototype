import { Banknote, CircleCheck, Hourglass, MessagesSquare } from "lucide-react";
import { createClient } from "@/lib/supabase/server";

// Shown on large screens when no chat is open: what needs you, at a glance.
export default async function InboxHome() {
  const supabase = await createClient();
  const { data } = await supabase.from("leads").select("pending_decision, order_status, stage");
  const rows = data ?? [];

  const needsYou = rows.filter((r) => r.pending_decision).length;
  const waiting = rows.filter((r) => r.order_status === "confirmed").length;
  const paid = rows.filter((r) => r.order_status === "paid").length;

  const tiles = [
    { label: "Need you", value: needsYou, icon: Hourglass, tone: "bg-warning text-warning-foreground" },
    { label: "Waiting for payment", value: waiting, icon: Banknote, tone: "bg-info text-info-foreground" },
    { label: "Paid orders", value: paid, icon: CircleCheck, tone: "bg-success text-success-foreground" },
  ];

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

      <ul className="grid w-full max-w-xl grid-cols-3 gap-3">
        {tiles.map(({ label, value, icon: Icon, tone }) => (
          <li key={label} className="rounded-xl border bg-card p-4">
            <span className={`mx-auto flex size-9 items-center justify-center rounded-lg ${tone}`}>
              <Icon className="size-5" aria-hidden />
            </span>
            <p className="mt-2 font-heading text-3xl font-bold">{value}</p>
            <p className="text-sm text-muted-foreground">{label}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}
