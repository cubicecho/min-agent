import {
  HOOK_EVENTS_FIRED,
  INJECT_EVENTS,
  type McpServerConfig,
  type McpServerState,
  type McpStatus,
  type ToolHookConfig,
} from "@shared/types.ts";
import { useStore } from "@tanstack/react-form";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Text } from "react-native";
import { ActionButton } from "@/components/action-button";
import { useAppForm } from "@/components/app/app-form";
import { Globe, Server, Terminal } from "@/components/app/app-icons";
import { ConfirmButton } from "@/components/confirm-button";
import { DialogLayout } from "@/components/dialog-layout";
import { ListItem } from "@/components/list-item";
import { EmptyState } from "@/components/page";
import { QueryState } from "@/components/query-state";
import { Section } from "@/components/section";
import { Alert } from "@/components/ui/alert";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { ChevronRight, Plus, RefreshCw, Trash2, X } from "@/components/ui/icons";
import { SwitchField as SwitchRow } from "@/components/ui/switch-field";
import { api } from "@/lib/client.ts";
import { useReportDirty } from "./dirty.tsx";
import { LongTextField, TextField } from "./fields.tsx";
import { PanelBody } from "./panel-body.tsx";

/**
 * The MCP servers the agent can call tools on.
 *
 * The screen is a list and the editing happens in a dialog over it, for the reason the apps
 * list is: what you come here to read is which servers are connected and what they are
 * offering, and eight form fields per server said none of that until you had scrolled past
 * them. A row is now the answer — connected, how many tools, pointed where — and the form is
 * behind it.
 *
 * Every edit goes through the dialog and its Save — the switch that connects a server, its
 * hooks and which of its tools the model is offered included. The mutation replaces the whole
 * set, the way `saveEmbeds` does.
 */

const STATUS_VARIANT: Record<McpStatus, BadgeVariant> = {
  ready: "positive",
  error: "destructive",
  connecting: "warning",
  idle: "secondary",
  disabled: "secondary",
};

const TRANSPORTS = [
  { label: "stdio — a command this machine runs", value: "stdio" },
  { label: "http — a URL it connects to", value: "http" },
];

const title = (server: Pick<McpServerConfig, "label" | "id">) => server.label || server.id;

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

/** What a hook injects up to when nobody has said: the pool's own default. */
const DEFAULT_MAX_TOKENS = 1000;

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * A hook as the form holds it. The stored shape leaves most of this optional and keeps the
 * arguments as JSON; a form wants every field present and the arguments as the text being
 * typed, because text on its way to being valid JSON is most of what is in the box.
 */
type HookDraft = {
  id: string;
  enabled: boolean;
  on: ToolHookConfig["on"];
  tool: string;
  argsText: string;
  inject: boolean;
  maxTokens: number;
  /** Not edited here; carried so a save does not drop it. */
  timeoutMs: number | undefined;
};

/** A server as the form holds it: the args as one line, the hooks as drafts. */
type ServerDraft = Omit<McpServerConfig, "args" | "hooks"> & { args: string; hooks: HookDraft[] };

const toDraft = (server: McpServerConfig): ServerDraft => ({
  ...server,
  args: server.args.join(" "),
  hooks: server.hooks.map((hook) => ({
    id: hook.id,
    enabled: hook.enabled !== false,
    on: hook.on,
    tool: hook.tool,
    // Pretty JSON, or nothing for a tool that takes none.
    argsText: hook.args === undefined ? "" : JSON.stringify(hook.args, null, 2),
    inject: Boolean(hook.inject),
    maxTokens: hook.maxTokens ?? DEFAULT_MAX_TOKENS,
    timeoutMs: hook.timeoutMs,
  })),
});

/** Back to what is stored. Only called on text the field's validator has already parsed. */
const fromDraft = (draft: ServerDraft): McpServerConfig => ({
  ...draft,
  args: draft.args.split(" ").filter(Boolean),
  hooks: draft.hooks.map((hook) => {
    // Context can only be added ahead of a request, so it goes when the hook moves off one.
    const injects = INJECT_EVENTS.has(hook.on) && hook.inject;
    return {
      id: hook.id,
      on: hook.on,
      tool: hook.tool,
      ...(hook.argsText.trim() ? { args: JSON.parse(hook.argsText) } : {}),
      ...(injects ? { inject: true } : {}),
      ...(injects && hook.maxTokens !== DEFAULT_MAX_TOKENS ? { maxTokens: hook.maxTokens } : {}),
      ...(hook.timeoutMs === undefined ? {} : { timeoutMs: hook.timeoutMs }),
      ...(hook.enabled ? {} : { enabled: false }),
    };
  }),
});

/** The next `hook-N` this row has not used, for the same reason `blank` counts servers. */
const nextHookId = (hooks: HookDraft[]) => {
  let n = hooks.length + 1;
  while (hooks.some((hook) => hook.id === `hook-${n}`)) n += 1;
  return `hook-${n}`;
};

/** Why the arguments are not JSON yet, or nothing when they are. Save waits on this. */
const argsProblem = (text: string) => {
  if (!text.trim()) return undefined;
  try {
    JSON.parse(text);
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
};

/** Which row the dialog is editing: an index into the list, or a new row at the end. */
type Editing = { index: number | null; value: McpServerConfig };

const StatusBadge = ({ status }: { status: McpStatus }) => (
  <Badge variant={STATUS_VARIANT[status]}>{status}</Badge>
);

/** One line of the list: what it is, where it points, whether it answered, and how much of it. */
function Row({ state, onOpen }: { state: McpServerState; onOpen: () => void }) {
  const { config, status, error, tools } = state;
  const Glyph = config.transport === "stdio" ? Terminal : Globe;
  const counts = [
    tools.length ? plural(tools.length, "tool") : "",
    config.hooks.length ? plural(config.hooks.length, "hook") : "",
  ].filter(Boolean);

  return (
    <ListItem
      className="border border-border bg-card"
      leadingSlot={
        <Glyph
          className={config.enabled ? "size-4 text-foreground" : "size-4 text-muted-foreground"}
        />
      }
      title={title(config)}
      titleClassName={config.enabled ? undefined : "text-muted-foreground"}
      // The error is the most useful thing a broken row can say, so it takes the second line
      // off the address — you already know where you pointed it.
      description={
        status === "error" && error ? (
          <Text className="text-destructive">{error}</Text>
        ) : (
          target(config) || "Nothing to connect to"
        )
      }
      meta={
        <>
          {counts.length ? (
            <Text className="text-muted-foreground text-xs">{counts.join(" · ")}</Text>
          ) : null}
          <StatusBadge status={status} />
        </>
      }
      actionSlot={<ChevronRight className="size-4 text-muted-foreground" />}
      onPress={onOpen}
    />
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
 * `visible` is the panel's, not the dialog's: a dialog is drawn outside the tree it is
 * written in, so hiding the panel behind another tab would leave this floating over whatever
 * you switched to. It is hidden with the panel and kept mounted, so the half-typed server is
 * still here when you come back.
 */
function Editor({
  visible,
  initial,
  state,
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
  error: unknown;
  onCancel: () => void;
  onSave: (value: McpServerConfig) => Promise<unknown>;
  onRemove: () => void;
  onReconnect: () => void;
  reconnecting: boolean;
}) {
  const existing = Boolean(state);
  const toolNames = state?.tools.map((tool) => tool.name) ?? [];
  const toolOptions = toolNames.map((tool) => ({ label: tool, value: tool }));
  const name = title(initial);

  // Memoised: the list behind this is polled, and defaults that change identity on every
  // render would be re-applied over what is being typed.
  const defaultValues = useMemo(() => toDraft(initial), [initial]);
  const form = useAppForm({
    defaultValues,
    // A refused save is reported by the mutation, under the fields; the form only has to
    // stay open with what was typed.
    onSubmit: ({ value }) => onSave(fromDraft(value)).catch(() => {}),
  });

  const dirty = useStore(form.store, (store) => !store.isDefaultValue);
  // Puts a dot on the tab while there is a server typed and not yet saved behind it.
  useReportDirty("mcp", dirty);

  const addHook = () =>
    form.pushFieldValue("hooks", {
      id: nextHookId(form.state.values.hooks),
      enabled: true,
      on: "beforeTurn",
      tool: toolNames[0] ?? "",
      argsText: "",
      inject: false,
      maxTokens: DEFAULT_MAX_TOKENS,
      timeoutMs: undefined,
    });

  return (
    <form.AppForm>
      <DialogLayout
        open={visible}
        onOpenChange={(open) => {
          if (!open) onCancel();
        }}
        size="lg"
        title={existing ? name : "Add a server"}
        description="An MCP server, and what min-agent does with its tools."
        hasUnsavedChanges={() => !form.state.isDefaultValue}
        footerSlot={
          existing ? (
            <ConfirmButton
              variant="ghost"
              size="icon"
              label={`Remove ${name}`}
              title={`Remove ${name}?`}
              description="The agent loses its tools, and its hooks stop running."
              confirmLabel="Remove"
              onConfirm={onRemove}
              iconSlot={<Trash2 className="size-4" />}
            />
          ) : null
        }
        footerActionsSlot={(close) => (
          <>
            <Button variant="outline" onPress={close} content="Cancel" />
            <form.SubmitButton isEdit={existing} createLabel="Add server" editLabel="Save" />
          </>
        )}
        contentSlot={
          <Form className="gap-4">
            {state ? (
              <Section
                surface="card"
                title="Connection"
                level={3}
                actionSlot={
                  <>
                    <StatusBadge status={state.status} />
                    <Button
                      variant="outline"
                      size="sm"
                      loading={reconnecting}
                      aria-label={`Reconnect ${name}`}
                      onPress={onReconnect}
                      iconSlot={<RefreshCw className="size-4" />}
                      content="Reconnect"
                    />
                  </>
                }
                contentClassName="flex flex-col gap-2"
                contentSlot={
                  <>
                    {state.error ? <Alert variant="destructive" description={state.error} /> : null}
                    {/*
                      Off hides a tool from the model and leaves it to this server's hooks: a
                      memory server's `remember` is for the hooks to call after every turn, not
                      for the model to decide on.
                    */}
                    <form.AppField name="hiddenTools">
                      {(field) => (
                        <>
                          {state.tools.map((tool) => {
                            const hidden = field.state.value.includes(tool.name);
                            return (
                              <SwitchRow
                                key={tool.name}
                                id={`mcp-tool-${tool.name}`}
                                label={tool.name}
                                labelClassName={hidden ? "line-through" : "text-card-foreground"}
                                checked={!hidden}
                                onCheckedChange={(offered) =>
                                  field.handleChange(
                                    offered
                                      ? field.state.value.filter((item) => item !== tool.name)
                                      : [...field.state.value, tool.name],
                                  )
                                }
                              />
                            );
                          })}
                        </>
                      )}
                    </form.AppField>
                    {state.tools.length ? (
                      <Text className="text-muted-foreground text-xs">
                        Switched off: only this server's hooks can call it.
                      </Text>
                    ) : null}
                  </>
                }
              />
            ) : null}

            <form.AppField name="label">
              {() => <TextField label="Label" placeholder="Filesystem" autoFocus={!existing} />}
            </form.AppField>

            <form.AppField name="transport">
              {(field) => <field.OptionSelectField label="Transport" options={TRANSPORTS} />}
            </form.AppField>

            <form.Subscribe selector={(store) => store.values.transport}>
              {(transport) =>
                transport === "stdio" ? (
                  <>
                    <form.AppField name="command">
                      {() => <TextField label="Command" placeholder="npx" />}
                    </form.AppField>
                    <form.AppField name="args">
                      {() => (
                        <TextField
                          label="Args"
                          description="Separated by spaces."
                          placeholder="-y @modelcontextprotocol/server-filesystem /tmp"
                        />
                      )}
                    </form.AppField>
                  </>
                ) : (
                  <form.AppField name="url">
                    {() => (
                      <TextField
                        label="URL"
                        inputMode="url"
                        placeholder="https://example.com/mcp"
                      />
                    )}
                  </form.AppField>
                )
              }
            </form.Subscribe>

            <form.AppField name="id">
              {() => (
                <TextField
                  label="Id"
                  description="Prefixes every tool it offers: <id>__<tool>. Letters, digits, _ or -."
                />
              )}
            </form.AppField>

            <form.AppField name="enabled">
              {(field) => <field.SwitchField label="Connect to it" />}
            </form.AppField>

            <Section
              title="Hooks"
              level={3}
              description="This server's tools, called by min-agent at points in a chat rather than by the model. A hook that fails is noted under the reply and never stops the turn."
              actionSlot={
                <Button
                  variant="outline"
                  size="sm"
                  onPress={addHook}
                  iconSlot={<Plus className="size-4" />}
                  content="Add hook"
                />
              }
              contentClassName="flex flex-col gap-3"
              contentSlot={
                <form.AppField name="hooks" mode="array">
                  {(hooks) => (
                    <>
                      {hooks.state.value.map((_, index) => (
                        <Section
                          // The hooks have no identity but their place: the id is a field.
                          // biome-ignore lint/suspicious/noArrayIndexKey: see above
                          key={index}
                          surface="card"
                          title={`Hook ${index + 1}`}
                          level={4}
                          actionSlot={
                            <ActionButton
                              variant="ghost"
                              size="icon-sm"
                              label={`Remove hook ${index + 1}`}
                              onPress={() => hooks.removeValue(index)}
                              iconSlot={<X className="size-4" />}
                            />
                          }
                          contentClassName="flex flex-col gap-3"
                          contentSlot={
                            <>
                              <form.AppField name={`hooks[${index}].id`}>
                                {() => <TextField label="Id" />}
                              </form.AppField>
                              <form.AppField name={`hooks[${index}].enabled`}>
                                {(field) => <field.SwitchField label="Run it" />}
                              </form.AppField>
                              <form.AppField name={`hooks[${index}].on`}>
                                {(field) => (
                                  <field.OptionSelectField label="When" options={EVENT_OPTIONS} />
                                )}
                              </form.AppField>
                              <form.AppField name={`hooks[${index}].tool`}>
                                {(field) =>
                                  // A server that is not connected yet is typed by hand.
                                  toolOptions.length ? (
                                    <field.OptionSelectField label="Tool" options={toolOptions} />
                                  ) : (
                                    <TextField
                                      label="Tool"
                                      placeholder="The tool's own name, without the id prefix"
                                    />
                                  )
                                }
                              </form.AppField>
                              <form.AppField
                                name={`hooks[${index}].argsText`}
                                validators={{ onChange: ({ value }) => argsProblem(value) }}
                              >
                                {() => (
                                  <LongTextField
                                    label="Arguments"
                                    description="JSON. {{prompt}}, {{reply}}, {{session.id}}, {{turn.messages}}, {{compacting}} fill in at run time."
                                    rows={4}
                                    className="font-mono text-xs"
                                  />
                                )}
                              </form.AppField>
                              <form.Subscribe selector={(store) => store.values.hooks[index]}>
                                {(hook) =>
                                  hook && INJECT_EVENTS.has(hook.on) ? (
                                    <>
                                      <form.AppField name={`hooks[${index}].inject`}>
                                        {(field) => (
                                          <field.SwitchField label="Add what it returns to the request" />
                                        )}
                                      </form.AppField>
                                      {hook.inject ? (
                                        <form.AppField name={`hooks[${index}].maxTokens`}>
                                          {(field) => (
                                            <field.NumberField
                                              label="At most this many tokens"
                                              description="1000 when left alone."
                                              integer
                                            />
                                          )}
                                        </form.AppField>
                                      ) : null}
                                    </>
                                  ) : null
                                }
                              </form.Subscribe>
                            </>
                          }
                        />
                      ))}
                    </>
                  )}
                </form.AppField>
              }
            />

            {error ? (
              <Alert variant="destructive" title="Not saved" description={messageOf(error)} />
            ) : null}
          </Form>
        }
      />
    </form.AppForm>
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

  const list = servers.data ?? [];
  const configs = list.map((state) => state.config);

  // Every write is the whole list, so each of these is "the list, with one row changed".
  const commit = (value: McpServerConfig) =>
    save.mutateAsync(
      editing?.index == null
        ? [...configs, value]
        : configs.map((server, i) => (i === editing.index ? value : server)),
    );

  const remove = (index: number) => save.mutate(configs.filter((_, i) => i !== index));

  return (
    <PanelBody
      content={
        <>
          <Section
            title="MCP servers"
            description="Connected servers expose their tools to the agent as <server id>__<tool>."
            actionSlot={
              servers.isSuccess ? (
                <Button
                  variant="outline"
                  onPress={() => setEditing({ index: null, value: blank(configs) })}
                  iconSlot={<Plus className="size-4" />}
                  content="Add server"
                />
              ) : undefined
            }
            contentClassName="flex flex-col gap-2"
            contentSlot={
              <>
                {/* The dialog reports its own failures; this is for the ones nothing is open to catch. */}
                {!editing && save.error ? (
                  <Alert
                    variant="destructive"
                    title="Not saved"
                    description={messageOf(save.error)}
                  />
                ) : null}
                <QueryState
                  query={servers}
                  what="MCP servers"
                  count={list.length}
                  emptySlot={
                    <EmptyState
                      icon={Server}
                      title="No servers yet"
                      description="Add one to give the agent some tools."
                    />
                  }
                />
                {list.map((state, index) => (
                  <Row
                    key={state.config.id}
                    state={state}
                    onOpen={() => setEditing({ index, value: state.config })}
                  />
                ))}
              </>
            }
          />

          {editing ? (
            <Editor
              key={editing.index ?? "new"}
              visible={active}
              initial={editing.value}
              state={editing.index === null ? undefined : list[editing.index]}
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
          ) : null}
        </>
      }
    />
  );
}
