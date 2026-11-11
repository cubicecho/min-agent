import {
  draftOf,
  type Elicitation,
  type ElicitationAction,
  type ElicitationContent,
  type ElicitationDraft,
  type ElicitationField,
  elicitationFields,
  readAnswer,
} from "@shared/elicitation.ts";
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Send } from "@/components/app/app-icons";
import { CardLayout } from "@/components/card-layout.tsx";
import { Combobox } from "@/components/combobox.tsx";
import { Alert } from "@/components/ui/alert.tsx";
import { Button } from "@/components/ui/button.tsx";
import { Checkbox } from "@/components/ui/checkbox";
import { Field, FieldDescription, FieldError, FieldLabel } from "@/components/ui/field.tsx";
import { CircleQuestionMark } from "@/components/ui/icons";
import { Input } from "@/components/ui/input";
import type { InputType } from "@/components/ui/input-base";

/**
 * A question a tool's server is asking mid-call, drawn as a form in the turn that made the call.
 *
 * Who is asking leads, because the spec makes that the client's job: the person has to be able to
 * tell a question from the server they configured from one the model wrote. The fields are read
 * from the server's `requestedSchema` by `@shared/elicitation.ts`, which the API checks the
 * answer against as well, so what this form will not send the server would not accept either.
 */

/** What a field's text box raises on device and is on the web, from the format a server named. */
const INPUT_TYPES: Record<string, InputType> = {
  email: "email",
  uri: "url",
  date: "date",
  "date-time": "datetime-local",
};

/** How a question that is no longer waiting ended, in the turn's own words. */
const ENDED: Record<ElicitationAction, string> = {
  accept: "answered",
  decline: "declined",
  cancel: "put away",
};

/** One field's control, for the kind of value it holds. */
function Control({
  field,
  value,
  invalid,
  disabled,
  onChange,
}: {
  field: ElicitationField;
  value: ElicitationDraft[string] | undefined;
  invalid: boolean;
  disabled: boolean;
  onChange: (next: ElicitationDraft[string]) => void;
}) {
  switch (field.kind) {
    case "boolean":
      return (
        <Checkbox
          accessibilityLabel={field.label}
          checked={value === true}
          disabled={disabled}
          aria-invalid={invalid}
          onCheckedChange={onChange}
        />
      );
    case "choice":
      return (
        <Combobox
          aria-label={field.label}
          options={field.options}
          value={typeof value === "string" && value ? value : undefined}
          placeholder="Pick one"
          disabled={disabled}
          onValueChange={onChange}
        />
      );
    case "choices":
      return (
        <Combobox
          multiple
          aria-label={field.label}
          options={field.options}
          value={Array.isArray(value) ? value : []}
          placeholder="Pick any"
          disabled={disabled}
          onValueChange={onChange}
        />
      );
    default:
      return (
        <Input
          aria-label={field.label}
          type={field.kind === "number" ? "number" : (INPUT_TYPES[field.format ?? ""] ?? "text")}
          inputMode={field.kind === "number" && field.integer ? "numeric" : undefined}
          value={typeof value === "string" ? value : ""}
          disabled={disabled}
          aria-invalid={invalid}
          onChangeText={onChange}
        />
      );
  }
}

/**
 * The question, and the three ways to answer it.
 *
 * @param props.elicitation - The question, as the turn's stream carried it.
 * @param props.answer - How it ended, once it has; the form is then a line saying so.
 * @param props.onAnswer - Sends the answer. Resolves `false` for a question that was no longer
 *   waiting, which the stream will say ended in a moment anyway.
 */
export function QuestionCard({
  elicitation,
  answer,
  onAnswer,
}: {
  elicitation: Elicitation;
  answer?: ElicitationAction;
  onAnswer: (action: ElicitationAction, content?: ElicitationContent) => Promise<unknown>;
}) {
  const fields = useMemo(() => elicitationFields(elicitation.schema), [elicitation.schema]);
  const [draft, setDraft] = useState(() => draftOf(fields));
  // Errors show once Send has been tried, and then follow the typing: a form that is red before
  // anyone has touched it is telling the person off for reading it.
  const [tried, setTried] = useState(false);
  const send = useMutation({
    mutationFn: ({
      action,
      content,
    }: {
      action: ElicitationAction;
      content?: ElicitationContent;
    }) => onAnswer(action, content),
  });

  const asking = `${elicitation.server} is asking`;
  if (answer) {
    return (
      <View className="flex-row items-center gap-1.5 px-1">
        <CircleQuestionMark aria-hidden className="size-3 text-foreground/60" />
        <Text className="flex-1 text-[11px] text-foreground/60" numberOfLines={1}>
          {`${elicitation.server} asked: ${elicitation.message} · ${ENDED[answer]}`}
        </Text>
      </View>
    );
  }

  const { content, errors } = readAnswer(fields, draft);
  const secrets = fields.filter((field) => field.secret);
  const busy = send.isPending;
  const accept = () => {
    setTried(true);
    if (Object.keys(errors).length === 0) {
      send.mutate({ action: "accept", content });
    }
  };

  return (
    <CardLayout
      level={3}
      iconSlot={<CircleQuestionMark aria-hidden className="size-4 text-warning" />}
      title={asking}
      description={elicitation.message}
      className="border-warning/50"
      contentSlot={
        <>
          {secrets.length ? (
            <Alert
              variant="warning"
              title="This looks like a request for a secret"
              description={`${elicitation.server} is asking for ${secrets
                .map((field) => field.label)
                .join(
                  ", ",
                )}. A server should never ask for a password or token this way; only answer if you trust it with one.`}
            />
          ) : null}
          {fields.map((field) => {
            const error = tried ? errors[field.name] : undefined;
            return (
              <Field key={field.name} disabled={busy}>
                <FieldLabel>
                  {field.required ? field.label : `${field.label} (optional)`}
                </FieldLabel>
                <Control
                  field={field}
                  value={draft[field.name]}
                  invalid={Boolean(error)}
                  disabled={busy}
                  onChange={(next) => setDraft((held) => ({ ...held, [field.name]: next }))}
                />
                {field.description ? (
                  <FieldDescription>{field.description}</FieldDescription>
                ) : null}
                <FieldError>{error}</FieldError>
              </Field>
            );
          })}
          {send.error ? (
            <Alert
              variant="destructive"
              title="The answer was not sent"
              description={send.error.message}
            />
          ) : null}
        </>
      }
      footerSlot={
        <Button
          variant="outline"
          disabled={busy}
          hint="Put the question away without answering. The tool is told it was cancelled."
          onPress={() => send.mutate({ action: "cancel" })}
          content="Cancel"
        />
      }
      footerActionsSlot={
        <>
          <Button
            variant="destructive-outline"
            disabled={busy}
            onPress={() => send.mutate({ action: "decline" })}
            content="Decline"
          />
          <Button
            variant="positive"
            loading={busy}
            onPress={accept}
            iconSlot={<Send aria-hidden />}
            content="Send"
          />
        </>
      }
    />
  );
}
