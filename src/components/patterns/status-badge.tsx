import { Badge } from "@/components/ui/badge";
import {
  ACCOUNT_STATUS_LABEL,
  ACCOUNT_STATUS_TONE,
  CONVERSION_STATUS_LABEL,
  CONVERSION_STATUS_TONE,
  EXECUTION_MODE_LABEL,
  TASK_STATUS_LABEL,
  TASK_STATUS_TONE,
  type AccountStatus,
  type ConversionStatus,
  type ExecutionMode,
  type TaskStatus
} from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Single source of truth for state colour. Every module renders statuses through
 * these three components so a queued task looks identical everywhere.
 */
export function TaskStatusBadge({ status, className }: { status: TaskStatus; className?: string }) {
  return (
    <Badge variant={TASK_STATUS_TONE[status]} className={cn("capitalize", className)}>
      {TASK_STATUS_LABEL[status]}
    </Badge>
  );
}

export function AccountStatusBadge({
  status,
  className
}: {
  status: AccountStatus;
  className?: string;
}) {
  return (
    <Badge variant={ACCOUNT_STATUS_TONE[status]} className={cn("capitalize", className)}>
      {ACCOUNT_STATUS_LABEL[status]}
    </Badge>
  );
}

export function ConversionStatusBadge({
  status,
  className
}: {
  status: ConversionStatus;
  className?: string;
}) {
  return (
    <Badge variant={CONVERSION_STATUS_TONE[status]} className={cn("capitalize", className)}>
      {CONVERSION_STATUS_LABEL[status]}
    </Badge>
  );
}

export function ExecutionModeBadge({
  mode,
  className
}: {
  mode: ExecutionMode;
  className?: string;
}) {
  return (
    <Badge variant={mode === "seeding_2_accounts" ? "info" : "muted"} className={className}>
      {EXECUTION_MODE_LABEL[mode]}
    </Badge>
  );
}
