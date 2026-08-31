import type { TypedDocumentString } from "../gql/graphql.ts";

/**
 * The GraphQL transport, such as it is.
 *
 * There is no client library here on purpose. A query is a string and a `fetch`; a
 * subscription is the same POST with `Accept: text/event-stream` and a loop over the frames.
 * That is the whole surface a hand-written schema on graphql-yoga needs, and it is the only
 * version of it that runs unchanged in a browser, in Node, and in React Native — where
 * `EventSource` and `TextDecoderStream` do not exist and `graphql` is not on the bundler's
 * resolution path.
 */

/** `fetch` is injected because React Native's built-in one cannot stream: Expo passes `expo/fetch`. */
export interface GqlOptions {
  /**
   * The GraphQL endpoint — `"/graphql"` in the browser, an absolute
   * `"http://host:8787/graphql"` on a device. A function is re-read on every call, so a
   * client built once still follows a server address the user edits later.
   */
  endpoint: string | (() => string);
  fetch?: typeof globalThis.fetch;
}

interface GraphQLError {
  message: string;
}

interface GraphQLResponse<T> {
  data?: T | null;
  errors?: GraphQLError[];
}

/**
 * A 200 that will not parse is almost always a dev server answering an unknown path with its
 * `index.html`, and `Unexpected token '<'` says nothing about why. Name the address.
 */
const wrongServer = (endpoint: string) =>
  new Error(`${endpoint} answered with HTML, not JSON — is that the min-agent server?`);

/** GraphQL reports failure in the body, so an error list is the error even on a 200. */
function unwrap<T>(payload: GraphQLResponse<T>): T {
  if (payload.errors?.length) throw new Error(payload.errors.map((e) => e.message).join("; "));
  if (payload.data == null) throw new Error("no data");
  return payload.data;
}

export function createGqlClient({ endpoint, fetch: fetchImpl }: GqlOptions) {
  const doFetch = fetchImpl ?? globalThis.fetch;
  const url = () => (typeof endpoint === "function" ? endpoint() : endpoint);

  const post = (
    document: TypedDocumentString<unknown, unknown>,
    variables: unknown,
    accept: string,
    signal?: AbortSignal,
  ) =>
    doFetch(url(), {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: accept },
      body: JSON.stringify({ query: document.toString(), variables: variables ?? {} }),
      signal,
    });

  async function request<TResult, TVariables>(
    document: TypedDocumentString<TResult, TVariables>,
    ...[variables]: TVariables extends Record<string, never> ? [] : [TVariables]
  ): Promise<TResult> {
    const response = await post(
      document as TypedDocumentString<unknown, unknown>,
      variables,
      "application/json",
    );
    // A GraphQL error comes back as a body, not a status, so read the body either way — a 400
    // from yoga carries the reason and `response.statusText` does not.
    let payload: GraphQLResponse<TResult>;
    try {
      payload = (await response.json()) as GraphQLResponse<TResult>;
    } catch {
      if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
      throw wrongServer(url());
    }
    return unwrap(payload);
  }

  /**
   * Yields each event of a subscription. Abandoning the loop — a `break`, or the caller's
   * `signal` firing — closes the response, which is how a turn gets cancelled.
   */
  async function* subscribe<TResult, TVariables>(
    document: TypedDocumentString<TResult, TVariables>,
    variables: TVariables,
    signal?: AbortSignal,
  ): AsyncGenerator<TResult> {
    const response = await post(
      document as TypedDocumentString<unknown, unknown>,
      variables,
      "text/event-stream",
      signal,
    );

    if (!response.ok || !response.body) {
      const detail = (await response.json().catch(() => null)) as GraphQLResponse<never> | null;
      if (detail) unwrap(detail);
      throw new Error(`${response.status} ${response.statusText}`);
    }

    // Decoding by hand rather than via `TextDecoderStream`, which React Native lacks.
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) {
          // A frame carries any number of lines, and only the `data:` ones are ours — yoga's
          // keep-alives are comments, and feeding one to `JSON.parse` would end the turn on a
          // colon.
          const data = frame
            .split("\n")
            .filter((line) => line.startsWith("data:"))
            .map((line) => line.slice(5).trim())
            .join("");
          if (data) yield unwrap(JSON.parse(data) as GraphQLResponse<TResult>);
        }
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
  }

  return { request, subscribe };
}

export type GqlClient = ReturnType<typeof createGqlClient>;
