import { Badge } from "@/components/ui/badge";
import {
  LEAD_STATUS_TONE,
  isLeadStatus,
  leadScoreLabel,
  leadStatusLabel
} from "@/lib/leads/status";

/** 4–5 is the "answer today" band; 3 is worth a look; lower is context. */
export function LeadScoreBadge({ score }: { score: number | null | undefined }) {
  const variant =
    typeof score !== "number"
      ? "muted"
      : score >= 5
        ? "success"
        : score >= 4
          ? "warning"
          : score >= 3
            ? "info"
            : "muted";

  return (
    <Badge variant={variant} className="tabular-nums">
      {leadScoreLabel(score)}
    </Badge>
  );
}

export function LeadStatusBadge({ status }: { status: string | null | undefined }) {
  const variant = isLeadStatus(status) ? LEAD_STATUS_TONE[status] : "muted";
  return <Badge variant={variant}>{leadStatusLabel(status)}</Badge>;
}
