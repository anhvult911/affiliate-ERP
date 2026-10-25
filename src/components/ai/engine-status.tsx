import { AlertTriangle, CheckCircle2, Cpu, Gauge, KeyRound, Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatMatchScore } from "@/lib/format";

export function EngineStatus({
  configured,
  model,
  embeddingModel,
  threshold,
  matchPromptVersion,
  draftPromptVersion
}: {
  configured: boolean;
  model: string;
  embeddingModel: string;
  threshold: number;
  matchPromptVersion: string;
  draftPromptVersion: string;
}) {
  const items = [
    {
      label: "GEMINI_API_KEY",
      value: configured ? "Present (server only)" : "Missing",
      icon: KeyRound,
      tone: configured ? "text-success" : "text-warning"
    },
    { label: "GEMINI_MODEL", value: model, icon: Cpu, tone: "text-foreground" },
    { label: "GEMINI_EMBEDDING_MODEL", value: embeddingModel, icon: Cpu, tone: "text-foreground" },
    {
      label: "RADAR_MATCH_THRESHOLD",
      value: `${formatMatchScore(threshold)} (${threshold.toFixed(2)})`,
      icon: Gauge,
      tone: "text-foreground"
    }
  ] as const;

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-wrap items-center gap-2">
          <CardTitle className="flex items-center gap-2">
            <Sparkles className="size-4" />
            Engine status
          </CardTitle>
          <Badge variant={configured ? "success" : "warning"}>
            {configured ? "Configured" : "Not configured"}
          </Badge>
        </div>
        <CardDescription>
          Server-side Gemini configuration and the prompt versions currently in force. The key is
          read lazily per request and never sent to the browser.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <dl className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {items.map(({ label, value, icon: Icon, tone }) => (
            <div key={label} className="rounded-lg border p-3">
              <dt className="text-muted-foreground flex items-center gap-1.5 text-xs font-medium">
                <Icon className="size-3.5" />
                {label}
              </dt>
              <dd className={`mt-1 truncate font-mono text-sm ${tone}`} title={value}>
                {value}
              </dd>
            </div>
          ))}
        </dl>

        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted-foreground">Prompt versions:</span>
          <Badge variant="outline">match · {matchPromptVersion}</Badge>
          <Badge variant="outline">draft · {draftPromptVersion}</Badge>
        </div>

        {configured ? (
          <p className="text-muted-foreground flex items-center gap-2 text-sm">
            <CheckCircle2 className="text-success size-4 shrink-0" />
            Gemini calls run only from server code. Drafts are stored on the task before the response
            returns.
          </p>
        ) : (
          <div className="border-warning/40 bg-warning/10 space-y-2 rounded-lg border p-3 text-sm sm:p-4">
            <p className="flex items-center gap-2 font-medium">
              <AlertTriangle className="text-warning size-4 shrink-0" />
              Matching and drafting are disabled until a Gemini key exists.
            </p>
            <p className="text-muted-foreground">
              Add the key to <code className="bg-background rounded px-1 py-0.5 text-xs">.env.local</code>{" "}
              (or the deployment environment) and restart the server:
            </p>
            <pre className="bg-background/70 overflow-x-auto rounded-md p-3 font-mono text-xs">
              {[
                'GEMINI_API_KEY="your-gemini-api-key"',
                'GEMINI_MODEL="gemini-3.1-flash-lite"',
                'GEMINI_EMBEDDING_MODEL="gemini-embedding-001"',
                'RADAR_MATCH_THRESHOLD="0.8"'
              ].join("\n")}
            </pre>
            <p className="text-muted-foreground">
              The key is only read inside server functions, so this page keeps rendering before it is
              configured.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
