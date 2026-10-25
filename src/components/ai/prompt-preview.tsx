import { Braces, MessageSquareQuote, Sparkles } from "lucide-react";

import { CopyButton } from "@/components/patterns/copy-button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  DRAFT_PROMPT_VERSION,
  MATCH_PROMPT_VERSION,
  type PromptPair
} from "@/lib/ai/prompts";

function PromptBlock({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b px-3 py-2">
        <span className="text-muted-foreground text-xs font-medium uppercase tracking-wide">
          {title}
        </span>
        <CopyButton value={value} label={`Copy ${title.toLowerCase()}`} size="icon" />
      </div>
      <pre className="max-h-80 overflow-x-auto overflow-y-auto p-3 font-mono text-xs leading-relaxed whitespace-pre-wrap break-words">{value}</pre>
    </div>
  );
}

export function PromptPreview({
  match,
  draft,
  isExample,
  origin
}: {
  match: PromptPair;
  draft: PromptPair;
  isExample: boolean;
  origin: string;
}) {
  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <Braces className="size-4" />
            Prompt preview
          </CardTitle>
          <Badge variant={isExample ? "warning" : "info"}>
            {isExample ? "Synthetic example" : "Live task"}
          </Badge>
        </div>
        <CardDescription>{origin}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Sparkles className="size-4" />
              Radar match prompt
            </h3>
            <Badge variant="outline">{MATCH_PROMPT_VERSION}</Badge>
          </div>
          <PromptBlock title="System instruction" value={match.system} />
          <PromptBlock title="User message" value={match.user} />
        </section>

        <section className="space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <MessageSquareQuote className="size-4" />
              Comment draft prompt
            </h3>
            <Badge variant="outline">{DRAFT_PROMPT_VERSION}</Badge>
          </div>
          <PromptBlock title="System instruction" value={draft.system} />
          <PromptBlock title="User message" value={draft.user} />
        </section>
      </CardContent>
    </Card>
  );
}
