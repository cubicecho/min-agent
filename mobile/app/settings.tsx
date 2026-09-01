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
import { defaultServerUrl, serverUrl, setServerUrl } from "@/lib/server-url.ts";

type Probe = { ok: boolean; detail: string } | null;

/**
 * Where the agent server lives. The web build served by that server needs nothing
 * here; an Android or Electron build cannot work until it is filled in.
 */
export default function SettingsScreen() {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(serverUrl());
  const [probe, setProbe] = useState<Probe>(null);
  const [busy, setBusy] = useState(false);

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

        <Field
          label="Base URL"
          hint={
            defaultServerUrl() === ""
              ? "Leave blank to use the origin this page was served from."
              : "For example http://192.168.1.20:8787 — a hostname works if your network resolves it."
          }
        >
          <Input
            value={draft}
            onChangeText={setDraft}
            onSubmitEditing={save}
            placeholder="http://localhost:8787"
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
          <Button variant="outline" onPress={() => setDraft(defaultServerUrl())}>
            Reset
          </Button>
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
