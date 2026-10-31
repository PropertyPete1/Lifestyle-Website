import { eq } from "drizzle-orm";
import { teamMembers } from "../drizzle/schema";
import type { ClientEmailAgent } from "../shared/dealsClientEmail";
import { getDb } from "./db";

/**
 * Oct 31, 2026 (Peter: the designed email an agent sends a client with their list, just the link): the agent's
 * signature card, from the deals team list (phone, email) and the team page (photo, title).
 */

/** The agent's card: the team page's photo and title when the team page lists them, else REALTOR® and initials. */
export async function clientEmailAgent(agent: { name: string; email: string | null; phoneE164: string | null }): Promise<ClientEmailAgent> {
  const db = await getDb();
  const members = db ? await db.select({ name: teamMembers.name, title: teamMembers.title, photo: teamMembers.photo, phone: teamMembers.phone, email: teamMembers.email }).from(teamMembers).where(eq(teamMembers.active, true)) : [];
  const key = (value: string | null | undefined) => String(value ?? "").toLowerCase().replace(/[^a-z]/g, "");
  const words = agent.name.toLowerCase().split(/\s+/).filter(Boolean);
  // "Nicki Pauley" on both; "Josh McDaniel" on the deals list is "Joshua McDaniel" on the team page (first letters, same last name).
  const member = members.find((row) => key(row.name) === key(agent.name))
    ?? members.find((row) => { const parts = row.name.toLowerCase().split(/\s+/).filter(Boolean); return parts.at(-1) === words.at(-1) && parts[0]?.[0] === words[0]?.[0]; })
    ?? (agent.email ? members.find((row) => row.email && row.email.toLowerCase() === agent.email!.toLowerCase()) : undefined);
  const photo = member?.photo?.trim() && !/drive\.google\.com/i.test(member.photo) ? member.photo.trim() : null;
  return {
    name: agent.name,
    // TREC: the team page's own title ("Broker & Owner" is Steven's alone); the email never invents one.
    title: member?.title?.trim() || "REALTOR®",
    phone: agent.phoneE164 ?? member?.phone ?? null,
    email: agent.email ?? member?.email ?? null,
    photoUrl: photo,
  };
}
