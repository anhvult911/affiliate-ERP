import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";

/**
 * Trust score bar with a severity colour: red while the persona is fragile,
 * amber while warming, green once it can comment without tripping checkpoints.
 */
export function TrustProgress({
  score,
  className
}: {
  score: number;
  className?: string;
}) {
  const clamped = Math.min(100, Math.max(0, Math.round(score)));
  const indicator =
    clamped >= 70 ? "bg-success" : clamped >= 40 ? "bg-warning" : "bg-destructive";

  return <Progress value={clamped} className={cn(className)} indicatorClassName={indicator} />;
}
