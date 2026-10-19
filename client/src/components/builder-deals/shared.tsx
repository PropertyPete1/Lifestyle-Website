import { useEffect, useId, useState, type ReactNode } from "react";
import { AlertTriangle, Home } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { listValue, toList } from "./helpers";

/** Every primary control keeps a 44 px tap target on a phone. */
export const TAP = "min-h-11";
export const GOLD_BUTTON = "bg-gold text-primary-foreground hover:bg-gold/90";

export function Section({ id, title, description, icon: Icon, children, action }: {
  id?: string;
  title: string;
  description?: string;
  icon?: typeof Home;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border border-border bg-card">
      <div className="flex flex-col gap-3 border-b border-border px-4 py-4 sm:flex-row sm:items-start sm:justify-between sm:px-5">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            {Icon && <Icon className="h-4 w-4 shrink-0 text-gold" />}
            <h2 className="font-serif text-2xl">{title}</h2>
          </div>
          {description && <p className="mt-1 max-w-3xl text-xs leading-relaxed text-muted-foreground">{description}</p>}
        </div>
        {action && <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">{action}</div>}
      </div>
      <div className="p-4 sm:p-5">{children}</div>
    </section>
  );
}

export function Metric({ label, value, detail, tone = "gold" }: { label: string; value: number | string; detail?: string; tone?: "gold" | "warning" | "default" }) {
  const valueClass = tone === "warning" ? "text-destructive" : tone === "default" ? "text-foreground" : "text-gold";
  return (
    <div className="border border-border bg-card p-4">
      <p className="text-[10px] uppercase tracking-[0.15em] text-muted-foreground">{label}</p>
      <p className={`mt-1 break-words font-serif text-3xl ${valueClass}`}>{value}</p>
      {detail && <p className="mt-1 text-[11px] text-muted-foreground">{detail}</p>}
    </div>
  );
}

export function ListField({ label, hint, value, onChange, placeholder, rows = 4 }: {
  label: string;
  hint?: string;
  value: string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  rows?: number;
}) {
  const id = useId();
  // The textarea keeps the raw text while typing so a trailing newline is not swallowed by the list parser;
  // an external change (refetch, reset after save) is adopted only when it differs from what is typed.
  const [text, setText] = useState(() => listValue(value));
  useEffect(() => {
    if (listValue(toList(text)) !== listValue(value)) setText(listValue(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  return (
    <div className="space-y-1.5">
      <Label htmlFor={id}>{label}</Label>
      <Textarea
        id={id}
        value={text}
        onChange={(event) => { setText(event.target.value); onChange(toList(event.target.value)); }}
        placeholder={placeholder ?? "One item per line"}
        rows={rows}
      />
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** A labelled switch whose whole row is the tap target. */
export function SwitchRow({ id, label, note, checked, onCheckedChange, disabled }: { id: string; label: string; note?: string; checked: boolean; onCheckedChange: (checked: boolean) => void; disabled?: boolean }) {
  return (
    <div className={`flex ${TAP} items-center justify-between gap-3 border border-border px-3 py-2`}>
      <Label htmlFor={id} className="flex-1 cursor-pointer flex-col items-start gap-0.5 py-1 leading-snug">
        <span>{label}</span>
        {note && <span className="text-[11px] font-normal leading-relaxed text-muted-foreground">{note}</span>}
      </Label>
      <Switch id={id} checked={checked} onCheckedChange={onCheckedChange} disabled={disabled} className="scale-125" />
    </div>
  );
}

/**
 * A confirm dialog for destructive admin actions. The action runs only after
 * the admin taps the confirm button; nothing changes while the dialog is open.
 */
export function ConfirmDialog({ open, title, description, confirmLabel, destructive = true, pending, onCancel, onConfirm, children }: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  destructive?: boolean;
  pending?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  children?: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next && !pending) onCancel(); }}>
      <DialogContent>
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{description}</DialogDescription></DialogHeader>
        {children}
        <DialogFooter className="gap-2">
          <Button variant="outline" className={TAP} disabled={pending} onClick={onCancel}>Cancel</Button>
          <Button variant={destructive ? "destructive" : "default"} className={`${TAP} ${destructive ? "" : GOLD_BUTTON}`} disabled={pending} onClick={onConfirm}>{pending ? "Working..." : confirmLabel}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function Warning({ children }: { children: ReactNode }) {
  return <p className="flex items-start gap-2 border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /><span className="min-w-0 break-words">{children}</span></p>;
}

export function EmptyRow({ children }: { children: ReactNode }) {
  return <p className="py-6 text-center text-sm text-muted-foreground">{children}</p>;
}

/** A labelled text/number/date input; the label is always bound to the control for screen readers and tap focus. */
export function Field({ id, label, hint, children, className }: { id: string; label: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <div className={`space-y-1.5 ${className ?? ""}`}>
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

export const inputClass = `${TAP} text-base md:text-sm`;
