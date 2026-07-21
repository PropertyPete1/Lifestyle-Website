/**
 * Heart/favorite toggle for listings. Favorites are anonymous — mirrored in
 * localStorage for instant UI, and logged server-side keyed to the visitor's
 * random first-party id. Only forwarded to Follow Up Boss if the visitor
 * later submits a lead form.
 */
import { useState } from "react";
import { Heart } from "lucide-react";
import { cn } from "@/lib/utils";
import { useActivity } from "@/hooks/useActivity";
import { getLocalFavorites, setLocalFavorites } from "@/lib/visitor";
import type { Listing } from "../../../drizzle/schema";

export default function FavoriteButton({
  listing,
  className,
}: {
  listing: Pick<Listing, "slug" | "address" | "city" | "price">;
  className?: string;
}) {
  const logActivity = useActivity();
  const [fav, setFav] = useState(() => getLocalFavorites().includes(listing.slug));

  const toggle = (e: React.MouseEvent) => {
    // Cards are wrapped in <Link> — don't navigate when tapping the heart
    e.preventDefault();
    e.stopPropagation();
    const next = !fav;
    setFav(next);
    const current = getLocalFavorites();
    setLocalFavorites(next ? [...current, listing.slug] : current.filter((s) => s !== listing.slug));
    logActivity(next ? "favorite" : "unfavorite", {
      slug: listing.slug,
      address: listing.address,
      city: listing.city,
      price: listing.price,
    });
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={fav ? "Remove from favorites" : "Save to favorites"}
      aria-pressed={fav}
      className={cn(
        "flex h-9 w-9 items-center justify-center rounded-full bg-background/55 backdrop-blur-sm border border-border/50 transition-all duration-200 hover:bg-background/80 hover:scale-105 active:scale-95",
        className
      )}>
      <Heart
        className={cn(
          "h-4 w-4 transition-colors duration-200",
          fav ? "fill-gold text-gold" : "text-foreground/80"
        )}
      />
    </button>
  );
}
