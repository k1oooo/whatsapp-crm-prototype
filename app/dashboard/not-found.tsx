import { ErrorPanel } from "@/components/error-panel";

export default function DashboardNotFound() {
  return (
    <ErrorPanel title="We could not find that" homeHref="/dashboard/inbox" homeLabel="Back to inbox">
      This chat may have been removed, or the link is out of date.
    </ErrorPanel>
  );
}
