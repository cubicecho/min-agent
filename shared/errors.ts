/**
 * What went wrong, as a sentence.
 *
 * A `catch` is handed whatever was thrown, which need not be an `Error`: a rejection can carry
 * a string, and reading `.message` off one answers `undefined`.
 * @param error What was caught.
 * @returns Its message where it is an `Error`, and the value as text where it is not.
 */
export const messageOf = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
