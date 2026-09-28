import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/SettingsForm";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import { sendMode } from "@/lib/send";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<{
    name: string;
    auto_reply: boolean;
    reply_mode: "auto" | "approve" | null;
    tone_notes: string | null;
    payment_details: string | null;
    wa_phone_number_id: string | null;
  }>(
    supabase,
    user,
    "name, auto_reply, reply_mode, tone_notes, payment_details, wa_phone_number_id",
  );
  if (!business) redirect("/dashboard");

  return (
    <div className="flex-1 min-h-0 w-full overflow-y-auto overflow-x-hidden">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 p-4 pb-24 md:gap-6 sm:p-6 lg:p-8">
        <header>
          <h1 className="font-heading text-2xl md:text-3xl font-bold">
            AI Settings
          </h1>
          <p className="mt-1 md:mt-2 text-sm md:text-lg text-muted-foreground">
            Control what your AI replies with, knows, and sounds like.
          </p>
        </header>
        <SettingsForm
          autoReply={business.auto_reply}
          replyMode={business.reply_mode === "approve" ? "approve" : "auto"}
          toneNotes={business.tone_notes ?? ""}
          paymentDetails={business.payment_details ?? ""}
          testMode={sendMode() === "dry"}
          waConnected={!!business.wa_phone_number_id}
        />
      </div>
    </div>
  );
}
