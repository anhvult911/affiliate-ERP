"use client";

import { Loader2Icon } from "lucide-react";
import { useFormStatus } from "react-dom";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Submit button that disables itself while the action runs — prevents the
 * double-submit that would otherwise fire two Server Actions from a slow mobile
 * connection.
 *
 * `pending` is passed explicitly because forms in this app call their action from
 * `onSubmit` with `startTransition` rather than React's form-action plumbing:
 * in the production build that plumbing delivered the action (the write happened)
 * but never applied the returned state, leaving the button spinning forever.
 */
export function SubmitButton({
  children,
  pendingLabel,
  pending = false,
  className,
  ...props
}: React.ComponentProps<typeof Button> & { pendingLabel?: string; pending?: boolean }) {
  const { pending: formPending } = useFormStatus();
  const isPending = pending || formPending;

  return (
    <Button type="submit" disabled={isPending} aria-busy={isPending} className={cn(className)} {...props}>
      {isPending ? <Loader2Icon className="animate-spin" /> : null}
      {isPending ? (pendingLabel ?? children) : children}
    </Button>
  );
}
