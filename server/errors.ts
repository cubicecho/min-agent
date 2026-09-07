import { GraphQLError } from "graphql";

/**
 * An error whose message was written for the person who caused it.
 *
 * Everything else a resolver can throw is masked on the way out, and rightly so: a driver
 * error names tables, columns, constraints and the value that violated them, and a stack
 * names paths on the machine. Two layers do that masking independently — `onError` in
 * `graphql/schema.ts` for the generated resolvers, and `maskedErrors` in `index.ts` for
 * graphql-yoga — and neither can tell "the number you typed is out of range" from "the
 * connection dropped mid-statement". So the ones that are safe to show say so by their type,
 * and both layers let exactly those through.
 *
 * The bar for throwing one: the message names something the person did, in words they used.
 * `maxTokens: Number must be less than or equal to 200000` qualifies. Anything quoting the
 * database, the filesystem or a stack does not, however helpful it would be to a developer —
 * that belongs in the server log, which is where masking leaves it.
 */
export class UserError extends Error {
  /**
   * Set explicitly rather than left to the class name. Bundlers rename classes, and both
   * masking layers are reached through package boundaries where a renamed `instanceof` would
   * quietly stop matching and take the message with it.
   */
  override name = "UserError";
}

/**
 * The `UserError` at the bottom of an error chain, if there is one.
 *
 * By the time a throw reaches either masking layer it has usually been wrapped: GraphQL's
 * execution locates it, and drizzle-graphql may have replaced it with its own generic error
 * while keeping the original on `originalError`. Both are chains ending at what was thrown.
 */
export function userErrorIn(error: unknown): UserError | undefined {
  for (let link = error; link instanceof Error; link = originalOf(link)) {
    if (link instanceof UserError || link.name === "UserError") return link as UserError;
  }
  return undefined;
}

/** GraphQL spells the wrapped error `originalError`; everything else spells it `cause`. */
const originalOf = (error: Error): unknown =>
  (error as { originalError?: unknown }).originalError ?? error.cause;

/**
 * The error to send in place of one that was written to be read, or `undefined` when there is
 * none — which both masking layers take as "carry on masking".
 *
 * `BAD_USER_INPUT` is the code the rest of the ecosystem uses for a value the caller can fix,
 * and it is what tells a client that retrying the same request will fail the same way.
 */
export function surfaced(error: unknown): GraphQLError | undefined {
  const shown = userErrorIn(error);
  return shown && new GraphQLError(shown.message, { extensions: { code: "BAD_USER_INPUT" } });
}
