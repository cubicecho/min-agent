import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { api } from "@/lib/api";
import { MODEL_TASKS } from "../../shared/model-tasks.ts";

/** Select needs a non-empty value, so "unset" gets a sentinel that never reaches the config. */
const NO_TASK_MODEL = "__none__";

type Draft = {
  baseUrl: string;
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  maxToolIterations: number;
  systemPrompt: string;
  pricing: { inputPer1M: number; outputPer1M: number };
  contextLimit: number;
  toolDiscovery: "eager" | "ondemand";
  taskModels: Record<string, string>;
};

export function ConfigRoute() {
  const queryClient = useQueryClient();
  const config = useQuery({ queryKey: ["config"], queryFn: api.config });
  const models = useQuery({ queryKey: ["models"], queryFn: api.models });
  const [draft, setDraft] = useState<Draft | null>(null);

  useEffect(() => {
    if (config.data && !draft) setDraft({ ...config.data, apiKey: "" });
  }, [config.data, draft]);

  const save = useMutation({
    mutationFn: (value: Draft) => api.saveConfig(value),
    onSuccess: async () => {
      toast.success("Settings saved");
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["config"] });
      await queryClient.invalidateQueries({ queryKey: ["models"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!draft) return <Page title="Config">Loading…</Page>;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => (current ? { ...current, [key]: value } : current));

  return (
    <Page
      title="Config"
      description="Connection to an OpenAI-compatible server. Settings are stored in Postgres."
      actions={
        <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
          Save
        </Button>
      }
    >
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Connection</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <Label htmlFor="baseUrl">Base URL</Label>
            <Input
              id="baseUrl"
              value={draft.baseUrl}
              onChange={(event) => set("baseUrl", event.target.value)}
              placeholder="http://localhost:11434/v1"
            />
            <p className="text-xs text-muted-foreground">
              Ollama <code>:11434/v1</code>, LM Studio <code>:1234/v1</code>, OpenAI{" "}
              <code>https://api.openai.com/v1</code>.
            </p>
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="apiKey">API key</Label>
            <Input
              id="apiKey"
              type="password"
              value={draft.apiKey}
              onChange={(event) => set("apiKey", event.target.value)}
              placeholder={config.data?.hasApiKey ? "•••••••• (leave blank to keep)" : "optional"}
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="model">Default model</Label>
            <div className="flex gap-2">
              <Select value={draft.model} onValueChange={(value) => set("model", value)}>
                <SelectTrigger id="model" className="flex-1">
                  <SelectValue
                    placeholder={models.isError ? "server unreachable" : "select a model"}
                  />
                </SelectTrigger>
                <SelectContent>
                  {(models.data?.models ?? []).map((entry) => (
                    <SelectItem key={entry.id} value={entry.id}>
                      {entry.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button variant="outline" onClick={() => void models.refetch()}>
                <RefreshCw className={models.isFetching ? "size-4 animate-spin" : "size-4"} />
                Refresh
              </Button>
            </div>
            {models.isError ? (
              <p className="text-xs text-destructive">{(models.error as Error).message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                {models.data?.models.length ?? 0} model(s) reported by the server. Save the base URL
                first, then refresh.
              </p>
            )}
          </div>

          <div className="flex flex-col gap-3 border-t pt-4">
            <div>
              <Label>Task models</Label>
              <p className="mt-1 text-xs text-muted-foreground">
                Side jobs that need not run on the chat model. Each is short and frequent, so a
                small fast model usually serves them better.
              </p>
            </div>
            {MODEL_TASKS.map((task) => (
              <div key={task.key} className="flex flex-col gap-1.5">
                <Label htmlFor={`task-${task.key}`} className="text-sm font-normal">
                  {task.label}
                </Label>
                <Select
                  value={draft.taskModels[task.key] || NO_TASK_MODEL}
                  onValueChange={(value) =>
                    set("taskModels", {
                      ...draft.taskModels,
                      [task.key]: value === NO_TASK_MODEL ? "" : value,
                    })
                  }
                >
                  <SelectTrigger id={`task-${task.key}`}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_TASK_MODEL}>{task.empty}</SelectItem>
                    {(models.data?.models ?? []).map((entry) => (
                      <SelectItem key={entry.id} value={entry.id}>
                        {entry.id}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">{task.hint}</p>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Agent</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="grid grid-cols-4 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="maxTokens">Max tokens</Label>
              <Input
                id="maxTokens"
                type="number"
                value={draft.maxTokens}
                onChange={(event) => set("maxTokens", Number(event.target.value))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="temperature">Temperature</Label>
              <Input
                id="temperature"
                type="number"
                step="0.1"
                value={draft.temperature}
                onChange={(event) => set("temperature", Number(event.target.value))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="maxToolIterations">Max tool loops</Label>
              <Input
                id="maxToolIterations"
                type="number"
                value={draft.maxToolIterations}
                onChange={(event) => set("maxToolIterations", Number(event.target.value))}
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="contextLimit">Context window</Label>
              <Input
                id="contextLimit"
                type="number"
                value={draft.contextLimit}
                onChange={(event) => set("contextLimit", Number(event.target.value))}
              />
              <p className="text-xs text-muted-foreground">0 asks the server.</p>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="toolDiscovery">MCP tools</Label>
            <Select
              value={draft.toolDiscovery}
              onValueChange={(value) => set("toolDiscovery", value as Draft["toolDiscovery"])}
            >
              <SelectTrigger id="toolDiscovery">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ondemand">On demand — load definitions as needed</SelectItem>
                <SelectItem value="eager">Eager — send every definition every time</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              On demand puts a name-only catalogue in the system prompt and lets the model pull in
              the schemas it needs mid-turn. Much cheaper with many tools; costs one extra round
              trip on the turns that use them.
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor="systemPrompt">System prompt</Label>
            <Textarea
              id="systemPrompt"
              rows={6}
              value={draft.systemPrompt}
              onChange={(event) => set("systemPrompt", event.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Pricing</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-xs text-muted-foreground">
            Only used to turn the token counts into a cost. Leave both at 0 — the default for a
            local model — and min-agent shows tokens alone.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-2">
              <Label htmlFor="inputPer1M">Input $ / 1M tokens</Label>
              <Input
                id="inputPer1M"
                type="number"
                min={0}
                step="0.01"
                value={draft.pricing.inputPer1M}
                onChange={(event) =>
                  set("pricing", { ...draft.pricing, inputPer1M: Number(event.target.value) })
                }
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor="outputPer1M">Output $ / 1M tokens</Label>
              <Input
                id="outputPer1M"
                type="number"
                min={0}
                step="0.01"
                value={draft.pricing.outputPer1M}
                onChange={(event) =>
                  set("pricing", { ...draft.pricing, outputPer1M: Number(event.target.value) })
                }
              />
            </div>
          </div>
        </CardContent>
      </Card>
    </Page>
  );
}
