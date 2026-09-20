import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/SettingsForm";
import { AssistantToggle } from "@/components/app/assistant-toggle";
import { createClient } from "@/lib/supabase/server";
import { sendMode } from "@/lib/send";
import { Card, CardContent } from "@/components/ui/card";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("name, auto_reply, business_facts, tone_notes, payment_details")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!business) redirect("/dashboard");

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-8 p-4 sm:p-6">
      {/* Page Header */}
      <header className="flex flex-col gap-1">
        <h1 className="font-heading text-3xl font-bold tracking-tight text-foreground">
          Settings
        </h1>
        <p className="text-muted-foreground">
          Manage your AI assistant and business preferences for{" "}
          <span className="font-medium text-foreground">{business.name}</span>.
        </p>
      </header>

      {/* Assistant Toggle Card */}
      <Card>
        <CardContent className="py-6">
          <AssistantToggle initial={business.auto_reply} collapsed={false} />
        </CardContent>
      </Card>

      {/* Knowledge Base Form */}
      <div className="flex flex-col gap-4">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold tracking-tight">
            Knowledge Base
          </h2>
          <p className="text-sm text-muted-foreground">
            Train your assistant on your rules, tone, and payment instructions.
          </p>
        </div>
        <SettingsForm
          facts={business.business_facts ?? ""}
          toneNotes={business.tone_notes ?? ""}
          paymentDetails={business.payment_details ?? ""}
          testMode={sendMode() === "dry"}
        />
      </div>
    </div>
  );
}
