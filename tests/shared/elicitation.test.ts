import {
  contentError,
  draftOf,
  elicitationFields,
  looksSecret,
  readAnswer,
} from "@shared/elicitation.ts";

/**
 * The form a server's question is drawn as, and the answer read back out of it: what the chat
 * shows for each kind of field form mode allows, and what it will and will not send.
 */

const SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", title: "Name", minLength: 2, maxLength: 5 },
    email: { type: "string", format: "email", description: "Where to send it." },
    count: { type: "integer", minimum: 1, maximum: 3, default: 2 },
    ratio: { type: "number" },
    agree: { type: "boolean", title: "I agree", default: true },
    size: { type: "string", enum: ["s", "m"], enumNames: ["Small", "Medium"] },
    colour: { type: "string", oneOf: [{ const: "r", title: "Red" }] },
    tags: { type: "array", items: { type: "string", enum: ["a", "b", "c"] }, maxItems: 2 },
    api_key: { type: "string" },
  },
  required: ["name", "size"],
};

test("each property is read into the field that answers it, in the server's order", () => {
  expect(elicitationFields(SCHEMA)).toEqual([
    {
      name: "name",
      label: "Name",
      required: true,
      secret: false,
      kind: "text",
      minLength: 2,
      maxLength: 5,
    },
    {
      name: "email",
      label: "email",
      description: "Where to send it.",
      required: false,
      secret: false,
      kind: "text",
      format: "email",
    },
    {
      name: "count",
      label: "count",
      required: false,
      secret: false,
      kind: "number",
      integer: true,
      minimum: 1,
      maximum: 3,
      default: 2,
    },
    {
      name: "ratio",
      label: "ratio",
      required: false,
      secret: false,
      kind: "number",
      integer: false,
    },
    {
      name: "agree",
      label: "I agree",
      required: false,
      secret: false,
      kind: "boolean",
      default: true,
    },
    {
      name: "size",
      label: "size",
      required: true,
      secret: false,
      kind: "choice",
      options: [
        { value: "s", label: "Small" },
        { value: "m", label: "Medium" },
      ],
    },
    {
      name: "colour",
      label: "colour",
      required: false,
      secret: false,
      kind: "choice",
      options: [{ value: "r", label: "Red" }],
    },
    {
      name: "tags",
      label: "tags",
      required: false,
      secret: false,
      kind: "choices",
      options: ["a", "b", "c"].map((value) => ({ value, label: value })),
      maxItems: 2,
    },
    { name: "api_key", label: "api_key", required: false, secret: true, kind: "text" },
  ]);
});

test("a schema that is not an object of properties asks for nothing", () => {
  expect(elicitationFields(undefined)).toEqual([]);
  expect(elicitationFields({ type: "object" })).toEqual([]);
});

test("a form opens at the server's defaults, and empty everywhere else", () => {
  expect(draftOf(elicitationFields(SCHEMA))).toEqual({
    name: "",
    email: "",
    count: "2",
    ratio: "",
    agree: true,
    size: "",
    colour: "",
    tags: [],
    api_key: "",
  });
});

test("a filled-in form is sent typed, and a blank optional field is left out", () => {
  const fields = elicitationFields(SCHEMA);
  const draft = {
    ...draftOf(fields),
    name: "Ada",
    count: "3",
    ratio: "0.5",
    size: "m",
    tags: ["a"],
  };
  expect(readAnswer(fields, draft)).toEqual({
    content: { name: "Ada", count: 3, ratio: 0.5, agree: true, size: "m", tags: ["a"] },
    errors: {},
  });
});

test("what will not do is said under the field it is wrong in", () => {
  const fields = elicitationFields(SCHEMA);
  const draft = {
    ...draftOf(fields),
    name: "A",
    email: "nope",
    count: "1.5",
    ratio: "x",
    tags: ["a", "b", "c"],
  };
  expect(readAnswer(fields, draft).errors).toEqual({
    name: "At least 2 characters.",
    email: "Enter an email address.",
    count: "Enter a whole number.",
    ratio: "Enter a number.",
    size: "size is required.",
    tags: "Pick at most 2.",
  });
});

test("a number outside its bounds is refused with the bound", () => {
  const fields = elicitationFields(SCHEMA);
  const base = { ...draftOf(fields), name: "Ada", size: "s" };
  expect(readAnswer(fields, { ...base, count: "0" }).errors).toEqual({ count: "At least 1." });
  expect(readAnswer(fields, { ...base, count: "4" }).errors).toEqual({ count: "At most 3." });
});

test("fields named like a password or a token are marked, and their neighbours are not", () => {
  for (const name of [
    "password",
    "apiKey",
    "API key",
    "access_token",
    "client-secret",
    "pin",
    "otp",
  ]) {
    expect(looksSecret(name), name).toBe(true);
  }
  for (const name of ["compass", "footprint", "sortKey", "username", "branch", "keyboard"]) {
    expect(looksSecret(name), name).toBe(false);
  }
  // The title counts as much as the name.
  expect(looksSecret("value", "Your password")).toBe(true);
});

test("an answer that skipped the form is checked against the question all the same", () => {
  expect(contentError(SCHEMA, { name: "Ada", size: "s" })).toBeUndefined();
  expect(contentError(SCHEMA, "yes")).toBe("An accepted answer carries its fields as an object.");
  expect(contentError(SCHEMA, { name: "Ada" })).toBe("size: size is required.");
  expect(contentError(SCHEMA, { name: "Ada", size: "xl" })).toBe("size: Pick one of the choices.");
  expect(contentError(SCHEMA, { name: "Ada", size: "s", count: "2" })).toBe(
    "count: Enter a number.",
  );
  expect(contentError(SCHEMA, { name: "Ada", size: "s", extra: 1 })).toBe(
    'The question has no field "extra".',
  );
});
