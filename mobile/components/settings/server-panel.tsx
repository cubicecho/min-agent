import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { Text, View } from "react-native";
import {
  Badge,
  Button,
  Card,
  CardDescription,
  CardTitle,
  Field,
  Input,
  Screen,
} from "@/components/ui.tsx";
import { api } from "@/lib/client.ts";
import {
  defaultServerUrl,
  hasDefaultServerUrl,
  needsServerUrl,
  serverUrl,
  setServerUrl,
} from "@/lib/server-url.ts";
import { useReportDirty } from "./dirty.tsx";

type Probe = { ok: boolean; detail: string } | null;

const EXAMPLE =
  "For example http://192.168.1.20:8787 — a hostname works if your network resolves it.";

/**
 * Three situations, and only one of them is a warning. A build served by the agent may
 * leave this blank on purpose; a build handed an address at bundle time is already
 * working. A build with neither has nothing to fall back on, and saying so here is the
 * only place it can be said before a query fails somewhere less helpful.
 */
const hint = () => {
  if (needsServerUrl()) {
    return `${EXAMPLE} Nothing is guessed for you, so until this is filled in the app has nowhere to ask.`;
  }
  if (!defaultServerUrl()) return "Leave blank to use the origin this page was served from.";
  return EXAMPLE;
};

/**
 * Where the agent server lives. The web build served by that server needs nothing
 * here; an Android or Electron build cannot work until it is filled in.
 */
export function ServerPanel() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(serverUrl());
  const [probe, setProbe] = useState<Probe>(null);
  const [busy, setBusy] = useState(false);

  // The panel keeps the typed address when you switch tabs, so the tab says it is holding one.
  useReportDirty("server", draft !== serverUrl());

  const save = async () => {
    setBusy(true);
    setProbe(null);
    const saved = await setServerUrl(draft);
    setDraft(saved);
    try {
      const config = await api.config();
      setProbe({ ok: true, detail: `${config.model || "no model selected"} · ${config.baseUrl}` });
      // Everything fetched from the old address is now wrong.
      await queryClient.invalidateQueries();
    } catch (error) {
      setProbe({ ok: false, detail: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Screen>
      <Card>
        <CardTitle>Server</CardTitle>
        <CardDescription>
          The address of the min-agent server, including its port. Saving checks the connection
          before it is used.
        </CardDescription>

        <Field label="Base URL" hint={hint()}>
          <Input
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={save}
            placeholder="http://192.168.1.20:8787"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            inputMode="url"
          />
        </Field>

        <View className="flex-row gap-2">
          <Button onPress={save} busy={busy} icon="check">
            Save and test
          </Button>
          {/* Nothing to reset to on a build that was given no address; the button would
              only ever clear the box, which is not what "Reset" says. */}
          {hasDefaultServerUrl() ? (
            <Button variant="outline" onPress={() => setDraft(defaultServerUrl())}>
              Reset
            </Button>
          ) : null}
        </View>

        {probe && (
          <View className="flex-row items-center gap-2">
            <Badge variant={probe.ok ? "secondary" : "destructive"}>
              {probe.ok ? "Connected" : "Failed"}
            </Badge>
            <Text className="flex-1 text-xs text-muted-foreground">{probe.detail}</Text>
          </View>
        )}
      </Card>

      <Card>
        <CardTitle>About</CardTitle>
        <CardDescription>
          This build talks to the same server as the browser build, and is the same code: the types,
          the API client and the formatting are shared. There is no authentication — keep the server
          on a trusted network.
        </CardDescription>
      </Card>
    </Screen>
  );
}
