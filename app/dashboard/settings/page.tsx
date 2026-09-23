import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/SettingsForm";
import { createClient } from "@/lib/supabase/server";
import { sendMode } from "@/lib/send";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("name, auto_reply, tone_notes, payment_details")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!business) redirect("/dashboard");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-3xl font-bold">Assistant settings</h1>
        <p className="mt-1 text-muted-foreground">{business.name}</p>
      </header>
      <SettingsForm
        autoReply={business.auto_reply}
        toneNotes={business.tone_notes ?? ""}
        paymentDetails={business.payment_details ?? ""}
        testMode={sendMode() === "dry"}
      />
    </div>
  );
}
