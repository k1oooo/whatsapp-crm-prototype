import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { WhatsAppConnectForm } from "@/components/WhatsAppConnectForm";
import { createClient } from "@/lib/supabase/server";

export default async function ConnectWhatsAppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: business } = await supabase
    .from("businesses")
    .select("wa_phone_number_id, wa_owner_number, wa_app_secret, wa_access_token, wa_verify_token")
    .eq("owner_id", user.id)
    .maybeSingle();
  if (!business) redirect("/dashboard");

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host");
  const webhookUrl = host ? `${proto}://${host}/api/whatsapp/webhook` : null;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header>
        <h1 className="font-heading text-3xl font-bold">Connect WhatsApp</h1>
        <p className="mt-2 text-lg text-muted-foreground">
          Link your WhatsApp Business number so messages show up here.
        </p>
      </header>
      <WhatsAppConnectForm
        phoneNumberId={business.wa_phone_number_id ?? ""}
        ownerNumber={business.wa_owner_number ?? ""}
        // Secret values themselves are never sent to the browser — only whether one is set.
        hasAppSecret={!!business.wa_app_secret}
        hasAccessToken={!!business.wa_access_token}
        hasVerifyToken={!!business.wa_verify_token}
        webhookUrl={webhookUrl}
      />
    </div>
  );
}
