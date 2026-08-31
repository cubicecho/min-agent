// biome-ignore-all lint/suspicious/noArrayIndexKey: rows are positional — every field is a controlled input owned by `draft`, so index is the identity.
import type { McpServerConfig, McpStatus } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, RefreshCw, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Page } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
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
import { Switch } from "@/components/ui/switch";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

const STATUS_STYLE: Record<McpStatus, string> = {
  ready: "bg-emerald-500/15 text-emerald-500",
  error: "bg-destructive/15 text-destructive",
  connecting: "bg-amber-500/15 text-amber-500",
  disabled: "bg-muted text-muted-foreground",
};

const blank = (index: number): McpServerConfig => ({
  id: `server-${index}`,
  label: "",
  enabled: true,
  transport: "stdio",
  command: "npx",
  args: [],
  env: {},
  url: "",
  headers: {},
});

export function McpRoute() {
  const queryClient = useQueryClient();
  const servers = useQuery({ queryKey: ["mcp"], queryFn: api.mcp, refetchInterval: 5000 });
  const [draft, setDraft] = useState<McpServerConfig[] | null>(null);

  useEffect(() => {
    if (servers.data && !draft) setDraft(servers.data.map((state) => state.config));
  }, [servers.data, draft]);

  const save = useMutation({
    mutationFn: (value: McpServerConfig[]) => api.saveMcp(value),
    onSuccess: async () => {
      toast.success("Saved to config/mcp.yaml");
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["mcp"] });
    },
    onError: (error: Error) => toast.error(error.message),
  });

  const reconnect = useMutation({
    mutationFn: api.reconnectMcp,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["mcp"] }),
  });

  if (!draft) return <Page title="MCP Servers">Loading…</Page>;

  const update = (index: number, patch: Partial<McpServerConfig>) =>
    setDraft((current) =>
      current
        ? current.map((server, i) => (i === index ? { ...server, ...patch } : server))
        : current,
    );

  return (
    <Page
      title="MCP Servers"
      description="Connected servers expose their tools to the agent as <server id>__<tool>."
      actions={
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setDraft([...draft, blank(draft.length + 1)])}>
            Add server
          </Button>
          <Button onClick={() => save.mutate(draft)} disabled={save.isPending}>
            Save
          </Button>
        </div>
      }
    >
      {draft.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No servers configured yet. Add one, or edit <code>config/mcp.yaml</code> directly.
        </p>
      ) : null}

      {draft.map((server, index) => {
        const state = servers.data?.find((item) => item.config.id === server.id);
        const status = state?.status ?? "connecting";

        return (
          <Card key={index}>
            <CardHeader className="flex flex-row items-center justify-between gap-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Plug className="size-4" />
                {server.label || server.id}
                <Badge className={cn("font-normal", STATUS_STYLE[status])}>{status}</Badge>
                {state?.tools.length ? (
                  <span className="text-xs font-normal text-muted-foreground">
                    {state.tools.length} tool(s)
                  </span>
                ) : null}
              </CardTitle>
              <div className="flex items-center gap-2">
                <Switch
                  checked={server.enabled}
                  onCheckedChange={(enabled) => update(index, { enabled })}
                />
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Reconnect"
                  onClick={() => reconnect.mutate(server.id)}
                >
                  <RefreshCw className="size-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  aria-label="Remove"
                  onClick={() => setDraft(draft.filter((_, i) => i !== index))}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            </CardHeader>

            <CardContent className="flex flex-col gap-3">
              <div className="grid grid-cols-3 gap-3">
                <div className="flex flex-col gap-2">
                  <Label>Id</Label>
                  <Input
                    value={server.id}
                    onChange={(e) => update(index, { id: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Label</Label>
                  <Input
                    value={server.label}
                    onChange={(e) => update(index, { label: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <Label>Transport</Label>
                  <Select
                    value={server.transport}
                    onValueChange={(value) =>
                      update(index, { transport: value as McpServerConfig["transport"] })
                    }
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="stdio">stdio</SelectItem>
                      <SelectItem value="http">http</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {server.transport === "stdio" ? (
                <div className="grid grid-cols-3 gap-3">
                  <div className="flex flex-col gap-2">
                    <Label>Command</Label>
                    <Input
                      value={server.command}
                      onChange={(e) => update(index, { command: e.target.value })}
                    />
                  </div>
                  <div className="col-span-2 flex flex-col gap-2">
                    <Label>Args (space separated)</Label>
                    <Input
                      value={server.args.join(" ")}
                      onChange={(e) =>
                        update(index, { args: e.target.value.split(" ").filter(Boolean) })
                      }
                      placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                    />
                  </div>
                </div>
              ) : (
                <div className="flex flex-col gap-2">
                  <Label>URL</Label>
                  <Input
                    value={server.url}
                    onChange={(e) => update(index, { url: e.target.value })}
                    placeholder="https://example.com/mcp"
                  />
                </div>
              )}

              {state?.error ? <p className="text-xs text-destructive">{state.error}</p> : null}
              {state?.tools.length ? (
                <p className="text-xs text-muted-foreground">
                  {state.tools.map((tool) => tool.name).join(", ")}
                </p>
              ) : null}
            </CardContent>
          </Card>
        );
      })}
    </Page>
  );
}
