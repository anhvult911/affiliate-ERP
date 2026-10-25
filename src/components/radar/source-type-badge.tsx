import { Badge } from "@/components/ui/badge";
import { SOURCE_TYPE_LABEL, type SourceType } from "@/lib/constants";

const SOURCE_TYPE_TONE: Record<SourceType, "info" | "default" | "warning" | "muted"> = {
  group: "info",
  fanpage: "default",
  kol: "warning",
  forum: "muted"
};

export function SourceTypeBadge({ type, className }: { type: SourceType; className?: string }) {
  return (
    <Badge variant={SOURCE_TYPE_TONE[type]} className={className}>
      {SOURCE_TYPE_LABEL[type]}
    </Badge>
  );
}
