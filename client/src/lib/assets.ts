/** Uploaded static asset URLs (webdev storage). */
export const IMG = {
  heroDarkInterior: "/manus-storage/hero-dark-interior_739f4024.jpg",
  interiorMoody: "/manus-storage/interior-moody_6ec0d3af.jpg",
  listingAustinModern: "/manus-storage/listing-austin-modern_741409df.webp",
  listingHillCountryWhite: "/manus-storage/listing-hillcountry-white_5a9e0c46.jpeg",
  listingGracelyn: "/manus-storage/listing-gracelyn_38d8aecd.jpg",
  listingCordillera: "/manus-storage/listing-cordillera_c64c3d56.jpg",
  listingBarnhouse: "/manus-storage/listing-barnhouse_7f3f3269.jpg",
  listingHoustonSunset: "/manus-storage/listing-houston-sunset_55db521d.jpg",
  listingPoolEstate: "/manus-storage/listing-pool-estate_c1433ee3.jpg",
  citySanAntonio: "/manus-storage/city-san-antonio_15388e3a.jpg",
  cityAustin: "/manus-storage/city-austin_127412ff.jpg",
  cityHouston: "/manus-storage/city-houston_9763b83b.jpg",
  cityNewBraunfels: "/manus-storage/city-new-braunfels_9ad0d328.jpg",
  cityDfw: "/manus-storage/city-dfw_7ef7f575.jpg",
  areaBoerne: "/manus-storage/area-boerne_5d6d253c.jpg",
  areaKyle: "/manus-storage/area-kyle_5abc0638.jpg",
  areaAlamoRanch: "/manus-storage/area-alamo-ranch_6b62089f.jpg",
} as const;

/**
 * Oct 30, 2026 (Peter's white-skin mockups): the homepage and /links photography, cut from the mockups he approved and
 * served from client/public/brand. Illustrative lifestyle images, never shown as a listing.
 */
export const BRAND_IMG = {
  heroDesktop: "/brand/hero-living-desktop.webp",
  heroMobile: "/brand/hero-living-mobile.webp",
  texasRiver: "/brand/texas-river.webp",
  newBuild: "/brand/new-build.webp",
  newBuildBanner: "/brand/new-build-banner.webp",
  lease: "/brand/lease.webp",
  valuation: "/brand/valuation.webp",
  linksFront: "/brand/links-front.webp",
} as const;

/**
 * Nov 1, 2026 (Peter: the /links photo "populates after like 5 seconds"): the same photo at phone sizes (52 KB and 72 KB
 * instead of 167 KB). index.html preloads the same set with the page's HTML, so keep the two in step.
 */
export const LINKS_FRONT_SRCSET = "/brand/links-front-800.webp 800w, /brand/links-front-1050.webp 1050w, /brand/links-front.webp 1526w";
export const LINKS_FRONT_SIZES = "(min-width: 680px) 620px, calc(100vw - 2.5rem)";
