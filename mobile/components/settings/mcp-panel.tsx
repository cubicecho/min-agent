import { Feather } from "@react-native-vector-icons/feather";
import type { McpServerConfig, McpServerState, McpStatus } from "@shared/types.ts";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { Pressable, Text, View } from "react-native";
import {
  Badge,
  Button,
  Dialog,
  Empty,
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
import { colors } from "@/lib/theme.ts";

/**
 * The MCP servers the agent can call tools on.
 *
 * The screen is a list and the editing happens in a dialog over it, for the reason the apps
 * list is: what you come here to read is which servers are connected and what they are
 * offering, and eight form fields per server said none of that until you had scrolled past
 * them. A row is now the answer — connected, how many tools, pointed where — and the form is
 * behind it.
 *
 * There is no Save button. The mutation replaces the whole set, the way `saveEmbeds` does, so
 * the dialog is the unit of work: closing it has already saved, or has told you why it could
 * not. The switch on a row saves on the spot, because turning a server off is the one edit
 * worth making without opening anything.
 */

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

const TRANSPORTS = [
  { label: "stdio — a command this machine runs", value: "stdio" },
  { label: "http — a URL it connects to", value: "http" },
];

/** How long a primed remove stays primed before it forgets it was ever asked. */
const ARMED_FOR = 5000;

const title = (server: McpServerConfig) => server.label || server.id;

/** Where a server actually is, which is a command line or a URL depending on the transport. */
const target = (server: McpServerConfig) =>
  server.transport === "stdio" ? [server.command, ...server.args].join(" ").trim() : server.url;

const blank = (taken: McpServerConfig[]): McpServerConfig => {
  // Ids are unique or the save is refused, and the id of the row just deleted is the one the
  // next `server-N` would land on.
  let n = taken.length + 1;
  while (taken.some((server) => server.id === `server-${n}`)) n += 1;
  return {
    id: `server-${n}`,
    label: "",
    enabled: true,
    transport: "stdio",
    command: "npx",
    args: [],
    env: {},
    url: "",
    headers: {},
  };
};

/** Which row the dialog is editing: an index into the list, or a new row at the end. */
type Editing = { index: number | null; value: McpServerConfig };

const StatusBadge = ({ status }: { status: McpStatus }) => (
  <Badge className={STATUS_STYLE[status]}>
    <Text className={`text-xs font-medium ${STATUS_TEXT[status]}`}>{status}</Text>
  </Badge>
);

/** One line of the list: what it is, where it points, whether it answered, and how much of it. */
function Row({
  state,
  onOpen,
  onToggle,
}: {
  state: McpServerState;
  onOpen: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  const { config, status, error, tools } = state;
  // The error is the most useful thing a broken row can say, so it takes the second line off
  // the address — you already know where you pointed it.
  const detail = status === "error" && error ? error : target(config) || "Nothing to connect to";

  return (
    <Pressable
      onPress={onOpen}
      accessibilityRole="button"
      accessibilityLabel={`Edit ${title(config)}`}
      className="flex-row items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 active:bg-muted"
    >
      <Feather
        name={config.transport === "stdio" ? "terminal" : "globe"}
        size={17}
        color={config.enabled ? colors.foreground : colors.mutedForeground}
      />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text
            className={`shrink text-sm font-medium ${config.enabled ? "text-card-foreground" : "text-muted-foreground"}`}
            numberOfLines={1}
          >
            {title(config)}
          </Text>
          <StatusBadge status={status} />
          {tools.length ? <Muted>{tools.length} tool(s)</Muted> : null}
        </View>
        <Text
          className={`text-xs ${status === "error" ? "text-destructive" : "text-muted-foreground"}`}
          numberOfLines={1}
        >
          {detail}
        </Text>
      </View>
      <Switch value={config.enabled} onValueChange={onToggle} />
      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
    </Pressable>
  );
}

/**
 * The create/edit form. It owns its own draft so typing does not re-render the list behind it,
 * and it is seeded afresh every time the dialog opens — `key` on the caller — rather than
 * syncing an effect against the row it was opened on.
 *
 * The status block at the top describes the running connection, not the draft: reconnecting
 * uses what is stored, so it is worth pressing before you have changed anything and honest
 * about what it did after.
 */
function Editor({
  initial,
  state,
  busy,
  error,
  onCancel,
  onSave,
  onRemove,
  onReconnect,
  reconnecting,
}: {
  initial: McpServerConfig;
  state?: McpServerState;
  busy: boolean;
  error: unknown;
  onCancel: () => void;
  onSave: (value: McpServerConfig) => void;
  onRemove: () => void;
  onReconnect: () => void;
  reconnecting: boolean;
}) {
  const [draft, setDraft] = useState(initial);
  const [armed, setArmed] = useState(false);
  const existing = Boolean(state);

  // A remove left primed and forgotten is a delete waiting to happen on the next stray tap.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_FOR);
    return () => clearTimeout(timer);
  }, [armed]);

  const update = (patch: Partial<McpServerConfig>) => setDraft({ ...draft, ...patch });

  return (
    <Dialog
      visible
      title={existing ? title(draft) : "Add a server"}
      onClose={onCancel}
      footer={
        <>
          {existing &&
            (armed ? (
              <Button size="sm" variant="destructive" busy={busy} onPress={onRemove}>
                Remove?
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="icon"
                icon="trash-2"
                accessibilityLabel={`Remove ${title(draft)}`}
                onPress={() => setArmed(true)}
              />
            ))}
          <View className="flex-1" />
          <Button variant="outline" onPress={onCancel}>
            Cancel
          </Button>
          <Button icon="save" busy={busy} onPress={() => onSave(draft)}>
            Save
          </Button>
        </>
      }
    >
      {state ? (
        <View className="gap-2 rounded-lg border border-border bg-card p-3">
          <View className="flex-row items-center gap-2">
            <StatusBadge status={state.status} />
            {state.tools.length ? <Muted>{state.tools.length} tool(s)</Muted> : null}
            <View className="flex-1" />
            <Button
              variant="outline"
              size="sm"
              icon="refresh-cw"
              busy={reconnecting}
              accessibilityLabel={`Reconnect ${title(draft)}`}
              onPress={onReconnect}
            >
              Reconnect
            </Button>
          </View>
          {state.error ? <Text className="text-xs text-destructive">{state.error}</Text> : null}
          {state.tools.length ? (
            <Muted>{state.tools.map((tool) => tool.name).join(", ")}</Muted>
          ) : null}
        </View>
      ) : null}

      <Field label="Label">
        <Input
          value={draft.label}
          onChangeText={(label) => update({ label })}
          placeholder="Filesystem"
          autoFocus={!existing}
        />
      </Field>

      <Field label="Transport">
        <Select
          value={draft.transport}
          options={TRANSPORTS}
          onChange={(transport) => update({ transport: transport as McpServerConfig["transport"] })}
        />
      </Field>

      {draft.transport === "stdio" ? (
        <>
          <Field label="Command">
            <Input
              value={draft.command}
              onChangeText={(command) => update({ command })}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="npx"
            />
          </Field>
          <Field label="Args" hint="Separated by spaces.">
            <Input
              value={draft.args.join(" ")}
              onChangeText={(value) => update({ args: value.split(" ").filter(Boolean) })}
              autoCapitalize="none"
              autoCorrect={false}
              placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
            />
          </Field>
        </>
      ) : (
        <Field label="URL">
          <Input
            value={draft.url}
            onChangeText={(url) => update({ url })}
            autoCapitalize="none"
            autoCorrect={false}
            inputMode="url"
            placeholder="https://example.com/mcp"
          />
        </Field>
      )}

      <Field
        label="Id"
        hint="Prefixes every tool it offers: <id>__<tool>. Letters, digits, _ or -."
      >
        <Input
          value={draft.id}
          onChangeText={(id) => update({ id })}
          autoCapitalize="none"
          autoCorrect={false}
        />
      </Field>

      <View className="flex-row items-center gap-3">
        <Switch value={draft.enabled} onValueChange={(enabled) => update({ enabled })} />
        <Text className="text-sm text-popover-foreground">Connect to it</Text>
      </View>

      <ErrorNote error={error} />
    </Dialog>
  );
}

export function McpPanel() {
  const queryClient = useQueryClient();
  const servers = useQuery({ queryKey: ["mcp"], queryFn: api.mcp, refetchInterval: 5000 });
  const [editing, setEditing] = useState<Editing | null>(null);

  const save = useMutation({
    mutationFn: (value: McpServerConfig[]) => api.saveMcp(value),
    // Seeded from what the save read back rather than invalidated: the statuses come back
    // with it, so a refetch would only ask again for what is already in hand.
    onSuccess: (fresh) => {
      queryClient.setQueryData(["mcp"], fresh);
      setEditing(null);
    },
  });

  const reconnect = useMutation({
    mutationFn: api.reconnectMcp,
    // The mutation answers with the same states the query reads, so there is nothing to go
    // and fetch. Only the statuses can have moved.
    onSuccess: (fresh) => queryClient.setQueryData(["mcp"], fresh),
  });

  if (servers.isError)
    return (
      <Screen>
        <ErrorNote error={servers.error} />
      </Screen>
    );
  if (servers.isLoading) return <Loading />;

  const list = servers.data ?? [];
  const configs = list.map((state) => state.config);

  // Every write is the whole list, so each of these is "the list, with one row changed".
  const commit = (value: McpServerConfig) =>
    save.mutate(
      editing?.index == null
        ? [...configs, value]
        : configs.map((server, i) => (i === editing.index ? value : server)),
    );

  const remove = (index: number) => save.mutate(configs.filter((_, i) => i !== index));

  const toggle = (index: number, enabled: boolean) =>
    save.mutate(configs.map((server, i) => (i === index ? { ...server, enabled } : server)));

  return (
    <Screen>
      <Muted>
        Connected servers expose their tools to the agent as &lt;server id&gt;__&lt;tool&gt;.
      </Muted>

      {/* The dialog reports its own failures; this is for the ones nothing is open to catch. */}
      {!editing && <ErrorNote error={save.error} />}

      {list.length === 0 ? (
        <Empty>No servers yet. Add one to give the agent some tools.</Empty>
      ) : (
        <View className="gap-2">
          {list.map((state, index) => (
            <Row
              key={state.config.id}
              state={state}
              onOpen={() => setEditing({ index, value: state.config })}
              onToggle={(enabled) => toggle(index, enabled)}
            />
          ))}
        </View>
      )}

      <View className="flex-row pb-8">
        <Button
          variant="outline"
          icon="plus"
          onPress={() => setEditing({ index: null, value: blank(configs) })}
        >
          Add server
        </Button>
      </View>

      {editing && (
        <Editor
          key={editing.index ?? "new"}
          initial={editing.value}
          state={editing.index === null ? undefined : list[editing.index]}
          busy={save.isPending}
          error={save.error}
          reconnecting={reconnect.isPending}
          onCancel={() => {
            save.reset();
            setEditing(null);
          }}
          onSave={commit}
          onRemove={() => editing.index !== null && remove(editing.index)}
          onReconnect={() => reconnect.mutate(editing.value.id)}
        />
      )}
    </Screen>
  );
}
