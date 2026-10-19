import { toast } from "sonner";
import { CircleAlert, Eye, RotateCcw } from "lucide-react";
import { trpc } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { EmptyRow, Metric, Section, TAP } from "./shared";
import { displayDate } from "./helpers";
import type { Overview } from "./types";

/** Durable FUB jobs, queued alerts, email log and request activity (the per-lead view lives in Leads). */
export function DeliverySection({ overview }: { overview: Overview }) {
  const utils = trpc.useUtils();
  const retryFub = trpc.deals.admin.retryFub.useMutation({
    onSuccess: (result) => { void utils.deals.admin.overview.invalidate(); void utils.deals.admin.leads.invalidate(); toast.success(`CRM retry complete: ${result.sent} sent, ${result.failed} failed, ${result.skipped} skipped.`); },
    onError: (error) => toast.error(error.message || "Could not retry the job"),
  });
  const homeLabel = (homeId: number) => { const home = overview.homes.find((row) => row.id === homeId); return home ? home.privateAddress || home.privatePlanName || `Home #${homeId}` : `Home #${homeId}`; };
  return (
    <Section id="delivery" title="CRM, alerts and requests" icon={CircleAlert} description="Durable Follow Up Boss jobs (retry re-runs that one job once), the queued unlock and flag alerts, every email attempt, and tour or ask requests with the home named from the private mapping.">
      <div className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Failed FUB jobs" value={overview.fubJobs.filter((job) => job.status === "failed").length} detail="Retry per job below" tone={overview.fubJobs.some((job) => job.status === "failed") ? "warning" : "default"} />
        <Metric label="Alerts queued" value={overview.alerts.filter((alert) => alert.status === "pending").length} detail={`${overview.alerts.filter((alert) => alert.status === "failed").length} failed`} tone="default" />
        <Metric label="Tour requests" value={overview.tours.filter((tour) => tour.requestType === "tour").length} detail={`${overview.tours.filter((tour) => tour.requestType === "ask").length} questions`} />
        <Metric label="Emails failed" value={overview.emailLogs.filter((log) => log.deliveryStatus === "failed").length} detail={`of ${overview.emailLogs.length} recent attempts`} tone={overview.emailLogs.some((log) => log.deliveryStatus === "failed") ? "warning" : "default"} />
      </div>
      <p className="text-sm font-medium">FUB delivery queue</p>
      <div className="mt-2 overflow-x-auto">
        <Table className="min-w-[48rem]">
          <TableHeader><TableRow><TableHead>Lead</TableHead><TableHead>Operation</TableHead><TableHead>Status</TableHead><TableHead>Attempts</TableHead><TableHead>Next attempt</TableHead><TableHead>Last error</TableHead><TableHead className="text-right">Action</TableHead></TableRow></TableHeader>
          <TableBody>
            {overview.fubJobs.map((job) => <TableRow key={job.id}><TableCell>#{job.leadId}</TableCell><TableCell className="text-xs">{job.operation.replaceAll("_", " ")}</TableCell><TableCell><Badge variant={job.status === "synced" ? "default" : job.status === "failed" ? "destructive" : "secondary"}>{job.status}</Badge></TableCell><TableCell>{job.attempts}</TableCell><TableCell className="whitespace-nowrap text-xs">{job.nextAttemptAt ? displayDate(job.nextAttemptAt) : job.status === "failed" ? "parked (retry by hand)" : "none"}</TableCell><TableCell className="max-w-64 break-words text-xs">{job.lastError || "none"}</TableCell><TableCell className="text-right">{job.status === "failed" ? <Button type="button" size="sm" variant="outline" className={TAP} disabled={retryFub.isPending} onClick={() => retryFub.mutate({ id: job.id })}><RotateCcw className="mr-1 h-3.5 w-3.5" /> Retry once</Button> : <span className="text-xs text-muted-foreground">none</span>}</TableCell></TableRow>)}
            {overview.fubJobs.length === 0 && <TableRow><TableCell colSpan={7}><EmptyRow>No CRM delivery jobs have been created.</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <p className="mt-6 text-sm font-medium">Unlock and flag alerts</p>
      <div className="mt-2 overflow-x-auto">
        <Table className="min-w-[54rem]">
          <TableHeader><TableRow><TableHead>Alert</TableHead><TableHead>Lead</TableHead><TableHead>Mode</TableHead><TableHead>Status</TableHead><TableHead>Scheduled</TableHead><TableHead>Delivery</TableHead><TableHead>Attempts</TableHead></TableRow></TableHeader>
          <TableBody>
            {overview.alerts.map((alert) => <TableRow key={alert.id}><TableCell><p className="text-sm font-medium">{alert.kind.replaceAll("_", " ")}</p><p className="max-w-64 truncate text-xs text-muted-foreground" title={alert.subject}>{alert.subject}</p></TableCell><TableCell>#{alert.leadId}</TableCell><TableCell><Badge variant="secondary">{alert.deliveryMode === "immediate" ? "Instant" : "Hourly digest"}</Badge></TableCell><TableCell><Badge variant={alert.status === "sent" ? "default" : alert.status === "failed" ? "destructive" : "secondary"}>{alert.status}</Badge></TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(alert.scheduledFor)}</TableCell><TableCell className="max-w-52 break-words text-xs">{alert.deliveryLog || alert.lastError || "Pending"}</TableCell><TableCell>{alert.attempts}</TableCell></TableRow>)}
            {overview.alerts.length === 0 && <TableRow><TableCell colSpan={7}><EmptyRow>No first-unlock or profile-flag alerts have been queued.</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <p className="mt-6 text-sm font-medium">Email log</p>
      <div className="mt-2 overflow-x-auto">
        <Table className="min-w-[54rem]">
          <TableHeader><TableRow><TableHead>Sent / attempted</TableHead><TableHead>Category</TableHead><TableHead>Provider</TableHead><TableHead>Recipients</TableHead><TableHead>Outcome</TableHead><TableHead>Log</TableHead></TableRow></TableHeader>
          <TableBody>
            {overview.emailLogs.map((log) => <TableRow key={log.id}><TableCell className="whitespace-nowrap text-xs">{displayDate(log.createdAt)}</TableCell><TableCell className="text-xs">{log.category.replaceAll("_", " ")}</TableCell><TableCell className="text-xs">{log.provider === "resend" ? "Resend" : "Owner notification"}</TableCell><TableCell className="max-w-56 truncate text-xs" title={log.recipients}>{log.recipients}</TableCell><TableCell><Badge variant={log.deliveryStatus === "sent" ? "default" : log.deliveryStatus === "failed" ? "destructive" : "secondary"}>{log.deliveryStatus.replaceAll("_", " ")}</Badge></TableCell><TableCell className="max-w-64 break-words text-xs">{log.deliveryLog}</TableCell></TableRow>)}
            {overview.emailLogs.length === 0 && <TableRow><TableCell colSpan={6}><EmptyRow>No email delivery attempts have been recorded.</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
      <p className="mt-6 flex items-center gap-2 text-sm font-medium"><Eye className="h-4 w-4 text-gold" /> Tour and ask requests</p>
      <div className="mt-2 overflow-x-auto">
        <Table className="min-w-[44rem]">
          <TableHeader><TableRow><TableHead>Request</TableHead><TableHead>Lead</TableHead><TableHead>Home (private)</TableHead><TableHead>Preferred time</TableHead><TableHead>FUB task</TableHead></TableRow></TableHeader>
          <TableBody>
            {overview.tours.map((tour) => <TableRow key={tour.id}><TableCell><Badge variant={tour.requestType === "tour" ? "default" : "secondary"}>{tour.requestType}</Badge><p className="mt-1 text-[10px] text-muted-foreground">{displayDate(tour.createdAt)}</p></TableCell><TableCell>#{tour.leadId}</TableCell><TableCell className="text-xs">{homeLabel(tour.homeId)}</TableCell><TableCell className="whitespace-nowrap text-xs">{displayDate(tour.preferredAt)}</TableCell><TableCell>{tour.fubTaskId ? <Badge className="bg-gold text-primary-foreground">Created</Badge> : <Badge variant="secondary">Pending</Badge>}</TableCell></TableRow>)}
            {overview.tours.length === 0 && <TableRow><TableCell colSpan={5}><EmptyRow>No tour or question requests yet.</EmptyRow></TableCell></TableRow>}
          </TableBody>
        </Table>
      </div>
    </Section>
  );
}
