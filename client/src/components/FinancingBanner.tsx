/**
 * Fixed, compliance-reviewed builder-buydown disclosure — NEVER AI-generated.
 *
 * Single source of truth for the 4.99% claim so the rate figure always renders
 * immediately adjacent to its required disclosure. Used on the homepage hero
 * and inside the Convince Your Partner result. If the compliance copy ever
 * changes, change it here once.
 */
export default function FinancingBanner({ className = "" }: { className?: string }) {
  return (
    <div className={`border border-gold/40 bg-gold/5 px-6 py-5 text-left ${className}`}>
      <p className="text-sm text-foreground/90">
        Ask us about builder incentive buydowns — we've gotten clients as low as{" "}
        <span className="text-gold font-medium">4.99%</span> since 2021.
      </p>
      <p className="mt-2 text-[10px] leading-relaxed text-muted-foreground">
        Rate shown reflects past builder-incentive buydowns obtained for specific clients and is
        not an offer of credit or a guarantee of current availability. Rates, terms, and incentives
        vary by builder, lender, and market conditions and are subject to qualification. Lifestyle
        Design Realty is not a lender.
      </p>
    </div>
  );
}
