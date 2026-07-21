/**
 * Email copy of custom-website inquiries to Peter.
 *
 * The production runtime has no SMTP relay, so we deliver the copy through the
 * Manus owner-notification service (which reaches the project owner — Peter —
 * by email/app notification) with the full inquiry content formatted like an
 * email. This has no dependency on the visitor's email client: the form works
 * identically regardless of what email provider the visitor uses.
 */
import { notifyOwner } from "./_core/notification";
import type { WebsiteInquiryInput } from "./fub";

export const INQUIRY_COPY_RECIPIENT = "peter@lifestyledesignrealty.com";

/** Format the inquiry as an email-style body (exported for tests). */
export function formatInquiryEmail(input: WebsiteInquiryInput): { subject: string; body: string } {
  const subject = `Custom Website Inquiry — ${input.name}`;
  const body = [
    `New custom-website inquiry from lifestyledesignrealty.com`,
    ``,
    `Name: ${input.name}`,
    `Email: ${input.email}`,
    `Phone: ${input.phone ?? "—"}`,
    `Business: ${input.business?.trim() || "—"}`,
    ``,
    `Message:`,
    input.message ?? "—",
    ``,
    `Tagged in Follow Up Boss: "Wants Us to Build Their Website" (web design pipeline — not a real estate lead).`,
  ].join("\n");
  return { subject, body };
}

/** Send the copy to Peter. Returns { ok } — never throws. */
export async function emailWebsiteInquiryCopy(
  input: WebsiteInquiryInput
): Promise<{ ok: boolean }> {
  const { subject, body } = formatInquiryEmail(input);
  try {
    const ok = await notifyOwner({ title: subject, content: `To: ${INQUIRY_COPY_RECIPIENT}\n\n${body}` });
    return { ok };
  } catch {
    return { ok: false };
  }
}
