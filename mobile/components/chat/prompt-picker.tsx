import type { McpPrompt } from "@shared/types.ts";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { Badge, Button, Dialog, Empty, ErrorNote, Input, Muted } from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";

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
 * Shares `["mcp-prompts"]` with the dialog below, so opening the picker draws from what this
 * already fetched instead of asking again. No poll: a prompt list changes when an operator edits
 * the MCP tab, and the tab already invalidates on save.
 */
export const useMcpPrompts = () =>
  useQuery({ queryKey: ["mcp-prompts"], queryFn: api.mcpPrompts, staleTime: 60_000 });

/** A prompt's own name for itself, falling back to the id the server addresses it by. */
const titleOf = (prompt: McpPrompt) => prompt.title?.trim() || prompt.name;

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
    <Dialog
      visible={visible}
      title={chosen ? titleOf(chosen) : "MCP prompts"}
      onClose={close}
      footer={
        chosen ? (
          <>
            <Button variant="secondary" onPress={() => setChosen(null)}>
              Back
            </Button>
            <View className="flex-1" />
            <Button
              icon="corner-down-left"
              busy={expand.isPending}
              disabled={missing}
              onPress={() => expand.mutate(chosen)}
            >
              Insert
            </Button>
          </>
        ) : undefined
      }
    >
      <ErrorNote error={prompts.error ?? expand.error} />

      {chosen ? (
        <View className="gap-4">
          {chosen.description ? <Muted>{chosen.description}</Muted> : null}
          {chosen.arguments.map((arg) => (
            <View key={arg.name} className="gap-1.5">
              <Text className="text-sm font-medium text-foreground">
                {arg.name}
                {arg.required ? "" : " (optional)"}
              </Text>
              <Input
                value={values[arg.name] ?? ""}
                onChangeText={(next) => setValues((held) => ({ ...held, [arg.name]: next }))}
                placeholder={arg.description ?? ""}
              />
            </View>
          ))}
        </View>
      ) : prompts.data?.length ? (
        <View className="gap-2">
          {prompts.data.map((prompt) => (
            <Pressable
              key={`${prompt.server}/${prompt.name}`}
              onPress={() => pick(prompt)}
              className="gap-1 rounded-lg border border-border bg-card p-3"
            >
              <View className="flex-row items-center gap-2">
                <Text className="flex-1 text-sm font-medium text-foreground">
                  {titleOf(prompt)}
                </Text>
                <Badge variant="secondary">{prompt.serverLabel}</Badge>
              </View>
              {prompt.description ? <Muted>{prompt.description}</Muted> : null}
            </Pressable>
          ))}
        </View>
      ) : (
        <Empty>{prompts.isLoading ? "Looking…" : "No connected MCP server offers prompts."}</Empty>
      )}
    </Dialog>
  );
}
