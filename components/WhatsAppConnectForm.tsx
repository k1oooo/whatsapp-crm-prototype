"use client";

import { useTransition, type FormEvent } from "react";
import {
  CheckCircle2,
  Loader2,
  MessageCircle,
  ShieldQuestion,
} from "lucide-react";
import { toast } from "sonner";
import { saveWhatsAppConnection } from "@/app/dashboard/actions/settings";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { EmbeddedSignupButton } from "@/components/EmbeddedSignupButton";

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
      <Label htmlFor={name} className="text-sm">
        {label}
      </Label>
      <Input
        id={name}
        name={name}
        type="password"
        autoComplete="off"
        placeholder={placeholder}
      />
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 text-xs sm:text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          {hasValue ? (
            <>
              <CheckCircle2
                className="size-3.5 text-primary shrink-0"
                aria-hidden
              />
              Set — leave blank to keep it
            </>
          ) : (
            <>
              <ShieldQuestion className="size-3.5 shrink-0" aria-hidden />
              Not set — using the shared default
            </>
          )}
        </span>
        {hasValue && (
          <label className="flex min-h-11 cursor-pointer items-center gap-2">
            <Checkbox name={`clear_${name}`} />
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
  connectionType,
  embedded,
}: {
  phoneNumberId: string;
  ownerNumber: string;
  hasAppSecret: boolean;
  hasAccessToken: boolean;
  hasVerifyToken: boolean;
  webhookUrl: string | null;
  connectionType: "manual" | "embedded";
  /** Set when this deployment offers the one-click Meta sign-in; null hides it. */
  embedded: { appId: string; configId: string; version: string } | null;
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

  const manualForm = (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
          <div className="flex-1 min-w-0">
            <CardTitle className="flex items-center gap-2 text-lg">
              <MessageCircle className="size-4 shrink-0 text-primary md:size-5" aria-hidden />
              1. Set up your app in Meta
            </CardTitle>
            <CardDescription className="mt-1 text-xs sm:text-sm leading-relaxed">
              In your Meta developer app &gt; WhatsApp &gt; Configuration, paste
              this as the callback URL and subscribe to the{" "}
              <code>messages</code> field. Set any verify token you like —
              either put it in this deployment&apos;s shared{" "}
              <code>WHATSAPP_VERIFY_TOKEN</code>, or save your own below if
              you&apos;re using your own Meta app.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
            <code className="min-w-0 flex-1 break-all rounded-md bg-muted px-3 py-2 text-xs sm:text-sm text-muted-foreground">
              {webhookUrl ?? "Deploy this app first to get a webhook URL"}
            </code>
            <Button
              type="button"
              variant="outline"
              onClick={copyWebhook}
              disabled={!webhookUrl}
              className="shrink-0"
            >
              Copy
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-lg">2. Add your number</CardTitle>
          <CardDescription className="text-xs sm:text-sm">
            From WhatsApp Manager &gt; API Setup, copy the Phone number ID for
            the number you want to use.
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
            <Label htmlFor="wa_owner_number">
              Your own WhatsApp number (optional)
            </Label>
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
          <CardTitle className="text-lg">
            3. Bring your own Meta app (optional)
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm leading-relaxed">
            Skip this if you&apos;re fine sharing this deployment&apos;s Meta
            app with other businesses on it. Fill these in if you&apos;d rather
            use your own app, so your access token and signing secret are never
            shared with anyone else&apos;s number.
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
          <CardTitle className="text-lg">
            4. Go live when you&apos;re ready
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm leading-relaxed">
            Messages are saved here but not sent to WhatsApp until{" "}
            <code>WHATSAPP_SEND_MODE=live</code> is set on the deployment, and a
            valid access token is available — either yours above, or the shared{" "}
            <code>WHATSAPP_ACCESS_TOKEN</code>.
          </CardDescription>
        </CardHeader>
      </Card>

      <div className="sticky bottom-4 z-10 flex justify-end rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur">
        <Button
          type="submit"
          size="lg"
          disabled={pending}
          className="w-full sm:w-auto"
        >
          {pending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );

  if (!embedded) return manualForm;

  const connected = connectionType === "embedded" && !!phoneNumberId;
  return (
    <div className="flex flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <MessageCircle className="size-4 shrink-0 text-primary md:size-5" aria-hidden />
            {connected ? "WhatsApp is connected" : "Connect your WhatsApp number"}
          </CardTitle>
          <CardDescription className="text-xs sm:text-sm leading-relaxed">
            {connected
              ? "Your number is linked through WhatsApp sign-in. Reconnect if you want to switch to a different number."
              : "A Meta window opens where you sign in to Facebook and choose your WhatsApp Business number. You do not need to copy any tokens."}
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <EmbeddedSignupButton
            appId={embedded.appId}
            configId={embedded.configId}
            version={embedded.version}
            reconnect={connected}
          />
          <p className="text-xs text-muted-foreground leading-relaxed">
            Before you can send messages, add a payment method in WhatsApp Manager. A new number also starts
            with a low daily limit that grows as you use it.
          </p>
        </CardContent>
      </Card>

      <details className="group rounded-xl border bg-card p-4" open={connectionType === "manual" && !!phoneNumberId}>
        <summary className="cursor-pointer text-sm font-medium">
          Advanced: use your own Meta app instead
        </summary>
        <div className="mt-4">{manualForm}</div>
      </details>
    </div>
  );
}
