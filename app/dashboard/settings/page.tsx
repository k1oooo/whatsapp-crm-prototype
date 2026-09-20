import Link from "next/link";
import { redirect } from "next/navigation";
import { SettingsForm } from "@/components/SettingsForm";
import { Shell, displayFont } from "@/components/Shell";
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
    .select("name, auto_reply, business_facts, tone_notes, payment_details")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!business) redirect("/dashboard");

  return (
    <Shell>
      <main className="mx-auto max-w-2xl px-4 py-8 sm:px-6 sm:py-12">
        <Link
          href="/dashboard"
          className="text-sm text-[#55645E] hover:underline focus-visible:outline-2 focus-visible:outline-[#1F7A5C]"
        >
          Back to dashboard
        </Link>
        <h1 className="mt-4 text-3xl font-bold leading-tight tracking-tight sm:text-4xl" style={displayFont}>
          Assistant settings
        </h1>
        <p className="mt-2 text-[#55645E]">{business.name}</p>

        {sendMode() === "dry" && (
          <p className="mt-6 rounded-lg bg-[#FBEBD0] px-4 py-3 text-sm text-[#8A5000]">
            Test mode: replies are saved in the conversation but not sent to WhatsApp. Set
            WHATSAPP_SEND_MODE=live and WHATSAPP_ACCESS_TOKEN to send for real.
          </p>
        )}

        <div className="mt-8">
          <SettingsForm
            autoReply={business.auto_reply}
            facts={business.business_facts ?? ""}
            toneNotes={business.tone_notes ?? ""}
            paymentDetails={business.payment_details ?? ""}
          />
        </div>
      </main>
    </Shell>
  );
}
