"use client";

import { useState } from "react";
import { Loader2, Save, Sparkles, Wand2 } from "lucide-react";
import { toast } from "sonner";

import { CopyButton } from "@/components/patterns/copy-button";
import { EmptyState } from "@/components/patterns/empty-state";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { saveDraft } from "@/lib/actions/ai";
import { EXECUTION_MODE_LABEL } from "@/lib/constants";
import type { PendingDraftTask } from "@/lib/data/ai-context";
import { errorMessage } from "@/lib/result";

type DraftResponse =
  | { ok: true; draft: string; followUp: string | null }
  | { ok: false; error: string };

export function DraftPlayground({
  tasks,
  configured
}: {
  tasks: PendingDraftTask[];
  configured: boolean;
}) {
  const [selectedId, setSelectedId] = useState(tasks[0]?.id ?? "");
  const [draft, setDraft] = useState<string | null>(null);
  const [followUp, setFollowUp] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, setGenerating] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedTask = tasks.find((task) => task.id === selectedId) ?? null;

  function clearResult() {
    setDraft(null);
    setFollowUp(null);
    setError(null);
  }

  async function handleGenerate() {
    if (!selectedId) return;

    setGenerating(true);
    clearResult();

    try {
      const response = await fetch("/api/ai/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taskId: selectedId })
      });

      const payload = (await response.json().catch(() => null)) as DraftResponse | null;

      if (!response.ok) {
        throw new Error(
          payload && !payload.ok
            ? payload.error
            : `Draft request failed with status ${response.status}.`
        );
      }

      if (!payload || !payload.ok) {
        throw new Error(payload ? payload.error : "The AI service returned an unreadable response.");
      }

      setDraft(payload.draft);
      setFollowUp(payload.followUp);
      toast.success("Draft generated and saved to the task");
    } catch (cause) {
      const message = errorMessage(cause);
      setError(message);
      toast.error(message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleSave() {
    if (!selectedId || draft === null || draft.trim().length === 0) return;

    setSaving(true);
    try {
      const result = await saveDraft(selectedId, draft);
      if (result.ok) {
        toast.success("Draft saved to the task");
      } else {
        toast.error(result.error);
      }
    } catch (cause) {
      toast.error(errorMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wand2 className="size-4" />
          Draft playground
        </CardTitle>
        <CardDescription>
          Generate a real draft for one pending task. The comment is persisted immediately; the
          seeding follow-up is returned for review only.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!configured ? (
          <Alert>
            <Sparkles />
            <AlertTitle>Gemini is not configured</AlertTitle>
            <AlertDescription>
              <p>
                Set <code className="bg-muted rounded px-1 py-0.5 text-xs">GEMINI_API_KEY</code> in{" "}
                <code className="bg-muted rounded px-1 py-0.5 text-xs">.env.local</code> and restart
                the server. The key is read server-side only and is never exposed to this browser.
              </p>
              <p className="text-muted-foreground">
                Until then the playground stays disabled instead of failing mid-generation.
              </p>
            </AlertDescription>
          </Alert>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={Sparkles}
            title="No draftable tasks"
            description="Tasks appear here once a pending post is matched to a product and a target source."
          />
        ) : (
          <>
            <div className="space-y-2">
              <Label htmlFor="draft-task">Pending task</Label>
              <Select
                value={selectedId}
                onValueChange={(value) => {
                  setSelectedId(value);
                  clearResult();
                }}
              >
                <SelectTrigger id="draft-task" className="w-full">
                  <SelectValue placeholder="Choose a pending task" />
                </SelectTrigger>
                <SelectContent>
                  {tasks.map((task) => (
                    <SelectItem key={task.id} value={task.id} className="min-h-11">
                      <span className="block max-w-[70vw] truncate">
                        {task.productName ?? "Unmatched product"} — {task.postExcerpt}
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {selectedTask ? (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <Badge variant="outline">
                    {EXECUTION_MODE_LABEL[selectedTask.executionMode]}
                  </Badge>
                  {selectedTask.sourceName ? (
                    <Badge variant="muted">{selectedTask.sourceName}</Badge>
                  ) : null}
                  {selectedTask.productName ? (
                    <Badge variant="muted">{selectedTask.productName}</Badge>
                  ) : null}
                </div>
              ) : null}
            </div>

            <Button
              type="button"
              size="lg"
              onClick={handleGenerate}
              disabled={generating || !selectedId}
              className="w-full sm:w-auto"
            >
              {generating ? <Loader2 className="animate-spin" /> : <Wand2 />}
              {generating ? "Drafting…" : "Generate draft"}
            </Button>

            {error ? (
              <Alert variant="destructive">
                <AlertTitle>Draft failed</AlertTitle>
                <AlertDescription>{error}</AlertDescription>
              </Alert>
            ) : null}

            {draft !== null ? (
              <div className="space-y-4 rounded-lg border p-3 sm:p-4">
                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor="draft-comment">Comment draft</Label>
                    <CopyButton value={draft} label="Copy comment draft" size="icon" />
                  </div>
                  <Textarea
                    id="draft-comment"
                    value={draft}
                    onChange={(event) => setDraft(event.target.value)}
                    className="min-h-32"
                  />
                  <p className="text-muted-foreground text-xs">
                    Gemini output is already stored on the task. Edit above and save if you changed
                    it.
                  </p>
                </div>

                {followUp ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-medium">Follow-up reply</p>
                        <Badge variant="info">Second persona</Badge>
                      </div>
                      <CopyButton value={followUp} label="Copy follow-up reply" size="icon" />
                    </div>
                    <div className="bg-muted/40 rounded-md border p-3 text-sm whitespace-pre-wrap">
                      {followUp}
                    </div>
                    <p className="text-muted-foreground text-xs">
                      Returned to the caller only — <code>review_note</code> is operator feedback and
                      is deliberately left untouched.
                    </p>
                  </div>
                ) : null}

                <Button
                  type="button"
                  size="lg"
                  onClick={handleSave}
                  disabled={saving || !draft.trim()}
                  className="w-full sm:w-auto"
                >
                  {saving ? <Loader2 className="animate-spin" /> : <Save />}
                  {saving ? "Saving…" : "Save to task"}
                </Button>
              </div>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  );
}
