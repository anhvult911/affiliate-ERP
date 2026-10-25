"use client";

import { useState, useTransition } from "react";

import type { ActionResult } from "@/lib/result";

/**
 * Submits a form by calling its Server Action directly inside a transition.
 *
 * Why not `<form action={formAction}>` with `useActionState`: in this app's
 * production build that plumbing delivers the action — the database row really does
 * change — but never applies the returned state, so the dialog stays open and the
 * button spins forever. The direct call path (this hook) commits reliably, which is
 * the same trade-off already made for same-route navigation: reliability over the
 * framework's transition machinery while the underlying commit bug is unresolved.
 *
 * Every form in the app goes through here so the behaviour cannot drift per screen.
 */
export function useFormAction<Data = undefined>(
  run: (formData: FormData) => Promise<ActionResult<Data>>,
  handlers?: {
    onSuccess?: (data: Data) => void;
    onError?: (message: string) => void;
  }
) {
  const [state, setState] = useState<ActionResult<Data> | null>(null);
  const [pending, startTransition] = useTransition();

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();

    // The form element is read before the transition: React pools events, and the
    // `currentTarget` is null by the time an async callback runs.
    const formData = new FormData(event.currentTarget);

    startTransition(async () => {
      const result = await run(formData);
      setState(result);

      if (result.ok) handlers?.onSuccess?.(result.data);
      else handlers?.onError?.(result.error);
    });
  }

  return {
    state,
    pending,
    submit,
    /** Field-level errors for rendering under the inputs. */
    fieldErrors: state && !state.ok ? (state.fieldErrors ?? {}) : {},
    /** Form-level error message, if the action failed without field errors. */
    error: state && !state.ok ? state.error : null
  };
}
