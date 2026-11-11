import { createInbox } from "../../server/inbox.ts";

describe("the inbox", () => {
  it("refuses a message for a chat with no turn to take it", () => {
    expect(createInbox().post("s1", { id: "m1", text: "hello" })).toBe(false);
  });

  it("hands over everything posted since the last take, as one message", () => {
    const inbox = createInbox();
    const turn = inbox.open("s1");
    expect(turn.take()).toBeUndefined();
    inbox.post("s1", { id: "m1", text: "one" });
    inbox.post("s1", { id: "m2", text: "two" });
    expect(turn.take()).toEqual({ ids: ["m1", "m2"], text: "one\n\ntwo" });
    expect(turn.take()).toBeUndefined();
  });

  it("keeps each chat's messages to its own turn", () => {
    const inbox = createInbox();
    const first = inbox.open("s1");
    const second = inbox.open("s2");
    inbox.post("s2", { id: "m1", text: "for two" });
    expect(first.take()).toBeUndefined();
    expect(second.take()).toEqual({ ids: ["m1"], text: "for two" });
  });

  it("refuses everything once closed", () => {
    const inbox = createInbox();
    inbox.open("s1").close();
    expect(inbox.post("s1", { id: "m1", text: "late" })).toBe(false);
  });

  it("leaves a later turn's inbox open when an earlier one closes", () => {
    const inbox = createInbox();
    const earlier = inbox.open("s1");
    const later = inbox.open("s1");
    earlier.close();
    expect(inbox.post("s1", { id: "m1", text: "still here" })).toBe(true);
    expect(later.take()?.ids).toEqual(["m1"]);
  });
});
