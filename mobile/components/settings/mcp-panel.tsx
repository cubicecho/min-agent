// biome-ignore-all lint/suspicious/noArrayIndexKey: rows are positional — every field is a controlled input owned by `draft`, so index is the identity.
import type { McpServerConfig, McpStatus } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Text, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  ErrorNote,
  Field,
  Input,
  Loading,
  Muted,
  Screen,
  Select,
  Switch,
} from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";

const STATUS_STYLE: Record<McpStatus, string> = {
  ready: "bg-emerald-500/15",
  error: "bg-destructive/15",
  connecting: "bg-amber-500/15",
  disabled: "bg-muted",
};

const STATUS_TEXT: Record<McpStatus, string> = {
  ready: "text-emerald-500",
  error: "text-destructive",
  connecting: "text-amber-500",
  disabled: "text-muted-foreground",
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

export function McpPanel() {
  const queryClient = useQueryClient();
  const servers = useQuery({ queryKey: ["mcp"], queryFn: api.mcp, refetchInterval: 5000 });
  const [draft, setDraft] = useState<McpServerConfig[] | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (servers.data && !draft) setDraft(servers.data.map((state) => state.config));
  }, [servers.data, draft]);

  const save = useMutation({
    mutationFn: (value: McpServerConfig[]) => api.saveMcp(value),
    onSuccess: (fresh) => {
      setSaved(true);
      // Seeded from what the save read back, rather than cleared and left to a refetch.
      // Clearing it re-runs the effect above on the very next render — while the cache still
      // holds the pre-save list, because the refetch cannot have landed yet — so the form
      // filled itself back in with the servers that had just been replaced and never looked
      // again. A successful save looked like one that had been ignored.
      queryClient.setQueryData(["mcp"], fresh);
      setDraft(fresh.map((state) => state.config));
    },
  });

  const reconnect = useMutation({
    mutationFn: api.reconnectMcp,
    // The mutation answers with the same states the query reads, so there is nothing to go
    // and fetch. Only the statuses can have moved; the draft is the configs and stays put.
    onSuccess: (fresh) => queryClient.setQueryData(["mcp"], fresh),
  });

  if (servers.isError)
    return (
      <Screen>
        <ErrorNote error={servers.error} />
      </Screen>
    );
  if (!draft) return <Loading />;

  // The note below the button describes the last save, and any edit outdates it.
  const edit = (next: McpServerConfig[]) => {
    setSaved(false);
    setDraft(next);
  };

  const update = (index: number, patch: Partial<McpServerConfig>) =>
    edit(draft.map((server, i) => (i === index ? { ...server, ...patch } : server)));

  return (
    <Screen>
      <Muted>
        Connected servers expose their tools to the agent as &lt;server id&gt;__&lt;tool&gt;.
      </Muted>

      {draft.length === 0 && (
        <Card>
          <CardDescription>No servers configured yet. Add one to get started.</CardDescription>
        </Card>
      )}

      {draft.map((server, index) => {
        const state = servers.data?.find((item) => item.config.id === server.id);
        const status = state?.status ?? "connecting";

        return (
          <Card key={index}>
            <View className="flex-row items-center gap-2">
              <Text
                className="flex-1 text-base font-semibold text-card-foreground"
                numberOfLines={1}
              >
                {server.label || server.id}
              </Text>
              <Switch
                value={server.enabled}
                onValueChange={(enabled) => update(index, { enabled })}
              />
              <Button
                variant="ghost"
                size="icon"
                icon="refresh-cw"
                onPress={() => reconnect.mutate(server.id)}
              />
              <Button
                variant="ghost"
                size="icon"
                icon="trash-2"
                onPress={() => edit(draft.filter((_, i) => i !== index))}
              />
            </View>

            <View className="flex-row items-center gap-2">
              <Badge className={STATUS_STYLE[status]}>
                <Text className={`text-xs font-medium ${STATUS_TEXT[status]}`}>{status}</Text>
              </Badge>
              {state?.tools.length ? <Muted>{state.tools.length} tool(s)</Muted> : null}
            </View>

            <View className="flex-row gap-3">
              <View className="flex-1">
                <Field label="Id">
                  <Input
                    value={server.id}
                    onChangeText={(value) => update(index, { id: value })}
                    autoCapitalize="none"
                  />
                </Field>
              </View>
              <View className="flex-1">
                <Field label="Label">
                  <Input
                    value={server.label}
                    onChangeText={(value) => update(index, { label: value })}
                  />
                </Field>
              </View>
            </View>

            <Field label="Transport">
              <Select
                value={server.transport}
                options={[
                  { label: "stdio", value: "stdio" },
                  { label: "http", value: "http" },
                ]}
                onChange={(value) =>
                  update(index, { transport: value as McpServerConfig["transport"] })
                }
              />
            </Field>

            {server.transport === "stdio" ? (
              <>
                <Field label="Command">
                  <Input
                    value={server.command}
                    onChangeText={(value) => update(index, { command: value })}
                    autoCapitalize="none"
                  />
                </Field>
                <Field label="Args (space separated)">
                  <Input
                    value={server.args.join(" ")}
                    onChangeText={(value) =>
                      update(index, { args: value.split(" ").filter(Boolean) })
                    }
                    autoCapitalize="none"
                    placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                  />
                </Field>
              </>
            ) : (
              <Field label="URL">
                <Input
                  value={server.url}
                  onChangeText={(value) => update(index, { url: value })}
                  autoCapitalize="none"
                  inputMode="url"
                  placeholder="https://example.com/mcp"
                />
              </Field>
            )}

            {state?.error ? <Text className="text-xs text-destructive">{state.error}</Text> : null}
            {state?.tools.length ? (
              <Muted>{state.tools.map((tool) => tool.name).join(", ")}</Muted>
            ) : null}
          </Card>
        );
      })}

      <ErrorNote error={save.error} />
      <View className="flex-row items-center gap-2 pb-8">
        <Button
          variant="outline"
          icon="plus"
          onPress={() => edit([...draft, blank(draft.length + 1)])}
        >
          Add server
        </Button>
        <Button icon="save" busy={save.isPending} onPress={() => save.mutate(draft)}>
          Save
        </Button>
        {saved && !save.isPending && <Muted>Saved</Muted>}
      </View>
    </Screen>
  );
}
