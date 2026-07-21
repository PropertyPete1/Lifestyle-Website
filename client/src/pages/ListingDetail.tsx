import { useState } from "react";
import { useParams, Link } from "wouter";
import PageShell from "@/components/PageShell";
import LeadForm from "@/components/LeadForm";
import { formatPrice } from "@/components/ListingCard";
import FavoriteButton from "@/components/FavoriteButton";
import { trpc } from "@/lib/trpc";
import { BedDouble, Bath, Ruler, MapPin, ChevronLeft, ChevronRight, ArrowLeft } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function ListingDetail() {
  const { slug } = useParams<{ slug: string }>();
  const { data: listing, isLoading } = trpc.listings.bySlug.useQuery({ slug: slug ?? "" });
  const [photoIdx, setPhotoIdx] = useState(0);

  if (isLoading) {
    return (
      <PageShell solidNav>
        <div className="mx-auto max-w-[1400px] px-5 lg:px-8 pt-28 pb-20 space-y-6">
          <Skeleton className="h-[50vh] w-full" />
          <Skeleton className="h-10 w-1/2" />
          <Skeleton className="h-4 w-1/3" />
        </div>
      </PageShell>
    );
  }

  if (!listing) {
    return (
      <PageShell solidNav>
        <div className="mx-auto max-w-xl px-5 pt-40 pb-24 text-center">
          <h1 className="font-serif text-3xl">Listing Not Found</h1>
          <p className="mt-3 text-sm text-muted-foreground">
            This property may have been sold or removed.
          </p>
          <Link href="/search" className="text-cta mt-8 inline-block">Browse Properties</Link>
        </div>
      </PageShell>
    );
  }

  const photos: string[] = (() => {
    try {
      const arr = listing.photos ? (JSON.parse(listing.photos) as string[]) : [];
      return arr.length > 0 ? arr : listing.heroImage ? [listing.heroImage] : [];
    } catch {
      return listing.heroImage ? [listing.heroImage] : [];
    }
  })();

  return (
    <PageShell solidNav>
      <div className="mx-auto max-w-[1400px] px-5 lg:px-8 pt-24 lg:pt-32 pb-20">
        <Link href="/portfolio" className="inline-flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground hover:text-gold mb-6">
          <ArrowLeft className="h-3.5 w-3.5" /> Back to Portfolio
        </Link>

        {/* Gallery */}
        <div className="relative aspect-[16/9] lg:aspect-[21/9] overflow-hidden bg-secondary">
          {photos.length > 0 && (
            <img src={photos[photoIdx]} alt={listing.address} className="h-full w-full object-cover" />
          )}
          <span className="absolute top-5 left-5 bg-gold text-primary-foreground px-3 py-1 text-[10px] uppercase tracking-[0.2em]">
            {listing.status}
          </span>
          <FavoriteButton listing={listing} className="absolute top-4 right-4 h-10 w-10" />
          {photos.length > 1 && (
            <>
              <button
                aria-label="Previous photo"
                onClick={() => setPhotoIdx((i) => (i - 1 + photos.length) % photos.length)}
                className="absolute left-4 top-1/2 -translate-y-1/2 bg-black/50 p-2 text-white hover:bg-black/70">
                <ChevronLeft className="h-5 w-5" />
              </button>
              <button
                aria-label="Next photo"
                onClick={() => setPhotoIdx((i) => (i + 1) % photos.length)}
                className="absolute right-4 top-1/2 -translate-y-1/2 bg-black/50 p-2 text-white hover:bg-black/70">
                <ChevronRight className="h-5 w-5" />
              </button>
            </>
          )}
        </div>

        <div className="grid lg:grid-cols-3 gap-12 mt-10">
          <div className="lg:col-span-2">
            <p className="eyebrow text-gold flex items-center gap-2">
              <MapPin className="h-3.5 w-3.5" /> {listing.city}, {listing.state} {listing.zip ?? ""}
            </p>
            <h1 className="display-serif text-3xl md:text-5xl mt-3">{listing.address}</h1>
            <div className="font-serif text-3xl text-gold mt-4">{formatPrice(listing.price)}</div>
            <div className="flex flex-wrap gap-6 mt-6 text-sm text-muted-foreground">
              <span className="flex items-center gap-2"><BedDouble className="h-4 w-4" />{listing.beds} Bedrooms</span>
              <span className="flex items-center gap-2"><Bath className="h-4 w-4" />{listing.baths} Bathrooms</span>
              <span className="flex items-center gap-2"><Ruler className="h-4 w-4" />{listing.sqft.toLocaleString()} SqFt</span>
            </div>
            <div className="hairline my-8" />
            <p className="text-muted-foreground leading-relaxed whitespace-pre-line">
              {listing.description ?? "Contact us for full details on this property."}
            </p>

            {/* IDX-ready reserved slots — populated automatically in Phase 2 */}
            {(listing.brokerAttribution || listing.mlsDisclaimer || listing.dataUpdatedAt) && (
              <div className="mt-10 space-y-2 text-[11px] text-muted-foreground/70">
                {listing.brokerAttribution && <p>{listing.brokerAttribution}</p>}
                {listing.mlsDisclaimer && <p>{listing.mlsDisclaimer}</p>}
                {listing.dataUpdatedAt && (
                  <p>Data last updated {new Date(listing.dataUpdatedAt).toLocaleString()}</p>
                )}
              </div>
            )}
          </div>

          {/* Sidebar: agent + tour form */}
          <aside className="lg:sticky lg:top-28 h-fit bg-card border border-border p-6 lg:p-8">
            {listing.agentName && (
              <div className="mb-6">
                {/* TREC: brokerage name >= 1/2 the agent name size */}
                <p className="text-sm uppercase tracking-[0.15em]">{listing.agentName}</p>
                <p className="text-xs uppercase tracking-[0.15em] text-muted-foreground mt-1">
                  Lifestyle Design Realty
                </p>
              </div>
            )}
            <LeadForm
              sourceTag={`Website - Listing ${listing.address}`}
              heading="Schedule a Tour"
              submitLabel="Request a Tour"
              compact
              qualifying={[
                { key: "timeline", label: "Timeline to purchase", options: ["ASAP", "3-6 months", "Just browsing"] },
                { key: "preApproved", label: "Pre-approved for financing?", options: ["Yes", "No", "Not yet"] },
                { key: "workingWithAgent", label: "Already working with an agent?", options: ["Yes", "No"] },
              ]}
              extraAnswers={{ listingAddress: listing.address, listingCity: listing.city }}
            />
          </aside>
        </div>
      </div>
    </PageShell>
  );
}
