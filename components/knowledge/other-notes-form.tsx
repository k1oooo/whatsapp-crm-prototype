"use client";

import { useTransition, type FormEvent } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveOtherNotes } from "@/app/dashboard/knowledge/actions";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function OtherNotesForm({ initial }: { initial: string }) {
  const [pending, start] = useTransition();

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const data = new FormData(e.currentTarget);
    start(async () => {
      const res = await saveOtherNotes({}, data);
      if (res.error) toast.error(res.error);
      else toast.success("Saved");
    });
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-3">
      <Textarea
        name="business_facts"
        defaultValue={initial}
        rows={10}
        className="font-mono text-sm"
        placeholder="Anything that doesn't fit the sections above."
      />
      <Button type="submit" disabled={pending} className="w-fit">
        {pending && <Loader2 className="animate-spin" />}
        Save
      </Button>
    </form>
  );
}
