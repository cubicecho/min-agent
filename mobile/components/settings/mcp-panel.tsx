import { Feather } from "@react-native-vector-icons/feather";
import {
  HOOK_EVENTS_FIRED,
  INJECT_EVENTS,
  type McpServerConfig,
  type McpServerState,
  type McpStatus,
  type ToolHookConfig,
} from "@shared/types.ts";
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
  NumberInput,
  Screen,
  Select,
  Switch,
  Textarea,
} from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import { colors } from "@/lib/theme.ts";
import { useReportDirty } from "./dirty.tsx";

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
  idle: "bg-muted",
  disabled: "bg-muted",
};

const STATUS_TEXT: Record<McpStatus, string> = {
  ready: "text-emerald-500",
  error: "text-destructive",
  connecting: "text-amber-500",
  idle: "text-muted-foreground",
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
    hiddenTools: [],
    hooks: [],
  };
};

const EVENT_OPTIONS = HOOK_EVENTS_FIRED.map((event) => ({ label: event, value: event }));

/** A hook's arguments as they are typed: pretty JSON, or nothing for a tool that takes none. */
const argsText = (args: unknown) => (args === undefined ? "" : JSON.stringify(args, null, 2));

/** The next `hook-N` this row has not used, for the same reason `blank` counts servers. */
const nextHookId = (hooks: ToolHookConfig[]) => {
  let n = hooks.length + 1;
  while (hooks.some((hook) => hook.id === `hook-${n}`)) n += 1;
  return `hook-${n}`;
};

/**
 * One hook: when it runs, which of the server's tools it calls, and with what.
 *
 * The arguments are typed as JSON and kept as text here, because text on its way to being
 * valid JSON is most of what is in the box while someone is typing it. Only a parse that
 * works reaches the draft, and one that does not is reported up so that Save can wait.
 */
function HookEditor({
  hook,
  tools,
  onChange,
  onRemove,
  onBroken,
}: {
  hook: ToolHookConfig;
  /** The server's tools, when it is connected. A server that is not yet is typed by hand. */
  tools: string[];
  onChange: (hook: ToolHookConfig) => void;
  onRemove: () => void;
  onBroken: (broken: boolean) => void;
}) {
  const [text, setText] = useState(() => argsText(hook.args));
  const [problem, setProblem] = useState("");
  const injects = INJECT_EVENTS.includes(hook.on);
  const update = (patch: Partial<ToolHookConfig>) => onChange({ ...hook, ...patch });

  const typeArgs = (value: string) => {
    setText(value);
    try {
      const args = value.trim() ? JSON.parse(value) : undefined;
      setProblem("");
      onBroken(false);
      update({ args });
    } catch (error) {
      setProblem((error as Error).message);
      onBroken(true);
    }
  };

  return (
    <View className="gap-2 rounded-lg border border-border bg-card p-3">
      <View className="flex-row items-center gap-2">
        <View className="flex-1">
          <Input
            value={hook.id}
            onChangeText={(id) => update({ id })}
            autoCapitalize="none"
            autoCorrect={false}
            accessibilityLabel="Hook id"
          />
        </View>
        <Switch value={hook.enabled !== false} onValueChange={(enabled) => update({ enabled })} />
        <Button
          variant="ghost"
          size="icon"
          icon="x"
          accessibilityLabel={`Remove hook ${hook.id}`}
          onPress={onRemove}
        />
      </View>
      <Field label="When">
        <Select
          value={hook.on}
          options={EVENT_OPTIONS}
          onChange={(on) => {
            const event = on as ToolHookConfig["on"];
            // Context can only be added ahead of a request, so it goes when the hook moves off one.
            update(
              INJECT_EVENTS.includes(event)
                ? { on: event }
                : { on: event, inject: undefined, maxTokens: undefined },
            );
          }}
        />
      </Field>
      <Field label="Tool">
        {tools.length ? (
          <Select
            value={hook.tool}
            options={tools.map((tool) => ({ label: tool, value: tool }))}
            onChange={(tool) => update({ tool })}
          />
        ) : (
          <Input
            value={hook.tool}
            onChangeText={(tool) => update({ tool })}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="The tool's own name, without the id prefix"
          />
        )}
      </Field>
      <Field
        label="Arguments"
        hint="JSON. {{prompt}}, {{reply}}, {{session.id}}, {{turn.messages}}, {{compacting}} fill in at run time."
      >
        <Textarea
          value={text}
          onChangeText={typeArgs}
          rows={4}
          autoCapitalize="none"
          autoCorrect={false}
          className="font-mono text-xs"
        />
      </Field>
      {problem ? <Text className="text-xs text-destructive">{problem}</Text> : null}
      {injects ? (
        <>
          <View className="flex-row items-center gap-3">
            <Switch value={Boolean(hook.inject)} onValueChange={(inject) => update({ inject })} />
            <Text className="text-sm text-popover-foreground">
              Add what it returns to the request
            </Text>
          </View>
          {hook.inject ? (
            <Field label="At most this many tokens" hint="1000 when left alone.">
              <NumberInput
                value={hook.maxTokens ?? 1000}
                onChangeValue={(maxTokens) => update({ maxTokens })}
                integer
              />
            </Field>
          ) : null}
        </>
      ) : null}
    </View>
  );
}

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
          {config.hooks.length ? <Muted>{config.hooks.length} hook(s)</Muted> : null}
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
 *
 * `visible` is the panel's, not the dialog's: a `Modal` is drawn outside the tree it is
 * written in, so hiding the panel behind another tab would leave this floating over whatever
 * you switched to. It is hidden with the panel and kept mounted, so the half-typed server is
 * still here when you come back.
 */
function Editor({
  visible,
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
  visible: boolean;
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
  // A key per hook that outlives edits to its id, and which of them hold JSON that does not
  // parse yet. Save waits on the second: the draft still has the last arguments that did.
  const [hookKeys, setHookKeys] = useState(() => initial.hooks.map((_, i) => i));
  const [broken, setBroken] = useState<ReadonlySet<number>>(new Set());
  const toolNames = state?.tools.map((tool) => tool.name) ?? [];

  // Puts a dot on the tab while there is a server typed and not yet saved behind it.
  useReportDirty("mcp", JSON.stringify(draft) !== JSON.stringify(initial));

  // A remove left primed and forgotten is a delete waiting to happen on the next stray tap.
  useEffect(() => {
    if (!armed) return;
    const timer = setTimeout(() => setArmed(false), ARMED_FOR);
    return () => clearTimeout(timer);
  }, [armed]);

  // Functional, because a hook's editor reports a parse and a change in the same breath.
  const update = (patch: Partial<McpServerConfig>) => setDraft((prev) => ({ ...prev, ...patch }));

  const toggleHidden = (name: string, hidden: boolean) =>
    update({
      hiddenTools: hidden
        ? [...draft.hiddenTools, name]
        : draft.hiddenTools.filter((tool) => tool !== name),
    });

  const setHook = (index: number, hook: ToolHookConfig) =>
    setDraft((prev) => ({
      ...prev,
      hooks: prev.hooks.map((item, i) => (i === index ? hook : item)),
    }));

  const markBroken = (key: number, isBroken: boolean) =>
    setBroken((prev) => {
      if (prev.has(key) === isBroken) return prev;
      const next = new Set(prev);
      if (isBroken) next.add(key);
      else next.delete(key);
      return next;
    });

  const addHook = () => {
    setHookKeys((keys) => [...keys, Math.max(-1, ...keys) + 1]);
    update({
      hooks: [
        ...draft.hooks,
        { id: nextHookId(draft.hooks), on: "beforeTurn", tool: toolNames[0] ?? "" },
      ],
    });
  };

  const removeHook = (index: number) => {
    markBroken(hookKeys[index], false);
    setHookKeys((keys) => keys.filter((_, i) => i !== index));
    update({ hooks: draft.hooks.filter((_, i) => i !== index) });
  };

  return (
    <Dialog
      visible={visible}
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
          <Button icon="save" busy={busy} disabled={broken.size > 0} onPress={() => onSave(draft)}>
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
          {/*
            Off hides a tool from the model and leaves it to this server's hooks: a memory
            server's `remember` is for the hooks to call after every turn, not for the model
            to decide on.
          */}
          {state.tools.map((tool) => (
            <View key={tool.name} className="flex-row items-center gap-3">
              <Switch
                value={!draft.hiddenTools.includes(tool.name)}
                onValueChange={(offered) => toggleHidden(tool.name, !offered)}
              />
              <Text
                className={`flex-1 text-xs ${draft.hiddenTools.includes(tool.name) ? "text-muted-foreground line-through" : "text-card-foreground"}`}
                numberOfLines={1}
              >
                {tool.name}
              </Text>
            </View>
          ))}
          {state.tools.length ? (
            <Muted>Switched off: only this server's hooks can call it.</Muted>
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

      <View className="gap-2">
        <Text className="text-sm font-medium text-foreground">Hooks</Text>
        <Muted>
          This server's tools, called by min-agent at points in a chat rather than by the model. A
          hook that fails is noted under the reply and never stops the turn.
        </Muted>
        {draft.hooks.map((hook, index) => (
          <HookEditor
            key={hookKeys[index]}
            hook={hook}
            tools={toolNames}
            onChange={(next) => setHook(index, next)}
            onRemove={() => removeHook(index)}
            onBroken={(isBroken) => markBroken(hookKeys[index], isBroken)}
          />
        ))}
        <View className="flex-row">
          <Button variant="outline" size="sm" icon="plus" onPress={addHook}>
            Add hook
          </Button>
        </View>
      </View>

      <ErrorNote error={error} />
    </Dialog>
  );
}

/** How often the panel asks after the servers while it is the one on screen. */
const POLL = 5000;

export function McpPanel({ active = true }: { active?: boolean }) {
  const queryClient = useQueryClient();
  // The panel stays mounted behind another tab, so the poll is tied to being looked at. The
  // settings shell keeps a slow one of its own running for the dot on the tab.
  const servers = useQuery({
    queryKey: ["mcp"],
    queryFn: api.mcp,
    refetchInterval: active ? POLL : false,
  });
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
          visible={active}
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
