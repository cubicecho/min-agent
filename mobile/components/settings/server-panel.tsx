import { useStore } from "@tanstack/react-form";
import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useAppForm } from "@/components/app/app-form";
import { Alert } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Form } from "@/components/ui/form";
import { Check, CircleCheck } from "@/components/ui/icons";
import { api } from "@/lib/client.ts";
import {
  defaultServerUrl,
  hasDefaultServerUrl,
  needsServerUrl,
  serverUrl,
  setServerUrl,
} from "@/lib/server-url.ts";
import { useReportDirty } from "./dirty.tsx";
import { TextField } from "./fields.tsx";
import { PanelBody } from "./panel-body.tsx";
import { SettingsCard } from "./settings-card.tsx";

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
  if (!defaultServerUrl()) {
    return "Leave blank to use the origin this page was served from.";
  }
  return EXAMPLE;
};

/**
 * Where the agent server lives. The web build served by that server needs nothing
 * here; an Android or Electron build cannot work until it is filled in.
 */
export function ServerPanel() {
  const queryClient = useQueryClient();
  const [probe, setProbe] = useState<Probe>(null);

  const form = useAppForm({
    defaultValues: { url: serverUrl() },
    onSubmit: async ({ value, formApi }) => {
      setProbe(null);
      const saved = await setServerUrl(value.url);
      // What was stored is the new clean state, and it may not be what was typed: the address
      // is tidied on the way in.
      formApi.reset({ url: saved });
      try {
        const config = await api.config();
        setProbe({
          ok: true,
          detail: `${config.model || "no model selected"} · ${config.baseUrl}`,
        });
        // Everything fetched from the old address is now wrong.
        await queryClient.invalidateQueries();
      } catch (error) {
        setProbe({ ok: false, detail: error instanceof Error ? error.message : String(error) });
      }
    },
  });

  // The panel keeps the typed address when you switch tabs, so the tab says it is holding one.
  const dirty = useStore(form.store, (state) => !state.isDefaultValue);
  useReportDirty("server", dirty);

  return (
    <PanelBody
      content={
        <>
          <form.AppForm>
            <SettingsCard
              title="Server"
              description="The address of the min-agent server, including its port. Saving checks the connection before it is used."
              contentSlot={
                <Form className="gap-4">
                  <form.AppField name="url">
                    {() => (
                      <TextField
                        label="Base URL"
                        description={hint()}
                        placeholder="http://192.168.1.20:8787"
                        inputMode="url"
                        onSubmitEditing={() => void form.handleSubmit()}
                      />
                    )}
                  </form.AppField>
                  {probe ? (
                    <Alert
                      variant={probe.ok ? "default" : "destructive"}
                      {...(probe.ok ? { icon: <CircleCheck /> } : {})}
                      title={probe.ok ? "Connected" : "Failed"}
                      description={probe.detail}
                    />
                  ) : null}
                </Form>
              }
              footerActionsSlot={
                <>
                  {/* Nothing to reset to on a build that was given no address; the button would
                      only ever clear the box, which is not what "Reset" says. */}
                  {hasDefaultServerUrl() ? (
                    <Button
                      variant="outline"
                      onPress={() => form.setFieldValue("url", defaultServerUrl())}
                      content="Reset"
                    />
                  ) : null}
                  <form.SubmitButton
                    iconSlot={<Check className="size-4" />}
                    createLabel="Save and test"
                    savingLabel="Testing…"
                  />
                </>
              }
            />
          </form.AppForm>

          <SettingsCard
            title="About"
            description="This build talks to the same server as the browser build, and is the same code: the types, the API client and the formatting are shared. There is no authentication — keep the server on a trusted network."
          />
        </>
      }
    />
  );
}
