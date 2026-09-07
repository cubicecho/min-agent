import { GraphQLError, isScalarType, isSchema, printSchema, validateSchema } from "graphql";
import { GraphQLJSON } from "graphql-scalars";
import { describe, expect, it } from "vitest";
import { surfaced, UserError, userErrorIn } from "../server/errors.ts";
import { schema } from "../server/graphql/schema.ts";

/**
 * The schema itself, with no database behind it — `buildSchema` reads the table definitions,
 * and the pool does not connect until something runs a query.
 */

describe("the generated schema", () => {
  /**
   * The regression this exists for is not a schema bug but a resolution one. graphql 16 ships
   * a CommonJS and an ES build and declares no `exports` map, so Node hands every importer the
   * CommonJS one while a bundler prefers the ES one — and `graphql-parse-resolve-info`, which
   * every generated resolver calls, is CommonJS either way. Two copies of a library that
   * compares its types with `instanceof` cannot recognise each other's, and this line was
   * where it showed: "Cannot use GraphQLNonNull from another module or realm", thrown while
   * the schema was still being built. See the `graphql` alias in `vitest.config.ts`.
   */
  it("builds, and is a schema this copy of graphql recognises", () => {
    expect(isSchema(schema)).toBe(true);
    expect(validateSchema(schema)).toEqual([]);
  });

  /** The other half of the same check: a type from another package has to be ours too. */
  it("shares its type system with graphql-scalars", () => {
    expect(isScalarType(GraphQLJSON)).toBe(true);
  });

  it("has the fields the client's documents are written against", () => {
    const sdl = printSchema(schema);

    expect(sdl).toMatch(/updateSettingSingle\(/);
    expect(sdl).toMatch(/input UpdateSettingInput \{/);
    expect(sdl).toMatch(/saveMcpServers\(/);
  });
});

/**
 * What decides whether a message reaches the person who caused it. Two layers mask errors on
 * the way out — `onError` for the generated resolvers, `maskedErrors` for graphql-yoga — and
 * both ask this the same question about an error that has been wrapped on its way up.
 */
describe("userErrorIn", () => {
  it("finds one thrown directly", () => {
    expect(userErrorIn(new UserError("maxTokens: too large"))?.message).toBe(
      "maxTokens: too large",
    );
  });

  /** How GraphQL execution hands it over: located, with the throw kept on `originalError`. */
  it("finds one under a GraphQLError", () => {
    const wrapped = new GraphQLError("Internal server error", {
      originalError: new UserError("duplicate embed id"),
    });

    expect(userErrorIn(wrapped)?.message).toBe("duplicate embed id");
  });

  /** And under both wrappings at once, which is what the generated resolvers produce. */
  it("finds one two wrappings down", () => {
    const inner = new GraphQLError("Internal server error", {
      originalError: new UserError("app — url: required"),
    });

    expect(
      userErrorIn(new GraphQLError("Internal server error", { originalError: inner })),
    ).toBeDefined();
  });

  /** `cause` as well as `originalError`, since only GraphQL spells it the second way. */
  it("follows a cause chain", () => {
    expect(userErrorIn(new Error("save failed", { cause: new UserError("no url") }))?.message).toBe(
      "no url",
    );
  });

  /**
   * The half that matters more. A driver error names tables, columns, constraints and the
   * value that violated them; none of that should be decided to be safe by accident.
   */
  it("finds nothing in an error that was not written to be read", () => {
    expect(
      userErrorIn(new Error('duplicate key value violates unique constraint "settings_pkey"')),
    ).toBeUndefined();
    expect(userErrorIn(new GraphQLError("Internal server error"))).toBeUndefined();
    expect(userErrorIn(undefined)).toBeUndefined();
    expect(userErrorIn("a string")).toBeUndefined();
  });
});

describe("surfaced", () => {
  it("sends the message, under the code for a value the caller can fix", () => {
    const error = surfaced(new UserError("temperature: must be at most 2"));

    expect(error?.message).toBe("temperature: must be at most 2");
    expect(error?.extensions.code).toBe("BAD_USER_INPUT");
  });

  /** `undefined` is the answer both layers read as "carry on masking". */
  it("says nothing about an error that was not written to be read", () => {
    expect(surfaced(new Error("connection terminated unexpectedly"))).toBeUndefined();
  });
});
