/**
 * A question an MCP server asks the person mid-call — MCP's `elicitation/create` in form mode —
 * read into the fields the chat draws and checked the same way on both ends.
 *
 * Shared because the two ends have to agree on what an answer is: the chat turns what was typed
 * into the content a server is sent, and the server checks that content against the same schema
 * before it passes it on, so an answer that skipped the form is refused for the same reasons one
 * typed into it would have been.
 *
 * Form mode allows a flat object of strings, numbers, booleans and enums — single choice or
 * several — and nothing nested. A property of any other shape is read as a text box, which is the
 * nearest thing a person can still answer.
 */

/** A question as the chat is sent it, while the turn that caused it waits for the answer. */
export interface Elicitation {
  /** Minted by the server here, for the answer to name. */
  id: string;
  /** The tool call whose server is asking, so the question sits under that call's card. */
  toolUseId: string;
  /** The config id of the server asking. */
  serverId: string;
  /** The name the server is shown under, which is what the person reads as "who is asking". */
  server: string;
  /** The server's question. */
  message: string;
  /** The `requestedSchema`, as the server sent it. */
  schema: unknown;
}

/** The three ways to answer: give the content, refuse to, or put the question away unanswered. */
export const ELICITATION_ACTIONS = ["accept", "decline", "cancel"] as const;
export type ElicitationAction = (typeof ELICITATION_ACTIONS)[number];

/** One answered field, as form mode allows it. */
export type ElicitationValue = string | number | boolean | string[];
export type ElicitationContent = Record<string, ElicitationValue>;

/** One choice of an enum field: what is sent, and what is shown. */
export interface ElicitationOption {
  value: string;
  label: string;
}

interface FieldBase {
  /** The property's name, which is the key its value is sent under. */
  name: string;
  /** The server's `title` for it, or the name. */
  label: string;
  description?: string;
  required: boolean;
  /** Named like a password or a token — see `looksSecret`. */
  secret: boolean;
}

/** One field of a question's form. */
export type ElicitationField =
  | (FieldBase & {
      kind: "text";
      minLength?: number;
      maxLength?: number;
      format?: string;
      default?: string;
    })
  | (FieldBase & {
      kind: "number";
      integer: boolean;
      minimum?: number;
      maximum?: number;
      default?: number;
    })
  | (FieldBase & { kind: "boolean"; default?: boolean })
  | (FieldBase & { kind: "choice"; options: ElicitationOption[]; default?: string })
  | (FieldBase & {
      kind: "choices";
      options: ElicitationOption[];
      minItems?: number;
      maxItems?: number;
      default?: string[];
    });

/**
 * What a field holds while it is being filled in. A number is held as it was typed, so `1.` and a
 * lone `-` survive the keystroke that makes them; it is read as a number when the form is sent.
 */
export type ElicitationDraft = Record<string, string | boolean | string[]>;

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown) => (typeof value === "string" ? value : undefined);
const finite = (value: unknown) =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const strings = (value: unknown) =>
  Array.isArray(value) && value.every((item) => typeof item === "string")
    ? (value as string[])
    : undefined;

/** Words that, alone in a field's name, say it wants a secret. */
const SECRET_WORD =
  /^(password|passwd|passphrase|passcode|pwd|secrets?|tokens?|credentials?|pin|otp|mfa|totp)$/;
/** Pairs that only say so together: a `key` alone is a sort key as often as an API key. */
const SECRET_JOINED = /(api|access|private|secret|signing|auth)key/;

/**
 * Whether a field is named like a password or a token.
 *
 * The spec says a server must not use elicitation to ask for a secret, and a client must make it
 * clear who is asking — so the chat cannot refuse the question, but it can say what it looks like.
 * Read by words, split at punctuation and at camelCase, so `apiKey`, `api_key` and `API key` are
 * all one, while a `compass` is not a `pass` and a `footprint` holds no `otp`.
 *
 * @param names - The property's name and its title.
 */
export function looksSecret(...names: (string | undefined)[]): boolean {
  return names.some((name) => {
    if (!name) {
      return false;
    }
    const words = name
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter(Boolean);
    return words.some((word) => SECRET_WORD.test(word)) || SECRET_JOINED.test(words.join(""));
  });
}

/** An enum's choices, in any of the spellings form mode has had: `oneOf`, `enum` + `enumNames`. */
function optionsOf(property: Json): ElicitationOption[] | undefined {
  const titled = Array.isArray(property.oneOf) ? property.oneOf : property.anyOf;
  if (Array.isArray(titled)) {
    return titled.flatMap((option) =>
      isObject(option) && typeof option.const === "string"
        ? [{ value: option.const, label: text(option.title) || option.const }]
        : [],
    );
  }
  const values = strings(property.enum);
  if (!values) {
    return undefined;
  }
  const names = strings(property.enumNames);
  return values.map((value, index) => ({ value, label: names?.[index] || value }));
}

/** One property of the schema, read into the field that answers it. */
function fieldOf(name: string, property: Json, required: boolean): ElicitationField {
  const label = text(property.title)?.trim() || name;
  const base: FieldBase = {
    name,
    label,
    ...(text(property.description) ? { description: text(property.description) } : {}),
    required,
    secret: looksSecret(name, text(property.title)),
  };
  if (property.type === "boolean") {
    const fallback = typeof property.default === "boolean" ? property.default : undefined;
    return { ...base, kind: "boolean", ...(fallback === undefined ? {} : { default: fallback }) };
  }
  if (property.type === "number" || property.type === "integer") {
    return {
      ...base,
      kind: "number",
      integer: property.type === "integer",
      ...pick({ minimum: finite(property.minimum), maximum: finite(property.maximum) }),
      ...pick({ default: finite(property.default) }),
    };
  }
  if (property.type === "array" && isObject(property.items)) {
    const options = optionsOf(property.items);
    if (options) {
      return {
        ...base,
        kind: "choices",
        options,
        ...pick({ minItems: finite(property.minItems), maxItems: finite(property.maxItems) }),
        ...pick({ default: strings(property.default) }),
      };
    }
  }
  const options = optionsOf(property);
  if (options) {
    return { ...base, kind: "choice", options, ...pick({ default: text(property.default) }) };
  }
  return {
    ...base,
    kind: "text",
    ...pick({ minLength: finite(property.minLength), maxLength: finite(property.maxLength) }),
    ...pick({ format: text(property.format), default: text(property.default) }),
  };
}

/** The members that are set, so an absent bound is absent rather than `undefined`. */
function pick<T extends Record<string, unknown>>(values: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(values).filter(([, value]) => value !== undefined),
  ) as Partial<T>;
}

/**
 * The fields a question asks for, in the order the server listed them.
 *
 * @param schema - The `requestedSchema`. Anything that is not an object schema asks for nothing.
 */
export function elicitationFields(schema: unknown): ElicitationField[] {
  if (!isObject(schema) || !isObject(schema.properties)) {
    return [];
  }
  const required = new Set(strings(schema.required) ?? []);
  return Object.entries(schema.properties).flatMap(([name, property]) =>
    isObject(property) ? [fieldOf(name, property, required.has(name))] : [],
  );
}

/** A form's first state: each field at the server's default, or empty. */
export function draftOf(fields: ElicitationField[]): ElicitationDraft {
  return Object.fromEntries(
    fields.map((field): [string, string | boolean | string[]] => {
      switch (field.kind) {
        case "boolean":
          return [field.name, field.default ?? false];
        case "number":
          return [field.name, field.default === undefined ? "" : String(field.default)];
        case "choices":
          return [field.name, field.default ?? []];
        default:
          return [field.name, field.default ?? ""];
      }
    }),
  );
}

const EMAIL = /^[^\s@]+@[^\s@]+$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
// A scheme and something after it. Not `URL.canParse`, which React Native's `URL` does not have.
const URI = /^[a-z][a-z0-9+.-]*:\S+$/i;

/** What is wrong with a string against its format, which the spec names and a server checks. */
function formatError(format: string | undefined, value: string): string | undefined {
  switch (format) {
    case "email":
      return EMAIL.test(value) ? undefined : "Enter an email address.";
    case "uri":
      return URI.test(value) ? undefined : "Enter a full address, such as https://example.com.";
    case "date":
      return DATE.test(value) && !Number.isNaN(Date.parse(value))
        ? undefined
        : "Enter a date as YYYY-MM-DD.";
    case "date-time":
      return Number.isNaN(Date.parse(value)) ? "Enter a date and time." : undefined;
    default:
      return undefined;
  }
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

/**
 * What is wrong with one answered value, if anything. `undefined` is a field left empty.
 *
 * @param field - The field it answers.
 * @param value - The value, as it would be sent.
 * @returns The sentence to show under the field, or `undefined` when it will do.
 */
export function valueError(
  field: ElicitationField,
  value: ElicitationValue | undefined,
): string | undefined {
  if (value === undefined) {
    return field.required ? `${field.label} is required.` : undefined;
  }
  switch (field.kind) {
    case "text": {
      if (typeof value !== "string") {
        return `${field.label} takes text.`;
      }
      if (field.minLength !== undefined && value.length < field.minLength) {
        return `At least ${plural(field.minLength, "character")}.`;
      }
      if (field.maxLength !== undefined && value.length > field.maxLength) {
        return `At most ${plural(field.maxLength, "character")}.`;
      }
      return formatError(field.format, value);
    }
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) {
        return "Enter a number.";
      }
      if (field.integer && !Number.isInteger(value)) {
        return "Enter a whole number.";
      }
      if (field.minimum !== undefined && value < field.minimum) {
        return `At least ${field.minimum}.`;
      }
      if (field.maximum !== undefined && value > field.maximum) {
        return `At most ${field.maximum}.`;
      }
      return undefined;
    }
    case "boolean":
      return typeof value === "boolean" ? undefined : `${field.label} is yes or no.`;
    case "choice":
      return typeof value === "string" && field.options.some((option) => option.value === value)
        ? undefined
        : "Pick one of the choices.";
    case "choices": {
      const allowed = new Set(field.options.map((option) => option.value));
      if (!Array.isArray(value) || value.some((item) => !allowed.has(item))) {
        return "Pick from the choices.";
      }
      if (field.minItems !== undefined && value.length < field.minItems) {
        return `Pick at least ${field.minItems}.`;
      }
      if (field.maxItems !== undefined && value.length > field.maxItems) {
        return `Pick at most ${field.maxItems}.`;
      }
      return undefined;
    }
  }
}

/**
 * One field as it will be sent: a number read from what was typed, and an empty box as nothing
 * at all, since an optional field left blank is not the empty string.
 */
function sentValue(
  field: ElicitationField,
  held: string | boolean | string[] | undefined,
): ElicitationValue | undefined {
  switch (field.kind) {
    case "boolean":
      return typeof held === "boolean" ? held : false;
    case "choices": {
      // A required list left empty is sent empty, for `valueError` to say how many it wants.
      const picked = Array.isArray(held) ? held : [];
      if (picked.length === 0 && !field.required) {
        return undefined;
      }
      return picked;
    }
    case "number": {
      const typed = typeof held === "string" ? held.trim() : "";
      return typed === "" ? undefined : Number(typed);
    }
    default:
      return typeof held === "string" && held !== "" ? held : undefined;
  }
}

/**
 * Reads a filled-in form into the content an `accept` carries.
 *
 * @param fields - The question's fields.
 * @param draft - What the form holds.
 * @returns The content, and the error under each field that will not do. Send only when `errors`
 *   is empty.
 */
export function readAnswer(
  fields: ElicitationField[],
  draft: ElicitationDraft,
): { content: ElicitationContent; errors: Record<string, string> } {
  const content: ElicitationContent = {};
  const errors: Record<string, string> = {};
  for (const field of fields) {
    const value = sentValue(field, draft[field.name]);
    const error = valueError(field, value);
    if (error) {
      errors[field.name] = error;
    }
    if (value !== undefined) {
      content[field.name] = value;
    }
  }
  return { content, errors };
}

/**
 * What is wrong with an accepted answer as it arrived, before it goes to the server that asked.
 *
 * The chat's form cannot send one of these, but the mutation is open to anything that can reach
 * the API, and a server is owed an answer to the question it asked.
 *
 * @param schema - The question's `requestedSchema`.
 * @param content - The answer.
 * @returns The first thing wrong with it, or `undefined` when it will do.
 */
export function contentError(schema: unknown, content: unknown): string | undefined {
  if (!isObject(content)) {
    return "An accepted answer carries its fields as an object.";
  }
  const fields = elicitationFields(schema);
  const named = new Set(fields.map((field) => field.name));
  const stray = Object.keys(content).find((key) => !named.has(key));
  if (stray) {
    return `The question has no field "${stray}".`;
  }
  for (const field of fields) {
    const error = valueError(field, content[field.name] as ElicitationValue | undefined);
    if (error) {
      return `${field.name}: ${error}`;
    }
  }
  return undefined;
}
