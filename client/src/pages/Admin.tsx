import { useState } from "react";
import { Link, useParams } from "wouter";
import { useAuth } from "@/_core/hooks/useAuth";
import { startLogin } from "@/const";
import { trpc } from "@/lib/trpc";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Home, Building2, Quote, Users, Map as MapIcon, BarChart3, Link2, Inbox, Loader2, Plus, Pencil, Trash2, LogOut } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Listing } from "../../../drizzle/schema";

/* ================= Admin shell (role-protected) ================= */

const TABS = [
  { key: "listings", label: "Listings", icon: Building2 },
  { key: "testimonials", label: "Testimonials", icon: Quote },
  { key: "team", label: "Team", icon: Users },
  { key: "neighborhoods", label: "Neighborhoods", icon: MapIcon },
  { key: "stats", label: "Site Stats", icon: BarChart3 },
  { key: "links", label: "Bio Links", icon: Link2 },
  { key: "leads", label: "Lead Log", icon: Inbox },
];

export default function Admin() {
  const { user, loading, logout } = useAuth();
  const params = useParams<{ tab?: string }>();
  const tab = params.tab ?? "listings";

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-6 px-5 text-center">
        <h1 className="font-serif text-3xl">Admin Access</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          Sign in with your Manus account to manage Lifestyle Design Realty content.
        </p>
        <Button onClick={() => startLogin()} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none uppercase tracking-[0.2em] text-xs px-8">
          Sign In
        </Button>
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-muted-foreground hover:text-gold">← Back to site</Link>
      </div>
    );
  }

  if (user.role !== "admin") {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-background gap-4 px-5 text-center">
        <h1 className="font-serif text-3xl">Access Restricted</h1>
        <p className="text-sm text-muted-foreground max-w-sm">
          This dashboard is limited to administrators. You're signed in as {user.name ?? user.email}.
        </p>
        <Link href="/" className="text-xs uppercase tracking-[0.2em] text-gold">← Back to site</Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col lg:flex-row">
      {/* Sidebar */}
      <aside className="lg:w-60 shrink-0 border-b lg:border-b-0 lg:border-r border-border bg-sidebar">
        <div className="p-5 border-b border-border">
          <Link href="/" className="font-serif text-sm tracking-[0.14em]">
            LIFESTYLE DESIGN <span className="text-gold">REALTY</span>
          </Link>
          <p className="text-[10px] uppercase tracking-[0.25em] text-muted-foreground mt-1">Admin CMS</p>
        </div>
        <nav className="p-3 flex lg:flex-col gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/admin/${t.key}`}
              className={cn(
                "flex items-center gap-2.5 px-3 py-2.5 text-xs uppercase tracking-[0.12em] whitespace-nowrap transition-colors",
                tab === t.key ? "text-gold bg-secondary" : "text-muted-foreground hover:text-foreground"
              )}>
              <t.icon className="h-4 w-4" /> {t.label}
            </Link>
          ))}
          <button
            onClick={() => logout()}
            className="flex items-center gap-2.5 px-3 py-2.5 text-xs uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground whitespace-nowrap">
            <LogOut className="h-4 w-4" /> Sign Out
          </button>
          <Link href="/" className="flex items-center gap-2.5 px-3 py-2.5 text-xs uppercase tracking-[0.12em] text-muted-foreground hover:text-foreground whitespace-nowrap">
            <Home className="h-4 w-4" /> View Site
          </Link>
        </nav>
      </aside>

      {/* Content */}
      <main className="flex-1 p-5 lg:p-10 overflow-x-auto">
        {tab === "listings" && <ListingsManager />}
        {tab === "testimonials" && <TestimonialsManager />}
        {tab === "team" && <TeamManager />}
        {tab === "neighborhoods" && <NeighborhoodsManager />}
        {tab === "stats" && <StatsManager />}
        {tab === "links" && <LinksManager />}
        {tab === "leads" && <LeadsViewer />}
      </main>
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between mb-6">
      <h1 className="font-serif text-3xl">{title}</h1>
      {action}
    </div>
  );
}

/* ================= Listings ================= */

const emptyListing = {
  slug: "", address: "", city: "San Antonio", state: "TX", zip: "", price: 0, beds: 3,
  baths: "2", sqft: 0, status: "Active" as const, description: "", heroImage: "", photos: "",
  agentName: "", featured: true, hasPool: false, isNewConstruction: false,
  propertyType: "Residential" as const,
};

function ListingsManager() {
  const utils = trpc.useUtils();
  const { data: listings } = trpc.listings.all.useQuery();
  const [editing, setEditing] = useState<typeof emptyListing & { id?: number } | null>(null);

  const invalidate = () => utils.listings.invalidate();
  const create = trpc.listings.create.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Listing created"); }, onError: (e) => toast.error(e.message) });
  const update = trpc.listings.update.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Listing updated"); }, onError: (e) => toast.error(e.message) });
  const remove = trpc.listings.remove.useMutation({ onSuccess: () => { invalidate(); toast.success("Listing removed"); }, onError: (e) => toast.error(e.message) });

  const save = () => {
    if (!editing) return;
    const slug = editing.slug || editing.address.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const { id, ...data } = { ...editing, slug };
    if (id) update.mutate({ id, data });
    else create.mutate(data);
  };

  const edit = (l: Listing) =>
    setEditing({
      id: l.id, slug: l.slug, address: l.address, city: l.city, state: l.state, zip: l.zip ?? "",
      price: l.price, beds: l.beds, baths: l.baths, sqft: l.sqft, status: l.status as "Active",
      description: l.description ?? "", heroImage: l.heroImage ?? "", photos: l.photos ?? "",
      agentName: l.agentName ?? "", featured: l.featured, hasPool: l.hasPool,
      isNewConstruction: l.isNewConstruction, propertyType: l.propertyType as "Residential",
    });

  return (
    <div>
      <SectionHeader
        title="Featured Listings"
        action={
          <Button onClick={() => setEditing({ ...emptyListing })} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none text-xs uppercase tracking-widest">
            <Plus className="h-4 w-4 mr-1" /> Add Listing
          </Button>
        }
      />
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Address</TableHead><TableHead>City</TableHead><TableHead>Price</TableHead>
            <TableHead>Status</TableHead><TableHead>Agent</TableHead><TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(listings ?? []).map((l) => (
            <TableRow key={l.id}>
              <TableCell className="font-medium">{l.address}</TableCell>
              <TableCell>{l.city}</TableCell>
              <TableCell>${l.price.toLocaleString()}</TableCell>
              <TableCell><Badge variant={l.status === "Active" ? "default" : "secondary"}>{l.status}</Badge></TableCell>
              <TableCell>{l.agentName}</TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => edit(l)}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => confirm("Delete this listing?") && remove.mutate({ id: l.id })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>

      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-2xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Listing" : "Add Listing"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="grid sm:grid-cols-2 gap-4">
              <div className="space-y-1.5 sm:col-span-2"><Label>Address</Label><Input value={editing.address} onChange={(e) => setEditing({ ...editing, address: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>City</Label>
                <Select value={editing.city} onValueChange={(v) => setEditing({ ...editing, city: v })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{["San Antonio", "New Braunfels", "Austin", "DFW", "Houston", "Boerne", "Kyle"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Zip</Label><Input value={editing.zip} onChange={(e) => setEditing({ ...editing, zip: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Price ($)</Label><Input type="number" value={editing.price} onChange={(e) => setEditing({ ...editing, price: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>SqFt</Label><Input type="number" value={editing.sqft} onChange={(e) => setEditing({ ...editing, sqft: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>Beds</Label><Input type="number" value={editing.beds} onChange={(e) => setEditing({ ...editing, beds: Number(e.target.value) })} /></div>
              <div className="space-y-1.5"><Label>Baths</Label><Input value={editing.baths} onChange={(e) => setEditing({ ...editing, baths: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Status</Label>
                <Select value={editing.status} onValueChange={(v) => setEditing({ ...editing, status: v as "Active" })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{["Active", "Pending", "Sold"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Property Type</Label>
                <Select value={editing.propertyType} onValueChange={(v) => setEditing({ ...editing, propertyType: v as "Residential" })}>
                  <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                  <SelectContent>{["Residential", "Multi-Family", "Townhome/Condo", "Land"].map((s) => <SelectItem key={s} value={s}>{s}</SelectItem>)}</SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5"><Label>Assigned Agent</Label><Input value={editing.agentName} onChange={(e) => setEditing({ ...editing, agentName: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Hero Image URL</Label><Input value={editing.heroImage} onChange={(e) => setEditing({ ...editing, heroImage: e.target.value })} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>Photo URLs (JSON array)</Label><Input value={editing.photos} placeholder='["url1","url2"]' onChange={(e) => setEditing({ ...editing, photos: e.target.value })} /></div>
              <div className="space-y-1.5 sm:col-span-2"><Label>Description</Label><Textarea rows={4} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div className="flex items-center gap-2"><Switch checked={editing.featured} onCheckedChange={(v) => setEditing({ ...editing, featured: v })} /><Label>Featured</Label></div>
              <div className="flex items-center gap-2"><Switch checked={editing.hasPool} onCheckedChange={(v) => setEditing({ ...editing, hasPool: v })} /><Label>Has Pool</Label></div>
              <div className="flex items-center gap-2"><Switch checked={editing.isNewConstruction} onCheckedChange={(v) => setEditing({ ...editing, isNewConstruction: v })} /><Label>New Construction</Label></div>
              <div className="sm:col-span-2">
                <Button onClick={save} disabled={create.isPending || update.isPending} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none w-full">
                  {create.isPending || update.isPending ? "Saving..." : "Save Listing"}
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ================= Testimonials ================= */

function TestimonialsManager() {
  const utils = trpc.useUtils();
  const { data: items } = trpc.testimonials.listAll.useQuery();
  const [editing, setEditing] = useState<{ id?: number; quote: string; author: string; source: string; sortOrder: number; published: boolean } | null>(null);
  const invalidate = () => utils.testimonials.invalidate();
  const create = trpc.testimonials.create.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Saved"); } });
  const update = trpc.testimonials.update.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Saved"); } });
  const remove = trpc.testimonials.remove.useMutation({ onSuccess: () => { invalidate(); toast.success("Removed"); } });

  const save = () => {
    if (!editing) return;
    const { id, ...data } = editing;
    if (id) update.mutate({ id, data });
    else create.mutate(data);
  };

  return (
    <div>
      <SectionHeader
        title="Testimonials"
        action={<Button onClick={() => setEditing({ quote: "", author: "", source: "", sortOrder: (items?.length ?? 0) + 1, published: true })} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none text-xs uppercase tracking-widest"><Plus className="h-4 w-4 mr-1" /> Add</Button>}
      />
      <div className="space-y-3">
        {(items ?? []).map((t) => (
          <div key={t.id} className="border border-border bg-card p-4 flex items-start justify-between gap-4">
            <div className="min-w-0">
              <p className="text-sm text-muted-foreground line-clamp-2">{t.quote}</p>
              <p className="text-xs text-gold mt-1">— {t.author} {t.source ? `· ${t.source}` : ""} {!t.published && <Badge variant="secondary" className="ml-2">Hidden</Badge>}</p>
            </div>
            <div className="flex shrink-0">
              <Button size="icon" variant="ghost" onClick={() => setEditing({ id: t.id, quote: t.quote, author: t.author, source: t.source ?? "", sortOrder: t.sortOrder, published: t.published })}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => confirm("Delete testimonial?") && remove.mutate({ id: t.id })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Testimonial" : "Add Testimonial"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5"><Label>Quote</Label><Textarea rows={5} value={editing.quote} onChange={(e) => setEditing({ ...editing, quote: e.target.value })} /></div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Author</Label><Input value={editing.author} onChange={(e) => setEditing({ ...editing, author: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Source (Google, Zillow…)</Label><Input value={editing.source} onChange={(e) => setEditing({ ...editing, source: e.target.value })} /></div>
              </div>
              <div className="flex items-center gap-2"><Switch checked={editing.published} onCheckedChange={(v) => setEditing({ ...editing, published: v })} /><Label>Published</Label></div>
              <Button onClick={save} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none w-full">Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ================= Team ================= */

function TeamManager() {
  const utils = trpc.useUtils();
  const { data: items } = trpc.team.listAll.useQuery();
  const [editing, setEditing] = useState<{ id?: number; name: string; title: string; license: string; bio: string; photo: string; phone: string; email: string; sortOrder: number; active: boolean } | null>(null);
  const invalidate = () => utils.team.invalidate();
  const create = trpc.team.create.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Saved"); } });
  const update = trpc.team.update.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Saved"); } });
  const remove = trpc.team.remove.useMutation({ onSuccess: () => { invalidate(); toast.success("Removed"); } });

  const save = () => {
    if (!editing) return;
    const { id, ...data } = editing;
    if (id) update.mutate({ id, data });
    else create.mutate(data);
  };

  return (
    <div>
      <SectionHeader
        title="Team Members"
        action={<Button onClick={() => setEditing({ name: "", title: "REALTOR®", license: "", bio: "", photo: "", phone: "", email: "", sortOrder: (items?.length ?? 0) + 1, active: true })} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none text-xs uppercase tracking-widest"><Plus className="h-4 w-4 mr-1" /> Add</Button>}
      />
      {/* TREC: only Peter Allen may hold the "Broker/Owner" title */}
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Title</TableHead><TableHead>License</TableHead><TableHead>Contact</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
        <TableBody>
          {(items ?? []).map((m) => (
            <TableRow key={m.id}>
              <TableCell className="font-medium">{m.name} {!m.active && <Badge variant="secondary" className="ml-1">Hidden</Badge>}</TableCell>
              <TableCell>{m.title}</TableCell>
              <TableCell>{m.license}</TableCell>
              <TableCell className="text-xs">{m.email}<br />{m.phone}</TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => setEditing({ id: m.id, name: m.name, title: m.title, license: m.license ?? "", bio: m.bio ?? "", photo: m.photo ?? "", phone: m.phone ?? "", email: m.email ?? "", sortOrder: m.sortOrder, active: m.active })}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => confirm("Delete team member?") && remove.mutate({ id: m.id })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Team Member" : "Add Team Member"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Title</Label><Input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>License #</Label><Input value={editing.license} onChange={(e) => setEditing({ ...editing, license: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Photo URL</Label><Input value={editing.photo} onChange={(e) => setEditing({ ...editing, photo: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Phone</Label><Input value={editing.phone} onChange={(e) => setEditing({ ...editing, phone: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Email</Label><Input value={editing.email} onChange={(e) => setEditing({ ...editing, email: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Bio</Label><Textarea rows={4} value={editing.bio} onChange={(e) => setEditing({ ...editing, bio: e.target.value })} /></div>
              <div className="flex items-center gap-2"><Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /><Label>Active</Label></div>
              <Button onClick={save} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none w-full">Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ================= Neighborhoods ================= */

function NeighborhoodsManager() {
  const utils = trpc.useUtils();
  const { data: items } = trpc.neighborhoods.listAll.useQuery();
  const [editing, setEditing] = useState<{ id?: number; slug: string; name: string; region: string; tagline: string; description: string; heroImage: string; medianPrice: string; vibe: string; isCityPage: boolean; sortOrder: number; published: boolean } | null>(null);
  const invalidate = () => utils.neighborhoods.invalidate();
  const create = trpc.neighborhoods.create.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Saved"); } });
  const update = trpc.neighborhoods.update.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Saved"); } });
  const remove = trpc.neighborhoods.remove.useMutation({ onSuccess: () => { invalidate(); toast.success("Removed"); } });

  const save = () => {
    if (!editing) return;
    const slug = editing.slug || editing.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const { id, ...data } = { ...editing, slug };
    if (id) update.mutate({ id, data });
    else create.mutate(data);
  };

  return (
    <div>
      <SectionHeader
        title="Neighborhoods & City Pages"
        action={<Button onClick={() => setEditing({ slug: "", name: "", region: "", tagline: "", description: "", heroImage: "", medianPrice: "", vibe: "", isCityPage: false, sortOrder: (items?.length ?? 0) + 1, published: true })} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none text-xs uppercase tracking-widest"><Plus className="h-4 w-4 mr-1" /> Add</Button>}
      />
      <Table>
        <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Slug</TableHead><TableHead>Region</TableHead><TableHead>Type</TableHead><TableHead className="text-right">Actions</TableHead></TableRow></TableHeader>
        <TableBody>
          {(items ?? []).map((n) => (
            <TableRow key={n.id}>
              <TableCell className="font-medium">{n.name} {!n.published && <Badge variant="secondary" className="ml-1">Hidden</Badge>}</TableCell>
              <TableCell className="text-xs">/{n.slug}</TableCell>
              <TableCell>{n.region}</TableCell>
              <TableCell>{n.isCityPage ? "City" : "Neighborhood"}</TableCell>
              <TableCell className="text-right">
                <Button size="icon" variant="ghost" onClick={() => setEditing({ id: n.id, slug: n.slug, name: n.name, region: n.region ?? "", tagline: n.tagline ?? "", description: n.description ?? "", heroImage: n.heroImage ?? "", medianPrice: n.medianPrice ?? "", vibe: n.vibe ?? "", isCityPage: n.isCityPage, sortOrder: n.sortOrder, published: n.published })}><Pencil className="h-4 w-4" /></Button>
                <Button size="icon" variant="ghost" onClick={() => confirm("Delete this page?") && remove.mutate({ id: n.id })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-xl max-h-[85dvh] overflow-y-auto">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Page" : "Add Page"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5"><Label>Name</Label><Input value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Slug</Label><Input value={editing.slug} onChange={(e) => setEditing({ ...editing, slug: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Region</Label><Input value={editing.region} onChange={(e) => setEditing({ ...editing, region: e.target.value })} /></div>
                <div className="space-y-1.5"><Label>Median Price</Label><Input value={editing.medianPrice} onChange={(e) => setEditing({ ...editing, medianPrice: e.target.value })} /></div>
              </div>
              <div className="space-y-1.5"><Label>Tagline</Label><Input value={editing.tagline} onChange={(e) => setEditing({ ...editing, tagline: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Hero Image URL</Label><Input value={editing.heroImage} onChange={(e) => setEditing({ ...editing, heroImage: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Description</Label><Textarea rows={5} value={editing.description} onChange={(e) => setEditing({ ...editing, description: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>Vibe (pull quote)</Label><Input value={editing.vibe} onChange={(e) => setEditing({ ...editing, vibe: e.target.value })} /></div>
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2"><Switch checked={editing.isCityPage} onCheckedChange={(v) => setEditing({ ...editing, isCityPage: v })} /><Label>City Page</Label></div>
                <div className="flex items-center gap-2"><Switch checked={editing.published} onCheckedChange={(v) => setEditing({ ...editing, published: v })} /><Label>Published</Label></div>
              </div>
              <Button onClick={save} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none w-full">Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ================= Stats ================= */

function StatsManager() {
  const utils = trpc.useUtils();
  const { data: stats } = trpc.stats.list.useQuery();
  const update = trpc.stats.update.useMutation({ onSuccess: () => { utils.stats.invalidate(); toast.success("Stat updated"); } });
  const [drafts, setDrafts] = useState<Record<number, { label: string; value: string }>>({});

  return (
    <div>
      <SectionHeader title="Site Stats" />
      <p className="text-sm text-muted-foreground mb-6">These numbers power the animated stats bar on the homepage.</p>
      <div className="grid sm:grid-cols-2 gap-4 max-w-2xl">
        {(stats ?? []).map((s) => {
          const d = drafts[s.id] ?? { label: s.label, value: s.value };
          return (
            <div key={s.id} className="border border-border bg-card p-4 space-y-3">
              <div className="space-y-1.5"><Label>Label</Label><Input value={d.label} onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, label: e.target.value } })} /></div>
              <div className="space-y-1.5"><Label>Value</Label><Input value={d.value} onChange={(e) => setDrafts({ ...drafts, [s.id]: { ...d, value: e.target.value } })} /></div>
              <Button size="sm" onClick={() => update.mutate({ id: s.id, data: d })} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none">Save</Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ================= Bio Links ================= */

function LinksManager() {
  const utils = trpc.useUtils();
  const { data: items } = trpc.links.listAll.useQuery();
  const [editing, setEditing] = useState<{ id?: number; label: string; url: string; sortOrder: number; active: boolean } | null>(null);
  const invalidate = () => utils.links.invalidate();
  const create = trpc.links.create.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Saved"); } });
  const update = trpc.links.update.useMutation({ onSuccess: () => { invalidate(); setEditing(null); toast.success("Saved"); } });
  const remove = trpc.links.remove.useMutation({ onSuccess: () => { invalidate(); toast.success("Removed"); } });

  const move = (id: number, dir: -1 | 1) => {
    const list = items ?? [];
    const idx = list.findIndex((l) => l.id === id);
    const swap = list[idx + dir];
    if (!swap) return;
    update.mutate({ id, data: { sortOrder: swap.sortOrder } });
    update.mutate({ id: swap.id, data: { sortOrder: list[idx].sortOrder } });
  };

  const save = () => {
    if (!editing) return;
    const { id, ...data } = editing;
    if (id) update.mutate({ id, data });
    else create.mutate(data);
  };

  return (
    <div>
      <SectionHeader
        title="Links Page (/links)"
        action={<Button onClick={() => setEditing({ label: "", url: "", sortOrder: (items?.length ?? 0) + 1, active: true })} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none text-xs uppercase tracking-widest"><Plus className="h-4 w-4 mr-1" /> Add</Button>}
      />
      <div className="space-y-2 max-w-2xl">
        {(items ?? []).map((l, i) => (
          <div key={l.id} className="border border-border bg-card px-4 py-3 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium">{l.label} {!l.active && <Badge variant="secondary" className="ml-1">Hidden</Badge>}</p>
              <p className="text-xs text-muted-foreground truncate">{l.url}</p>
            </div>
            <div className="flex items-center shrink-0">
              <Button size="icon" variant="ghost" disabled={i === 0} onClick={() => move(l.id, -1)}>↑</Button>
              <Button size="icon" variant="ghost" disabled={i === (items?.length ?? 0) - 1} onClick={() => move(l.id, 1)}>↓</Button>
              <Button size="icon" variant="ghost" onClick={() => setEditing({ id: l.id, label: l.label, url: l.url, sortOrder: l.sortOrder, active: l.active })}><Pencil className="h-4 w-4" /></Button>
              <Button size="icon" variant="ghost" onClick={() => confirm("Delete link?") && remove.mutate({ id: l.id })}><Trash2 className="h-4 w-4 text-destructive" /></Button>
            </div>
          </div>
        ))}
      </div>
      <Dialog open={!!editing} onOpenChange={(o) => !o && setEditing(null)}>
        <DialogContent className="max-w-md">
          <DialogHeader><DialogTitle>{editing?.id ? "Edit Link" : "Add Link"}</DialogTitle></DialogHeader>
          {editing && (
            <div className="space-y-4">
              <div className="space-y-1.5"><Label>Label</Label><Input value={editing.label} onChange={(e) => setEditing({ ...editing, label: e.target.value })} /></div>
              <div className="space-y-1.5"><Label>URL (external or /path)</Label><Input value={editing.url} onChange={(e) => setEditing({ ...editing, url: e.target.value })} /></div>
              <div className="flex items-center gap-2"><Switch checked={editing.active} onCheckedChange={(v) => setEditing({ ...editing, active: v })} /><Label>Active</Label></div>
              <Button onClick={save} className="bg-gold text-primary-foreground hover:bg-gold/90 rounded-none w-full">Save</Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ================= Lead Log ================= */

function LeadsViewer() {
  const { data: leads } = trpc.leads.list.useQuery();

  const intentColor: Record<string, string> = {
    Hot: "bg-gold text-primary-foreground",
    Warm: "bg-secondary text-foreground border border-gold/40",
    Cold: "bg-muted text-muted-foreground",
    Unknown: "bg-muted text-muted-foreground",
  };

  return (
    <div>
      <SectionHeader title="Lead Log" />
      <p className="text-sm text-muted-foreground mb-6">
        Every form submission with Follow Up Boss sync status. Failed syncs remain safely stored here.
      </p>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead><TableHead>Name</TableHead><TableHead>Contact</TableHead>
            <TableHead>Source</TableHead><TableHead>Intent</TableHead><TableHead>FUB</TableHead><TableHead>Details</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {(leads ?? []).map((l) => (
            <TableRow key={l.id}>
              <TableCell className="text-xs whitespace-nowrap">{new Date(l.createdAt).toLocaleString()}</TableCell>
              <TableCell className="font-medium">{l.name}</TableCell>
              <TableCell className="text-xs">{l.email}<br />{l.phone}</TableCell>
              <TableCell className="text-xs">{l.sourceTag}</TableCell>
              <TableCell><span className={cn("px-2 py-0.5 text-[10px] uppercase tracking-widest", intentColor[l.intent])}>{l.intent}</span></TableCell>
              <TableCell>
                <Badge variant={l.fubStatus === "synced" ? "default" : l.fubStatus === "failed" ? "destructive" : "secondary"}>
                  {l.fubStatus}
                </Badge>
              </TableCell>
              <TableCell className="text-xs max-w-[240px]">
                {l.answers && (
                  <details>
                    <summary className="cursor-pointer text-gold">answers</summary>
                    <pre className="whitespace-pre-wrap text-[10px] mt-1 text-muted-foreground">{JSON.stringify(JSON.parse(l.answers), null, 1)}</pre>
                  </details>
                )}
                {l.message && <p className="text-muted-foreground line-clamp-2">{l.message}</p>}
              </TableCell>
            </TableRow>
          ))}
          {(leads ?? []).length === 0 && (
            <TableRow><TableCell colSpan={7} className="text-center text-muted-foreground py-10">No leads yet.</TableCell></TableRow>
          )}
        </TableBody>
      </Table>
    </div>
  );
}
