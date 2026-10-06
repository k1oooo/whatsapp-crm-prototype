import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { PageHeader, PageShell } from "@/components/app/page-shell";
import { WhatsAppConnectForm } from "@/components/WhatsAppConnectForm";
import { createClient } from "@/lib/supabase/server";
import { getOrCreateBusiness } from "@/lib/business";
import { embeddedSignupConfig } from "@/lib/embedded-signup";

export const metadata: Metadata = { title: "WhatsApp connection" };

export default async function ConnectWhatsAppPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const business = await getOrCreateBusiness<{
    wa_phone_number_id: string | null;
    wa_owner_number: string | null;
    wa_app_secret: string | null;
    wa_access_token: string | null;
    wa_verify_token: string | null;
    wa_connection_type: string | null;
  }>(
    supabase,
    user,
    "wa_phone_number_id, wa_owner_number, wa_app_secret, wa_access_token, wa_verify_token, wa_connection_type",
  );
  if (!business) redirect("/dashboard");

  const h = await headers();
  const proto = h.get("x-forwarded-proto") ?? "https";
  const host = h.get("host");
  const webhookUrl = host ? `${proto}://${host}/api/whatsapp/webhook` : null;

  // Only the public half goes to the browser: the app secret stays on the server.
  const es = embeddedSignupConfig();

  return (
    <PageShell size="form">
      <PageHeader
        title="Connect WhatsApp"
        description="Link your WhatsApp Business number so messages show up here."
      />
      <WhatsAppConnectForm
        phoneNumberId={business.wa_phone_number_id ?? ""}
        ownerNumber={business.wa_owner_number ?? ""}
        // Secret values themselves are never sent to the browser, only whether one is set.
        hasAppSecret={!!business.wa_app_secret}
        hasAccessToken={!!business.wa_access_token}
        hasVerifyToken={!!business.wa_verify_token}
        webhookUrl={webhookUrl}
        connectionType={business.wa_connection_type === "embedded" ? "embedded" : "manual"}
        embedded={es ? { appId: es.appId, configId: es.configId, version: es.version } : null}
      />
    </PageShell>
  );
}
