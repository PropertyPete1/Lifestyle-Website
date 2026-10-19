import { Link2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, Section } from "./shared";
import { displayDate } from "./helpers";
import type { Overview } from "./types";

type ClientLinkRow = Overview["clientLinks"][number];

/** One word for where a link stands; the token itself never reaches admin. */
export function clientLinkState(link: Pick<ClientLinkRow, "revokedAt" | "verifiedAt" | "openedAt" | "expiresAt">, now = Date.now()): "revoked" | "verified" | "opened" | "expired" | "sent" {
  if (link.revokedAt) return "revoked";
  if (link.verifiedAt) return "verified";
  if (new Date(link.expiresAt).getTime() <= now) return "expired";
  if (link.openedAt) return "opened";
  return "sent";
}

export function ClientLinksSection({ overview }: { overview: Overview }) {
  const links = overview.clientLinks ?? [];
  return (
    <Section id="client-links" title="Agent client links" icon={Link2} description="Links our agents created from Agent tools (/deals/team) for their own clients. The client verifies their own mobile number through the link, sees the full list with builder and community names, and the FUB contact, tasks and alert emails go to that agent. Links are managed by the agent; this is the read-only record.">
      <div className="overflow-x-auto">
        <Table className="min-w-[44rem]">
          <TableHeader><TableRow><TableHead>Client</TableHead><TableHead>Agent</TableHead><TableHead>State</TableHead><TableHead>Opens</TableHead><TableHead>Created</TableHead><TableHead>Link until</TableHead></TableRow></TableHeader>
          <TableBody>
            {links.map((link) => {
              const state = clientLinkState(link);
              return (
                <TableRow key={link.id}>
                  <TableCell><p className="text-sm font-medium">{link.clientName}</p><p className="text-xs text-muted-foreground">{[link.clientPhoneE164, link.note].filter(Boolean).join(" · ") || "No phone or note"}{link.leadId ? ` · lead ${link.leadId}` : ""}</p></TableCell>
                  <TableCell className="text-sm">{link.agentName}</TableCell>
                  <TableCell><Badge variant={state === "verified" ? "default" : "secondary"}>{state}</Badge>{link.verifiedAt && <p className="mt-1 text-xs text-muted-foreground">{displayDate(link.verifiedAt)}</p>}</TableCell>
                  <TableCell className="text-sm">{link.openCount}{link.openedAt ? <span className="block text-xs text-muted-foreground">last {displayDate(link.openedAt)}</span> : null}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{displayDate(link.createdAt)}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs">{displayDate(link.expiresAt)}</TableCell>
                </TableRow>
              );
            })}
            {links.length === 0 && <TableRow><TableCell colSpan={6}><EmptyRow>No client links yet. Agents create them from Agent tools after verifying with their team number.</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
