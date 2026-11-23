import { Badge } from "@/components/ui/badge";
import { CAPTURE_MODE_LABEL, type CaptureMode } from "@/lib/constants";

const CAPTURE_MODE_TONE: Record<CaptureMode, "info" | "default" | "warning" | "muted"> = {
  affiliate: "muted",
  leads: "info",
  both: "warning"
};

export function CaptureModeBadge({ mode, className }: { mode: CaptureMode; className?: string }) {
  return (
    <Badge variant={CAPTURE_MODE_TONE[mode]} className={className}>
      {CAPTURE_MODE_LABEL[mode]}
    </Badge>
  );
}
