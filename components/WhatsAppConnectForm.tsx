"use client";

import { useTransition, type FormEvent } from "react";
import { CheckCircle2, Loader2, MessageCircle, ShieldQuestion } from "lucide-react";
import { toast } from "sonner";
import { saveWhatsAppConnection } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/** A secret field that never shows its real value: blank on load, with a status line saying
 * whether one is already saved, and a "remove it" checkbox to fall back to the shared default. */
function SecretField({
  name,
  label,
  hasValue,
  placeholder,
}: {
  name: string;
  label: string;
  hasValue: boolean;
  placeholder: string;
}) {
  return (
    <div className="grid gap-1.5">
      <Label htmlFor={name}>{label}</Label>
      <Input id={name} name={name} type="password" autoComplete="off" placeholder={placeholder} />
      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {hasValue ? (
            <>
              <CheckCircle2 className="size-3.5 text-primary" aria-hidden />
              Set — leave blank to keep it
            </>
          ) : (
            <>
              <ShieldQuestion className="size-3.5" aria-hidden />
              Not set — using the shared default
            </>
          )}
        </span>
        {hasValue && (
          <label className="flex items-center gap-1.5">
            <input type="checkbox" name={`clear_${name}`} className="size-3.5" />
            Remove
          </label>
        )}
      </div>
    </div>
  );
}

export function WhatsAppConnectForm({
  phoneNumberId,
  ownerNumber,
  hasAppSecret,
  hasAccessToken,
  hasVerifyToken,
  webhookUrl,
}: {
  phoneNumberId: string;
  ownerNumber: string;
  hasAppSecret: boolean;
  hasAccessToken: boolean;
  hasVerifyToken: boolean;
  webhookUrl: string | null;
}) {
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveWhatsAppConnection({}, data);
      if (res.error) toast.error(res.error);
      else toast.success("Saved");
    });
  }

  function copyWebhook() {
    if (!webhookUrl) return;
    navigator.clipboard.writeText(webhookUrl);
    toast.success("Copied");
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <MessageCircle className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <CardTitle>1. Set up your app in Meta</CardTitle>
            <CardDescription className="mt-1">
              In your Meta developer app &gt; WhatsApp &gt; Configuration, paste this as the
              callback URL and subscribe to the <code>messages</code> field. Set any verify token
              you like — either put it in this deployment&apos;s shared{" "}
              <code>WHATSAPP_VERIFY_TOKEN</code>, or save your own below if you&apos;re using your
              own Meta app.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-md bg-muted px-3 py-2 text-sm">
              {webhookUrl ?? "Deploy this app first to get a webhook URL"}
            </code>
            <Button type="button" variant="outline" onClick={copyWebhook} disabled={!webhookUrl}>
              Copy
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>2. Add your number</CardTitle>
          <CardDescription>
            From WhatsApp Manager &gt; API Setup, copy the Phone number ID for the number you want
            to use.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="wa_phone_number_id">Phone number ID</Label>
            <Input
              id="wa_phone_number_id"
              name="wa_phone_number_id"
              defaultValue={phoneNumberId}
              required
              placeholder="109876543212345"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="wa_owner_number">Your own WhatsApp number (optional)</Label>
            <Input
              id="wa_owner_number"
              name="wa_owner_number"
              defaultValue={ownerNumber}
              placeholder="60123456789"
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>3. Bring your own Meta app (optional)</CardTitle>
          <CardDescription>
            Skip this if you&apos;re fine sharing this deployment&apos;s Meta app with other
            businesses on it. Fill these in if you&apos;d rather use your own app, so your access
            token and signing secret are never shared with anyone else&apos;s number.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <SecretField
            name="wa_verify_token"
            label="Verify token"
            hasValue={hasVerifyToken}
            placeholder="Whatever you set as the callback verify token"
          />
          <SecretField
            name="wa_app_secret"
            label="App secret"
            hasValue={hasAppSecret}
            placeholder="From Meta app > Settings > Basic"
          />
          <SecretField
            name="wa_access_token"
            label="Access token"
            hasValue={hasAccessToken}
            placeholder="A permanent token from WhatsApp Manager > API Setup"
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>4. Go live when you&apos;re ready</CardTitle>
          <CardDescription>
            Messages are saved here but not sent to WhatsApp until <code>WHATSAPP_SEND_MODE=live</code>{" "}
            is set on the deployment, and a valid access token is available — either yours above,
            or the shared <code>WHATSAPP_ACCESS_TOKEN</code>.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur">
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}
