"use client";

import { useRef, useState, useTransition, type FormEvent } from "react";
import { FileText, Loader2, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import {
  deleteKnowledgeDocument,
  uploadKnowledgeDocument,
} from "@/app/dashboard/knowledge/actions";
import { FactsPreview } from "@/components/knowledge/facts-preview";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { EmptyState } from "@/components/empty-state";
import { MAX_DOCS, MAX_PDF_BYTES } from "@/lib/knowledge";

export interface DocSummary {
  id: string;
  file_name: string;
  size_bytes: number;
  page_count: number;
  truncated: boolean;
}

function prettySize(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function DocCard({ doc }: { doc: DocSummary }) {
  const [pending, start] = useTransition();
  const [confirming, setConfirming] = useState(false);

  function remove() {
    setConfirming(false);
    start(async () => {
      const res = await deleteKnowledgeDocument(doc.id);
      if (res.error) toast.error(res.error);
      else toast.success("Deleted");
    });
  }

  return (
    <Card className="flex items-start gap-3 p-4">
      <FileText className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="truncate font-semibold">{doc.file_name}</p>
        <p className="text-sm text-muted-foreground">
          {doc.page_count} {doc.page_count === 1 ? "page" : "pages"} · {prettySize(doc.size_bytes)}
        </p>
        {doc.truncated && (
          <p className="mt-1 text-sm text-warning-foreground">
            Long file: the assistant only reads the first part.
          </p>
        )}
      </div>
      <Button
        variant="ghost"
        size="icon"
        aria-label={`Delete ${doc.file_name}`}
        className="shrink-0"
        onClick={() => setConfirming(true)}
        disabled={pending}
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" aria-hidden />}
      </Button>
      <ConfirmDialog
        open={confirming}
        onOpenChange={setConfirming}
        title={`Delete "${doc.file_name}"?`}
        description="The assistant will no longer know what is in it. You can upload it again later."
        confirmLabel="Delete"
        pending={pending}
        onConfirm={remove}
      />
    </Card>
  );
}

export function DocumentsPanel({ documents }: { documents: DocSummary[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const full = documents.length >= MAX_DOCS;

  function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const data = new FormData(form);
    const file = data.get("file");

    // Catch the obvious problems here, so a big file isn't sent just to be turned away.
    if (!(file instanceof File) || file.size === 0) return toast.error("Choose a PDF first.");
    if (file.size > MAX_PDF_BYTES) return toast.error("That PDF is too big. The limit is 4MB.");

    start(async () => {
      const res = await uploadKnowledgeDocument({}, data);
      if (res.error) {
        toast.error(res.error);
      } else {
        toast.success("PDF added", { description: res.notice });
        form.reset();
        setFileName(null);
      }
    });
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <p className="max-w-md text-muted-foreground">
          Upload a PDF of your business data, like a price list or a menu. The assistant reads its
          text and answers customers from it.
        </p>
        <FactsPreview />
      </div>

      <form
        onSubmit={submit}
        className="flex flex-col items-start gap-3 rounded-xl border border-dashed p-5 sm:flex-row sm:items-center"
      >
        <input
          ref={inputRef}
          type="file"
          name="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          id="kb-pdf"
          disabled={full || pending}
          onChange={(e) => setFileName(e.target.files?.[0]?.name ?? null)}
        />
        <Button
          type="button"
          variant="outline"
          disabled={full || pending}
          onClick={() => inputRef.current?.click()}
          className="shrink-0"
        >
          <Upload />
          Choose PDF
        </Button>
        <p className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
          {full
            ? `You have ${MAX_DOCS} PDFs, the most allowed. Delete one to add another.`
            : (fileName ?? "PDF only, up to 4MB. It must contain text, not a photo or scan.")}
        </p>
        <Button type="submit" disabled={full || pending || !fileName} className="shrink-0">
          {pending && <Loader2 className="animate-spin" />}
          Upload
        </Button>
      </form>

      {documents.length === 0 ? (
        <EmptyState icon={FileText} title="No PDFs yet">
          Anything you upload here is added to what the assistant knows, next to the entries you type in.
        </EmptyState>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {documents.map((d) => (
            <DocCard key={d.id} doc={d} />
          ))}
        </div>
      )}
    </div>
  );
}
