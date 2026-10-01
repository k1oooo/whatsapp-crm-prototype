"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import {
  Loader2,
  Megaphone,
  MessageSquareText,
  RefreshCw,
  Send,
  Star,
} from "lucide-react";
import { toast } from "sonner";
import {
  saveFollowUpSettings,
  sendBroadcast,
  sendPromotionTest,
} from "@/app/dashboard/follow-ups/actions";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { FollowUpSettings } from "@/lib/follow-up-settings";

function TestModeNote({ testMode }: { testMode: boolean }) {
  if (!testMode) return null;
  return (
    <p className="rounded-lg bg-warning px-4 py-3 text-sm text-warning-foreground">
      Test mode: messages are saved in the chat but not sent to WhatsApp.
    </p>
  );
}

export function AutomationsForm({
  settings,
  testMode,
}: {
  settings: FollowUpSettings;
  testMode: boolean;
}) {
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveFollowUpSettings({}, data);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Follow-up settings saved");
        setDirty(false);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      onChange={() => setDirty(true)}
      onInput={() => setDirty(true)}
      className="flex max-w-3xl flex-col gap-6"
    >
      <TestModeNote testMode={testMode} />

      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <MessageSquareText className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <CardTitle>Ask for feedback</CardTitle>
            <CardDescription className="mt-1">
              After an order is paid, ask the customer to rate it. Happy
              customers get your review link. Unhappy ones come to you.
            </CardDescription>
          </div>
          <Switch
            name="feedback_enabled"
            defaultChecked={settings.feedback.enabled}
            aria-label="Ask for feedback"
          />
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5 sm:max-w-56">
            <Label htmlFor="feedback_delay">
              Days after pickup or delivery
            </Label>
            <Input
              id="feedback_delay"
              name="feedback_delay"
              type="number"
              min={0}
              max={60}
              defaultValue={settings.feedback.delayDays}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="feedback_text">Message</Label>
            <Textarea
              id="feedback_text"
              name="feedback_text"
              rows={4}
              defaultValue={settings.feedback.text}
            />
          </div>
          <details className="group rounded-lg border border-dashed px-3 py-2">
            <summary className="flex min-h-9 cursor-pointer items-center text-sm font-medium text-muted-foreground">
              Advanced: WhatsApp template
            </summary>
            <div className="grid gap-1.5 pb-2 pt-2">
              <Label htmlFor="feedback_template">WhatsApp template name</Label>
              <Input
                id="feedback_template"
                name="feedback_template"
                defaultValue={settings.feedback.templateName}
                placeholder="feedback_request"
              />
              <p className="text-sm text-muted-foreground">
                Only needed to message customers who have not written to you in the last 24 hours.
                See &quot;How this works&quot; below.
              </p>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <RefreshCw className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <CardTitle>Remind them to reorder</CardTitle>
            <CardDescription className="mt-1">
              A friendly nudge some weeks after their order. If they reply, the
              assistant takes the new order.
            </CardDescription>
          </div>
          <Switch
            name="reorder_enabled"
            defaultChecked={settings.reorder.enabled}
            aria-label="Remind them to reorder"
          />
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5 sm:max-w-56">
            <Label htmlFor="reorder_after">Days after pickup or delivery</Label>
            <Input
              id="reorder_after"
              name="reorder_after"
              type="number"
              min={1}
              max={365}
              defaultValue={settings.reorder.afterDays}
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="reorder_text">Message</Label>
            <Textarea
              id="reorder_text"
              name="reorder_text"
              rows={4}
              defaultValue={settings.reorder.text}
            />
          </div>
          <details className="group rounded-lg border border-dashed px-3 py-2">
            <summary className="flex min-h-9 cursor-pointer items-center text-sm font-medium text-muted-foreground">
              Advanced: WhatsApp template
            </summary>
            <div className="grid gap-1.5 pb-2 pt-2">
              <Label htmlFor="reorder_template">WhatsApp template name</Label>
              <Input
                id="reorder_template"
                name="reorder_template"
                defaultValue={settings.reorder.templateName}
                placeholder="reorder_reminder"
              />
              <p className="text-sm text-muted-foreground">
                Only needed to message customers who have not written to you in the last 24 hours.
                See &quot;How this works&quot; below.
              </p>
            </div>
          </details>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <Star className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <CardTitle>Review link and template language</CardTitle>
            <CardDescription className="mt-1">
              The review link (for example your Google Maps review page) is sent
              to customers who rate you 4 or 5.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-[1fr_8rem]">
          <div className="grid gap-1.5">
            <Label htmlFor="review_link">Review link</Label>
            <Input
              id="review_link"
              name="review_link"
              type="url"
              defaultValue={settings.reviewLink}
              placeholder="https://g.page/r/..."
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="language">Template language</Label>
            <Input
              id="language"
              name="language"
              defaultValue={settings.language}
              placeholder="ms"
            />
          </div>
        </CardContent>
      </Card>

      <Card className="bg-muted/60">
        <CardContent className="space-y-2 text-sm text-muted-foreground">
          <p className="font-semibold text-foreground">How this works</p>
          <p>
            <strong className="text-foreground">Templates.</strong> WhatsApp
            only lets a business start a chat with a template that Meta has
            approved. Create a template with the same text in WhatsApp Manager
            and type its name above. In the message, {"{{1}}"} is the
            customer&apos;s first name, {"{{2}}"} is what they ordered and{" "}
            {"{{3}}"} is your review link. Template messages are charged per
            message by Meta.
          </p>
          <p>
            <strong className="text-foreground">Agreement.</strong> Customers
            only get follow-ups after they agree. The payment confirmation asks
            them to reply YA, and STOP always works. You can also switch it on
            for a customer in their Details.
          </p>
          <p>
            <strong className="text-foreground">Timing.</strong> Follow-ups go
            out at 10am Malaysia time, and never at night.
          </p>
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex items-center justify-end gap-3 rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur">
        {dirty && (
          <p role="status" className="text-sm font-medium text-muted-foreground">
            You have unsaved changes
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save
        </Button>
      </div>
    </form>
  );
}

export function BroadcastForm({
  audience,
  testMode,
}: {
  audience: number;
  testMode: boolean;
}) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);
  const [text, setText] = useState("");
  const [testing, setTesting] = useState(false);
  const formRef = useRef<HTMLFormElement>(null);

  async function sendTest() {
    if (!formRef.current) return;
    setTesting(true);
    const res = await sendPromotionTest({}, new FormData(formRef.current));
    setTesting(false);
    if (res.error) toast.error(res.error);
    else toast.success("Test sent to your number", { description: res.notice });
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!confirming) {
      setConfirming(true);
      return;
    }
    const data = new FormData(e.currentTarget);
    start(async () => {
      const res = await sendBroadcast({}, data);
      setConfirming(false);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Promotion queued", { description: res.notice });
        setText("");
      }
    });
  }

  return (
    <form ref={formRef} onSubmit={submit} className="flex max-w-3xl flex-col gap-6">
      <TestModeNote testMode={testMode} />
      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <Megaphone className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <CardTitle>Send a promotion</CardTitle>
            <CardDescription className="mt-1">
              Goes to customers who have paid for an order and agreed to receive
              offers. {audience}{" "}
              {audience === 1 ? "customer is" : "customers are"} ready to
              receive it.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-1.5">
            <Label htmlFor="campaign">Name (only for you)</Label>
            <Input
              id="campaign"
              name="campaign"
              placeholder="Hari Raya cookies"
            />
          </div>
          <div className="grid gap-1.5">
            <Label htmlFor="text">Message</Label>
            <Textarea
              id="text"
              name="text"
              rows={5}
              required
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setConfirming(false);
              }}
              placeholder={
                "Hi {{1}}, tempahan Hari Raya dah dibuka! Order sebelum 20 Mac dapat free delivery. Balas mesej ini untuk order. Balas STOP untuk berhenti."
              }
            />
            <p className="text-sm text-muted-foreground">
              {"{{1}}"} becomes the customer&apos;s first name. Always end with
              how to stop, like &quot;Balas STOP untuk berhenti&quot;.
            </p>
          </div>
          <details className="group rounded-lg border border-dashed px-3 py-2">
            <summary className="flex min-h-9 cursor-pointer items-center text-sm font-medium text-muted-foreground">
              Advanced: WhatsApp template
            </summary>
            <div className="grid gap-1.5 pb-2 pt-2">
              <Label htmlFor="template">WhatsApp template name</Label>
              <Input id="template" name="template" placeholder="promo_hari_raya" />
              <p className="text-sm text-muted-foreground">
                WhatsApp only delivers a promotion to customers who have not written to you in the last
                24 hours through a template Meta has approved. Type its name here.
              </p>
            </div>
          </details>
        </CardContent>

        {/* Replaced CardFooter with a div that has matching padding */}
        <div className="flex flex-col gap-3 items-stretch p-6 pt-0">
          <Button
            type="submit"
            size="lg"
            className="w-full"
            disabled={pending || audience === 0}
          >
            {pending ? <Loader2 className="animate-spin" /> : <Send />}
            {confirming
              ? `Yes, send to ${audience} ${audience === 1 ? "customer" : "customers"}`
              : "Review and send"}
          </Button>
          {confirming && !pending && (
            <Button
              type="button"
              variant="ghost"
              className="w-full"
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          )}
          <Button
            type="button"
            variant="outline"
            className="w-full"
            disabled={pending || testing || !text.trim()}
            onClick={sendTest}
          >
            {testing ? <Loader2 className="animate-spin" /> : <Send />}
            Send a test to my own number
          </Button>
          {audience === 0 && (
            <p className="text-sm text-center text-muted-foreground">
              No one has agreed to offers yet. Customers agree by replying YA to
              the payment confirmation.
            </p>
          )}
        </div>
      </Card>
    </form>
  );
}
