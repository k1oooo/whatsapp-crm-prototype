import { FlaskConical } from "lucide-react";
import { Badge } from "@/components/ui/badge";

// Shown next to the assistant switch while WhatsApp is in test mode, so nobody thinks
// customers are receiving these replies.
export function TestModeChip({ className }: { className?: string }) {
  return (
    <Badge variant="info" className={className} title="Replies are saved here but not sent on WhatsApp">
      <FlaskConical aria-hidden />
      Test mode: not sent to customers
    </Badge>
  );
}
