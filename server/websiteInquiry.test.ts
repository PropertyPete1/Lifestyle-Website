import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildWebsiteInquiryNote,
  sendWebsiteInquiryToFub,
  WEBSITE_INQUIRY_SOURCE,
  WEBSITE_INQUIRY_TAG,
} from "./fub";
import { formatInquiryEmail, INQUIRY_COPY_RECIPIENT } from "./inquiryEmail";

const SAMPLE = {
  name: "Jane Business",
  email: "jane@example.com",
  phone: "(555) 123-4567",
  business: "Jane's Bakery",
  message: "I'd love a website like yours.",
};

describe("website inquiry tag & source", () => {
  it("uses an unmistakable web-design tag, never confusable with property leads", () => {
    expect(WEBSITE_INQUIRY_TAG).toBe("Wants Us to Build Their Website");
    for (const word of ["buyer", "seller", "property", "listing", "valuation"]) {
      expect(WEBSITE_INQUIRY_TAG.toLowerCase()).not.toContain(word);
    }
    expect(WEBSITE_INQUIRY_SOURCE).toContain("Custom Website Inquiry");
  });

  it("note body clearly marks the inquiry as web design services", () => {
    const note = buildWebsiteInquiryNote(SAMPLE);
    expect(note).toContain("WEB DESIGN SERVICES INQUIRY");
    expect(note).toContain("not a real estate lead");
    expect(note).toContain("Business: Jane's Bakery");
    expect(note).toContain("Message: I'd love a website like yours.");
  });

  it("note omits empty optional fields", () => {
    const note = buildWebsiteInquiryNote({ name: "A", email: "a@b.co", message: "Hi" });
    expect(note).not.toContain("Business:");
    expect(note).toContain("Message: Hi");
  });
});

describe("sendWebsiteInquiryToFub payload", () => {
  const origKey = process.env.FUB_API_KEY;
  beforeEach(() => {
    process.env.FUB_API_KEY = "test-key";
  });
  afterEach(() => {
    process.env.FUB_API_KEY = origKey;
    vi.restoreAllMocks();
  });

  it("sends the correct tag, source, and contact fields (incl. phone)", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: 1, person: { id: 42 } }), { status: 200 })
    );
    const result = await sendWebsiteInquiryToFub(SAMPLE);
    expect(result.ok).toBe(true);
    expect(result.personId).toBe("42");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/events");
    const body = JSON.parse(String(init?.body));
    expect(body.source).toBe(WEBSITE_INQUIRY_SOURCE);
    expect(body.person.tags).toEqual([WEBSITE_INQUIRY_TAG]);
    expect(body.person.emails[0].value).toBe("jane@example.com");
    expect(body.person.phones[0].value).toBe("(555) 123-4567");
    expect(body.message).toContain("WEB DESIGN SERVICES INQUIRY");
  });

  it("fails gracefully when FUB returns an error", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("nope", { status: 500 }));
    const result = await sendWebsiteInquiryToFub(SAMPLE);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("FUB 500");
  });
});

describe("email copy to Peter", () => {
  it("formats subject and body with all fields including phone", () => {
    const { subject, body } = formatInquiryEmail(SAMPLE);
    expect(subject).toBe("Custom Website Inquiry — Jane Business");
    expect(body).toContain("Name: Jane Business");
    expect(body).toContain("Email: jane@example.com");
    expect(body).toContain("Phone: (555) 123-4567");
    expect(body).toContain("Business: Jane's Bakery");
    expect(body).toContain("I'd love a website like yours.");
    expect(body).toContain("Wants Us to Build Their Website");
  });

  it("targets Peter's address", () => {
    expect(INQUIRY_COPY_RECIPIENT).toBe("peter@lifestyledesignrealty.com");
  });
});
