import { describe, expect, it } from "vitest";
import {
  assigneeUserIds,
  channelsFor,
  incomingMessages,
  isStopMessage,
  maskPhone,
  messageText,
  normalisePhone,
  parseWhatsappResponse,
  preferencesSchema,
  recipients,
  whatsappPayload,
} from "@/modules/notifications/logic";

describe("normalisePhone", () => {
  it("turns local South African numbers into E.164", () => {
    expect(normalisePhone("082 123 4567")).toBe("+27821234567");
    expect(normalisePhone("(082) 123-4567")).toBe("+27821234567");
  });
  it("keeps international formats", () => {
    expect(normalisePhone("+27 82 123 4567")).toBe("+27821234567");
    expect(normalisePhone("0027821234567")).toBe("+27821234567");
    expect(normalisePhone("+254 712 345678")).toBe("+254712345678");
    expect(normalisePhone("+263 77 123 4567")).toBe("+263771234567");
  });
  it("uses another default country code when asked", () => {
    expect(normalisePhone("0712 345678", "254")).toBe("+254712345678");
  });
  it("rejects things that aren't phone numbers", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("hello")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("+27 82 123")).toBeNull();
    expect(normalisePhone("27+821234567")).toBeNull();
    expect(normalisePhone("+27 82 123 4567 89")).toBeNull();
  });
});

it("masks the middle of a number", () => {
  expect(maskPhone("+27821234567")).toBe("+27 82 *** 4567");
});

describe("preferencesSchema", () => {
  it("normalises the number", () => {
    const r = preferencesSchema.safeParse({ emailNotifications: true, whatsappOptIn: true, whatsappNumber: "082 123 4567" });
    expect(r.success && r.data).toEqual({ emailNotifications: true, whatsappOptIn: true, whatsappNumber: "+27821234567" });
  });
  it("needs a number to opt in", () => {
    const r = preferencesSchema.safeParse({ emailNotifications: true, whatsappOptIn: true, whatsappNumber: "" });
    expect(r.success).toBe(false);
  });
  it("rejects a bad number even when not opted in", () => {
    expect(preferencesSchema.safeParse({ emailNotifications: false, whatsappOptIn: false, whatsappNumber: "abc" }).success).toBe(false);
  });
  it("allows clearing the number", () => {
    const r = preferencesSchema.safeParse({ emailNotifications: false, whatsappOptIn: false, whatsappNumber: " " });
    expect(r.success && r.data.whatsappNumber).toBeNull();
  });
});

describe("channelsFor", () => {
  const base = { email: "a@b.test", emailNotifications: true, whatsappOptIn: false, whatsappNumber: null };
  it("sends email by default and WhatsApp only after opting in with a number", () => {
    expect(channelsFor(base)).toEqual(["EMAIL"]);
    expect(channelsFor({ ...base, whatsappOptIn: true })).toEqual(["EMAIL"]);
    expect(channelsFor({ ...base, whatsappOptIn: true, whatsappNumber: "+27821234567" })).toEqual(["EMAIL", "WHATSAPP"]);
    expect(channelsFor({ ...base, emailNotifications: false, whatsappNumber: "+27821234567" })).toEqual([]);
  });
});

it("never notifies the actor and removes duplicates", () => {
  expect(recipients(["a", "b", "a", null, undefined, "actor"], "actor")).toEqual(["a", "b"]);
});

describe("assigneeUserIds", () => {
  const members = [
    { userId: "u1", companyId: "c1", roleIds: ["r1"] },
    { userId: "u2", companyId: "c1", roleIds: [] },
    { userId: "u3", companyId: null, roleIds: ["r1", "r2"] },
  ];
  it("expands users, roles and companies to project members", () => {
    expect(assigneeUserIds({ type: "USER", id: "u2" }, members)).toEqual(["u2"]);
    expect(assigneeUserIds({ type: "USER", id: "stranger" }, members)).toEqual([]);
    expect(assigneeUserIds({ type: "ROLE", id: "r1" }, members)).toEqual(["u1", "u3"]);
    expect(assigneeUserIds({ type: "COMPANY", id: "c1" }, members)).toEqual(["u1", "u2"]);
    expect(assigneeUserIds({ type: null, id: null }, members)).toEqual([]);
  });
});

describe("whatsappPayload", () => {
  const n = { title: "#12 assigned to you", body: "Naledi assigned\n\"Cracked tile\" to you.", url: "https://app.test/projects/p/issues/i" };
  it("uses the approved template with three variables, without newlines", () => {
    const p = whatsappPayload("+27821234567", n, { name: "bushbim_notification", language: "en" });
    expect(p.to).toBe("27821234567");
    expect(p.type).toBe("template");
    const params = (p as { template: { components: { parameters: { text: string }[] }[] } }).template.components[0].parameters.map((x) => x.text);
    expect(params).toEqual(["#12 assigned to you", 'Naledi assigned "Cracked tile" to you.', "https://app.test/projects/p/issues/i"]);
  });
  it("falls back to a text message", () => {
    const p = whatsappPayload("+27821234567", n, null) as { type: string; text: { body: string } };
    expect(p.type).toBe("text");
    expect(p.text.body).toBe(messageText(n));
    expect(p.text.body).toContain("https://app.test/projects/p/issues/i");
  });
  it("never sends an empty template variable", () => {
    const p = whatsappPayload("+27821234567", { ...n, url: null }, { name: "t", language: "en" }) as { template: { components: { parameters: { text: string }[] }[] } };
    expect(p.template.components[0].parameters[2].text).toBe("-");
  });
});

describe("parseWhatsappResponse", () => {
  it("reads the message id", () => {
    expect(parseWhatsappResponse(200, { messages: [{ id: "wamid.1" }] })).toEqual({ ok: true, id: "wamid.1" });
  });
  it("reports the API error", () => {
    const r = parseWhatsappResponse(400, { error: { message: "Template name does not exist", code: 132001 } });
    expect(r).toEqual({ ok: false, error: "WhatsApp: Template name does not exist (132001)" });
  });
  it("copes with an empty reply", () => {
    expect(parseWhatsappResponse(500, null)).toEqual({ ok: false, error: "WhatsApp: HTTP 500" });
  });
});

describe("webhook replies", () => {
  it("finds incoming text and button replies", () => {
    const payload = {
      entry: [
        {
          changes: [
            {
              value: {
                messages: [
                  { from: "27821234567", type: "text", text: { body: "STOP" } },
                  { from: "27821234568", type: "button", button: { text: "Stop" } },
                  { from: "bad", type: "text", text: { body: "stop" } },
                ],
              },
            },
          ],
        },
      ],
    };
    expect(incomingMessages(payload)).toEqual([
      { from: "+27821234567", text: "STOP" },
      { from: "+27821234568", text: "Stop" },
    ]);
    expect(incomingMessages({})).toEqual([]);
    expect(incomingMessages(null)).toEqual([]);
  });
  it("recognises opt-out words", () => {
    expect(isStopMessage(" stop ")).toBe(true);
    expect(isStopMessage("Unsubscribe.")).toBe(true);
    expect(isStopMessage("don't stop")).toBe(false);
  });
});
