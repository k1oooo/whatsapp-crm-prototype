"use client";

import { useState, useTransition, type FormEvent } from "react";
import { Landmark, Loader2, MessageSquareText, Sparkles } from "lucide-react";
import { toast } from "sonner";
import { saveSettings } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";

const EXAMPLE_FACTS = `PRODUCTS AND PRICES
Cupcakes (chocolate, vanilla, red velvet): RM3 each. Minimum order 12.
Birthday cake, 1 tier (serves 10): RM120. Flavours: chocolate, vanilla, red velvet.
Birthday cake, 2 tier (serves 20): RM220. Same flavours.
Prices are fixed. Any discount is decided by the owner.

ORDERING
Cupcakes: order at least 1 day before. Cakes: order at least 3 days before.

PICKUP
Wangsa Maju, Monday to Saturday, 9am to 6pm. Closed on Sunday.

DELIVERY
Shah Alam and Petaling Jaya only, RM10. Delivery is between 10am and 5pm.

CHECK WITH THE OWNER (the assistant hands these over)
Custom designs, allergies, orders of more than 50 pieces, discounts, complaints.`;

export function SettingsForm({
  facts,
  toneNotes,
  paymentDetails,
  testMode,
}: {
  facts: string;
  toneNotes: string;
  paymentDetails: string;
  testMode: boolean;
}) {
  const [pending, start] = useTransition();
  const [factsText, setFactsText] = useState(facts);

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveSettings({}, data);
      if (res.error) toast.error(res.error);
      else toast.success("Settings saved");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      {/* Test Mode Warning Banner */}
      {testMode && (
        <div className="rounded-lg bg-warning px-4 py-3 text-sm text-warning-foreground border border-warning/20">
          <strong>Test mode active:</strong> replies are saved in the chat but
          not sent to WhatsApp. Set <code>WHATSAPP_SEND_MODE=live</code> and{" "}
          <code>WHATSAPP_ACCESS_TOKEN</code> to send for real.
        </div>
      )}

      {/* Single Unified Card containing all inputs AND the save button */}
      <Card>
        <CardContent className="flex flex-col gap-8 pt-6">
          {/* Facts Section */}
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <MessageSquareText className="size-5" aria-hidden />
              </span>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">
                  What the assistant may say
                </h3>
                <p className="text-sm text-muted-foreground">
                  Menu and prices, minimum order, notice needed, pickup,
                  delivery, opening hours. It only uses what you write here and
                  hands over anything else.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-3">
              <Textarea
                name="business_facts"
                value={factsText}
                onChange={(e) => setFactsText(e.target.value)}
                rows={14}
                aria-label="What the assistant may say"
                className="font-mono text-sm resize-none bg-background"
              />
              <div className="flex items-center justify-between gap-3">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setFactsText(EXAMPLE_FACTS)}
                >
                  <Sparkles className="mr-2 size-4 text-primary" />
                  Fill with an example
                </Button>
                <span className="text-sm text-muted-foreground">
                  {factsText.length} characters
                </span>
              </div>
            </div>
          </div>

          <hr className="border-border" />

          {/* Payment Section */}
          <div className="flex flex-col gap-4">
            <div className="flex gap-4">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                <Landmark className="size-5" aria-hidden />
              </span>
              <div className="space-y-1">
                <h3 className="text-base font-semibold">Payment details</h3>
                <p className="text-sm text-muted-foreground">
                  Sent word for word to a customer right after they confirm an
                  order. Keep these out of the box above.
                </p>
              </div>
            </div>
            <Textarea
              name="payment_details"
              defaultValue={paymentDetails}
              rows={4}
              aria-label="Payment details"
              className="bg-background resize-none"
              placeholder={
                "Bank transfer to:\nMaybank 1234 5678 9012\nAccount name: Test Bakery"
              }
            />
          </div>

          <hr className="border-border" />

          {/* Tone Section */}
          <div className="flex flex-col gap-4">
            <div className="space-y-1">
              <h3 className="text-base font-semibold">
                How you talk to customers
              </h3>
              <p className="text-sm text-muted-foreground">
                Optional. One line about your style.
              </p>
            </div>
            <div className="grid gap-1.5">
              <Label htmlFor="tone_notes" className="sr-only">
                Style
              </Label>
              <Input
                id="tone_notes"
                name="tone_notes"
                defaultValue={toneNotes}
                className="bg-background"
                placeholder="Friendly and short, Manglish is fine, a little emoji"
              />
            </div>
          </div>

          <hr className="border-border" />

          {/* Save Button inside the Card */}
          <div className="flex justify-end pt-2">
            <Button
              type="submit"
              size="lg"
              disabled={pending}
              className="w-full sm:w-auto"
            >
              {pending && <Loader2 className="mr-2 size-4 animate-spin" />}
              Save settings
            </Button>
          </div>
        </CardContent>
      </Card>
    </form>
  );
}
