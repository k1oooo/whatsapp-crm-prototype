import { CopyButton } from "@/components/CopyButton";
import { SubmitButton } from "@/components/SubmitButton";
import { WriteDraftForm } from "@/components/WriteDraftForm";
import { setDraftStatus } from "@/app/dashboard/actions";
import { waLink, type Draft, type Lead } from "@/lib/leads";

// The follow-up draft and its actions. Used on the chase list and on the lead page.
export function DraftPanel({ lead, draft }: { lead: Lead; draft?: Draft }) {
  if (!draft) {
    return <WriteDraftForm leadId={lead.id} label="Write follow-up" primary />;
  }

  return (
    <div>
      <p className="max-w-prose whitespace-pre-wrap rounded-2xl rounded-tl-sm bg-[#D3EFC4] px-4 py-3">
        {draft.body}
      </p>
      <div className="mt-3 flex flex-wrap items-start gap-2">
        <a
          href={waLink(lead.wa_contact_number, draft.body)}
          target="_blank"
          rel="noreferrer"
          className="rounded-full bg-[#1F7A5C] px-4 py-2 text-sm font-medium text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1F7A5C]"
        >
          Open in WhatsApp
        </a>
        <CopyButton text={draft.body} />
        <form action={setDraftStatus.bind(null, draft.id, "sent")}>
          <SubmitButton pendingText="Saving...">I sent it</SubmitButton>
        </form>
        <WriteDraftForm leadId={lead.id} label="Write another" />
        <form action={setDraftStatus.bind(null, draft.id, "dismissed")}>
          <SubmitButton pendingText="Saving...">Dismiss</SubmitButton>
        </form>
      </div>
    </div>
  );
}
