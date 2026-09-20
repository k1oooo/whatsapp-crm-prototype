"use client";

import { useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { updateLead } from "@/app/dashboard/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { Lead } from "@/lib/leads";

export function LeadEditForm({ lead }: { lead: Lead }) {
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const res = await updateLead(lead.id, {}, data);
      if (res.error) toast.error(res.error);
      else toast.success("Saved");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <div className="grid gap-1.5">
        <Label htmlFor="name">Customer name</Label>
        <Input id="name" name="name" defaultValue={lead.name ?? ""} />
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="need">What they want</Label>
        <Input id="need" name="need" defaultValue={lead.need ?? ""} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="grid gap-1.5">
          <Label htmlFor="budget_myr">Their budget (RM)</Label>
          <Input id="budget_myr" name="budget_myr" inputMode="numeric" defaultValue={lead.budget_myr ?? ""} />
        </div>
        <div className="grid gap-1.5">
          <Label htmlFor="quoted_price_myr">Price (RM)</Label>
          <Input
            id="quoted_price_myr"
            name="quoted_price_myr"
            inputMode="numeric"
            defaultValue={lead.quoted_price_myr ?? ""}
          />
        </div>
      </div>
      <div className="grid gap-1.5">
        <Label htmlFor="deadline">Needed by</Label>
        <Input id="deadline" name="deadline" type="date" defaultValue={lead.deadline ?? ""} />
      </div>
      <Button type="submit" disabled={pending} className="w-fit">
        {pending && <Loader2 className="animate-spin" />}
        Save changes
      </Button>
      <p className="text-sm text-muted-foreground">
        Anything you change here stays as you set it. The assistant will not overwrite it.
      </p>
    </form>
  );
}
