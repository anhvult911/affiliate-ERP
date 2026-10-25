import { TargetIcon } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { formatMatchScore } from "@/lib/format";

/**
 * Gemini match probability. 80% is the radar threshold from the spec, so
 * anything at or above it gets the success tone.
 */
export function MatchScoreBadge({ score, className }: { score: number | null; className?: string }) {
  const variant =
    score === null ? "muted" : score >= 0.8 ? "success" : score >= 0.5 ? "warning" : "muted";

  return (
    <Badge variant={variant} className={className}>
      <TargetIcon />
      {formatMatchScore(score)} match
    </Badge>
  );
}
