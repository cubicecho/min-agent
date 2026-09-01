import { describe, expect, it } from "vitest";
import { embedSchema, embedTitle } from "../shared/types.ts";

/**
 * The embed rows go into the database through `saveEmbeds`, which parses them with this
 * schema — so what is worth testing is the part the Drizzle-generated mutation cannot check:
 * that the URL is one a browser may be pointed at, and what a row falls back to.
 */

const valid = { id: "kanban", label: "Kanban", url: "http://192.168.1.10:3000" };

describe("embedSchema", () => {
  it("fills in the defaults for a row with only an id and a url", () => {
    const embed = embedSchema.parse({ id: "kanban", url: "https://example.com" });
    expect(embed).toMatchObject({ label: "", icon: "grid", mode: "iframe", enabled: true });
  });

  it("accepts http and https", () => {
    expect(embedSchema.parse(valid).url).toBe(valid.url);
    expect(embedSchema.parse({ ...valid, url: "https://board.example.com" }).mode).toBe("iframe");
  });

  /**
   * The one that matters. A stored URL is written into an iframe's `src` and handed to
   * `Linking.openURL`, and `javascript:` in either runs in min-agent's own origin — so the
   * scheme is settled on the way into the database rather than trusted at the point of use.
   */
  it("rejects a scheme that is not http or https", () => {
    for (const url of ["javascript:alert(1)", "data:text/html,<b>x", "file:///etc/passwd"]) {
      expect(embedSchema.safeParse({ ...valid, url }).success).toBe(false);
    }
  });

  it("rejects a relative url and a missing one", () => {
    expect(embedSchema.safeParse({ ...valid, url: "/board" }).success).toBe(false);
    expect(embedSchema.safeParse({ id: "kanban" }).success).toBe(false);
  });

  it("rejects an id that is not route-safe", () => {
    for (const id of ["", "has space", "has/slash", "-leading"]) {
      expect(embedSchema.safeParse({ ...valid, id }).success).toBe(false);
    }
  });

  /**
   * A row written by a build whose icon list was longer still has to load: an unknown glyph
   * draws nothing at all, and losing one to `grid` beats a sidebar that will not render.
   */
  it("falls back to a known icon rather than refusing the row", () => {
    expect(embedSchema.parse({ ...valid, icon: "not-a-feather-glyph" }).icon).toBe("grid");
  });
});

describe("embedTitle", () => {
  it("uses the label, and the id when there is none", () => {
    expect(embedTitle(embedSchema.parse(valid))).toBe("Kanban");
    expect(embedTitle(embedSchema.parse({ ...valid, label: "  " }))).toBe("kanban");
  });
});
