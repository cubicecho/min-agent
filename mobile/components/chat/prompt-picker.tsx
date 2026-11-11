import type { McpPrompt, McpPromptArgument } from "@shared/types.ts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { View } from "react-native";
import { CornerDownLeft } from "@/components/app/app-icons";
import { DialogLayout } from "@/components/dialog-layout.tsx";
import { EmptyState } from "@/components/empty-state.tsx";
import { ListItem } from "@/components/list-item.tsx";
import { LoadState } from "@/components/load-state.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button.tsx";
import { Field, FieldLabel } from "@/components/ui/field.tsx";
import { Input } from "@/components/ui/input";
import { SEARCH_DEBOUNCE_MS, useSettledText } from "@/components/ui/search-input-base";
import { api } from "@/lib/client.ts";
import { queryKeys } from "@/lib/queries.ts";

/**
 * The prompts a connected MCP server offers, as something you pick and edit before sending.
 *
 * A prompt is the server author's phrasing of a job their server is good at, and the protocol
 * calls it user-controlled: it is meant to reach a person as a menu item, not a model as a tool.
 * So this expands into the composer's draft rather than into the session. The template comes back
 * as text you can read, cut and add to before it goes anywhere — which is the whole point of a
 * starting point, and the difference between a prompt and a macro.
 */

/**
 * Whether there is anything to pick, for the composer's button.
 *
 * Shares `queryKeys.mcpPrompts` with the dialog below, so opening the picker draws from what this
 * already fetched instead of asking again. No poll: a prompt list changes when an operator edits
 * the MCP tab, and the tab already invalidates on save.
 */
export const useMcpPrompts = () =>
  useQuery({ queryKey: queryKeys.mcpPrompts, queryFn: api.mcpPrompts, staleTime: 60_000 });

/** A prompt's own name for itself, falling back to the id the server addresses it by. */
const titleOf = (prompt: McpPrompt) => prompt.title?.trim() || prompt.name;

/** The most suggestions drawn under a field. A server may send a hundred. */
const MAX_SUGGESTIONS = 8;

/**
 * One of a prompt's arguments, with what its server suggests for it under the box.
 *
 * Asked once on opening, for an empty box — a server can list a repository's branches before a
 * letter is typed — and again each time typing pauses, through the registry's own settle timer
 * rather than a request per key. The other arguments go with the question, so a server can narrow
 * by what is already filled in; they are read when it is asked, not part of when it is asked, so
 * typing in one field does not set the others asking. A server that cannot complete answers
 * nothing and the field is a plain box.
 */
function ArgumentField({
  prompt,
  arg,
  values,
  onChange,
}: {
  prompt: McpPrompt;
  arg: McpPromptArgument;
  values: Record<string, string>;
  onChange: (next: string) => void;
}) {
  const value = values[arg.name] ?? "";
  const [asked, setAsked] = useState("");
  const settled = useSettledText(setAsked, SEARCH_DEBOUNCE_MS);
  const suggestions = useQuery({
    queryKey: [...queryKeys.mcpPrompts, "complete", prompt.server, prompt.name, arg.name, asked],
    queryFn: () =>
      api.mcpPromptCompletions(
        prompt.server,
        prompt.name,
        { name: arg.name, value: asked },
        values,
      ),
    staleTime: 30_000,
  });
  // Nothing to offer once the box already holds the one suggestion there is.
  const shown = (suggestions.data ?? [])
    .filter((suggestion) => suggestion !== value)
    .slice(0, MAX_SUGGESTIONS);

  const set = (next: string) => {
    onChange(next);
    settled.later(next);
  };

  return (
    <Field>
      <FieldLabel>{arg.required ? arg.name : `${arg.name} (optional)`}</FieldLabel>
      <Input
        aria-label={arg.name}
        value={value}
        onChangeText={set}
        placeholder={arg.description ?? ""}
      />
      {shown.length > 0 ? (
        <View className="flex-row flex-wrap gap-1.5">
          {shown.map((suggestion) => (
            <Button
              key={suggestion}
              variant="outline"
              size="xs"
              className="h-auto rounded-full py-1"
              onPress={() => set(suggestion)}
              content={suggestion}
            />
          ))}
        </View>
      ) : null}
    </Field>
  );
}

export function PromptPicker({
  visible,
  onClose,
  onInsert,
}: {
  visible: boolean;
  onClose: () => void;
  onInsert: (text: string) => void;
}) {
  const prompts = useMcpPrompts();
  const [chosen, setChosen] = useState<McpPrompt | null>(null);
  const [values, setValues] = useState<Record<string, string>>({});

  const close = () => {
    setChosen(null);
    setValues({});
    onClose();
  };

  const expand = useMutation({
    mutationFn: (prompt: McpPrompt) => api.mcpPrompt(prompt.server, prompt.name, values),
    onSuccess: (text) => {
      onInsert(text);
      close();
    },
  });

  /**
   * A prompt with no blanks to fill has nothing to show on a second screen, so picking it is
   * the whole interaction — one tap rather than a tap, an empty form and a confirm.
   */
  const pick = (prompt: McpPrompt) => {
    if (prompt.arguments.length === 0) {
      setValues({});
      expand.mutate(prompt);
      return;
    }
    setValues({});
    setChosen(prompt);
  };

  const missing =
    chosen?.arguments.some((arg) => arg.required && !values[arg.name]?.trim()) ?? false;

  return (
    <DialogLayout
      open={visible}
      onOpenChange={(open) => {
        const isClosing = open === false;
        if (isClosing) {
          close();
        }
      }}
      title={chosen ? titleOf(chosen) : "MCP prompts"}
      description={chosen?.description || undefined}
      footerSlot={
        chosen ? (
          <Button variant="outline" onPress={() => setChosen(null)} content="Back" />
        ) : undefined
      }
      footerActionsSlot={
        chosen ? (
          <Button
            disabled={missing}
            loading={expand.isPending}
            onPress={() => expand.mutate(chosen)}
            iconSlot={<CornerDownLeft aria-hidden />}
            content="Insert"
          />
        ) : undefined
      }
      contentSlot={
        <View className="gap-4">
          {expand.error ? (
            <Alert
              variant="destructive"
              title="The prompt could not be expanded"
              description={expand.error.message}
            />
          ) : null}

          {chosen ? (
            chosen.arguments.map((arg) => (
              <ArgumentField
                key={arg.name}
                prompt={chosen}
                arg={arg}
                values={values}
                onChange={(next) => setValues((held) => ({ ...held, [arg.name]: next }))}
              />
            ))
          ) : (
            <>
              <LoadState
                query={prompts}
                what="prompts"
                count={prompts.data?.length ?? 0}
                emptySlot={<EmptyState compact title="No connected MCP server offers prompts." />}
              />
              {prompts.data?.length ? (
                <View className="gap-2">
                  {prompts.data.map((prompt) => (
                    <ListItem
                      key={`${prompt.server}/${prompt.name}`}
                      title={titleOf(prompt)}
                      description={prompt.description || undefined}
                      meta={<Badge variant="secondary">{prompt.serverLabel}</Badge>}
                      onPress={() => pick(prompt)}
                      className="rounded-lg border border-border bg-card"
                    />
                  ))}
                </View>
              ) : null}
            </>
          )}
        </View>
      }
    />
  );
}
