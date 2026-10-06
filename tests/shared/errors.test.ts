import { messageOf } from "@shared/errors.ts";
import { describe, expect, it } from "vitest";

/**
 * `catch` hands over whatever was thrown, and nothing makes that an `Error`: a library can
 * reject with a string, and an aborted `fetch` with whatever reason it was given.
 */
describe("messageOf", () => {
  it("is an error's message", () => {
    expect(messageOf(new Error("no route to host"))).toBe("no route to host");
  });

  it.each([
    ["a string", "timed out", "timed out"],
    ["a number", 503, "503"],
    ["nothing", undefined, "undefined"],
    ["an object that is not an error", { code: "EPIPE" }, "[object Object]"],
  ])("is %s as text when that is what was thrown", (_what, thrown, said) => {
    expect(messageOf(thrown)).toBe(said);
  });
});
