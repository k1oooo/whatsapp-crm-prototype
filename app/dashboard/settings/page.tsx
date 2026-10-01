import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader, PageShell } from "@/components/app/page-shell";
import { SettingsForm } from "@/components/SettingsForm";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import { sendMode } from "@/lib/send";

export const metadata: Metadata = { title: "AI Settings" };

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
    <PageShell size="form">
      <PageHeader
        title="AI Settings"
        description="Control what your AI replies with, knows, and sounds like."
      />
      <SettingsForm
        autoReply={business.auto_reply}
        replyMode={business.reply_mode === "approve" ? "approve" : "auto"}
        toneNotes={business.tone_notes ?? ""}
        paymentDetails={business.payment_details ?? ""}
        testMode={sendMode() === "dry"}
        waConnected={!!business.wa_phone_number_id}
      />
    </PageShell>
  );
}
