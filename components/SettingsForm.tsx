"use client";

import Link from "next/link";
import { useState, useTransition, type FormEvent } from "react";
import { ArrowRight, Bot, BookOpen, Landmark, Loader2, MessageCircle } from "lucide-react";
import { toast } from "sonner";
import { saveSettings, toggleAutoReply } from "@/app/dashboard/actions";
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
import { RadioCard } from "@/components/ui/radio-card";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";

export function SettingsForm({
  autoReply,
  replyMode,
  toneNotes,
  paymentDetails,
  testMode,
  waConnected,
}: {
  autoReply: boolean;
  replyMode: "auto" | "approve";
  toneNotes: string;
  paymentDetails: string;
  testMode: boolean;
  waConnected: boolean;
}) {
  const [pending, start] = useTransition();
  const [dirty, setDirty] = useState(false);

  // The on/off switch works the same here as in the sidebar: it changes the assistant straight
  // away, with no need to press Save. The hidden field below keeps Save from undoing it.
  const [on, setOn] = useState(autoReply);
  const [toggling, startToggle] = useTransition();

  function changeOn(next: boolean) {
    setOn(next);
    startToggle(async () => {
      const res = await toggleAutoReply(next);
      if (res.error) {
        setOn(!next);
        toast.error(res.error);
      } else {
        toast.success(next ? "Assistant is on" : "Assistant is paused");
      }
    });
  }

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveSettings({}, data);
      if (res.error) toast.error(res.error);
      else {
        toast.success("Settings saved");
        setDirty(false);
      }
    });
  }

  return (
    <form
      onSubmit={submit}
      onChange={() => setDirty(true)}
      onInput={() => setDirty(true)}
      className="flex flex-col gap-6"
    >
      <input type="hidden" name="auto_reply" value={on ? "on" : "off"} />
      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <MessageCircle className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <CardTitle>WhatsApp connection</CardTitle>
            <CardDescription className="mt-1">
              {waConnected
                ? "Connected. Update the number or webhook here."
                : "Not connected yet, so no messages will come in until this is set up."}
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/dashboard/settings/whatsapp">
              {waConnected ? "Manage connection" : "Connect WhatsApp"}
              <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <Bot className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <CardTitle>Answer customers automatically</CardTitle>
            <CardDescription className="mt-1">
              The assistant replies on its own. It hands the chat to you for
              discounts, payments to check, and anything it is not sure about.
            </CardDescription>
          </div>
          <Switch
            checked={on}
            onCheckedChange={changeOn}
            disabled={toggling}
            aria-label="Answer customers automatically"
          />
        </CardHeader>
        {testMode && (
          <CardContent>
            <p className="rounded-lg bg-warning px-4 py-3 text-sm text-warning-foreground">
              Test mode: replies are saved in the chat but not sent to WhatsApp.
              Set WHATSAPP_SEND_MODE=live and WHATSAPP_ACCESS_TOKEN to send for
              real.
            </p>
          </CardContent>
        )}
        <CardContent className="flex flex-col gap-2 border-t pt-4">
          <p id="reply-mode-label" className="text-sm font-medium">
            How the assistant replies
          </p>
          <div role="radiogroup" aria-labelledby="reply-mode-label" className="flex flex-col gap-2">
            <RadioCard
              name="reply_mode"
              value="auto"
              defaultChecked={replyMode !== "approve"}
              title="AI replies automatically"
              description="Sends the moment it has an answer. Fastest for the customer."
            />
            <RadioCard
              name="reply_mode"
              value="approve"
              defaultChecked={replyMode === "approve"}
              title="AI drafts, I approve every send"
              description="Every reply waits in the chat for you to send or edit first. Slower, but nothing goes to a customer without you seeing it."
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <BookOpen className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <CardTitle>What the assistant knows</CardTitle>
            <CardDescription className="mt-1">
              Menu, prices, location, hours and FAQ now live on their own page,
              organised into sections instead of one long text box.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Button asChild variant="outline">
            <Link href="/dashboard/knowledge">
              Open Knowledge base
              <ArrowRight />
            </Link>
          </Button>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex-row items-start gap-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-secondary text-primary">
            <Landmark className="size-5" aria-hidden />
          </span>
          <div className="flex-1">
            <CardTitle>Payment details</CardTitle>
            <CardDescription className="mt-1">
              Sent word for word to a customer right after they confirm an
              order.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent>
          <Textarea
            name="payment_details"
            defaultValue={paymentDetails}
            rows={4}
            aria-label="Payment details"
            placeholder={
              "Bank transfer to:\nMaybank 1234 5678 9012\nAccount name: Test Bakery"
            }
          />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How you talk to customers</CardTitle>
          <CardDescription>
            Optional. One line about your style.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-1.5">
          <Label htmlFor="tone_notes" className="sr-only">
            Style
          </Label>
          <Input
            id="tone_notes"
            name="tone_notes"
            defaultValue={toneNotes}
            placeholder="Friendly and short, Manglish is fine, a little emoji"
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-4 z-10 flex flex-col gap-2 rounded-xl border bg-card/95 p-3 shadow-md backdrop-blur sm:flex-row sm:items-center sm:justify-end sm:gap-3">
        {dirty && (
          <p role="status" className="text-center text-sm font-medium text-muted-foreground sm:text-right">
            You have unsaved changes
          </p>
        )}
        <Button type="submit" size="lg" disabled={pending}>
          {pending && <Loader2 className="animate-spin" />}
          Save settings
        </Button>
      </div>
    </form>
  );
}
