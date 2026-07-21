import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const db = {
  execute: (arg) =>
    typeof arg === "string" ? conn.query(arg) : conn.execute(arg.sql, arg.args),
};

const IMG = {
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
  interiorMoody: "/manus-storage/interior-moody_6ec0d3af.jpg",
};

async function run() {
  // ---- Site stats ----
  await db.execute(`DELETE FROM site_stats`);
  await db.execute(
    `INSERT INTO site_stats (label, value, sortOrder) VALUES
     ('Closed Sales','63',1),('Total Value','$26M',2),('Price Range','$200K–$1.7M',3),('Average Price','$424.4K',4)`
  );

  // ---- Testimonials (real Google/Zillow client reviews, lightly edited to be brokerage-focused — never fabricate reviews) ----
  await db.execute(`DELETE FROM testimonials`);
  const testimonials = [
    ["Our agent was an excellent and professional Realtor. He helped my fiance and I find a rental property almost immediately after moving to Austin. He was very flexible, knowledgeable, and honest in helping with our search. He helped us come up with precise criteria of what we were looking for and took us around to a multitude of properties with no delay. He quickly and efficiently responded to emails, phone calls, and questions.", "Buyer", "Google"],
    ["There are a lot of good real estate agents in Austin, but in my view, none possess the qualities our agent at Lifestyle Design Realty has. First, he's incredibly responsive. His replies never take more than a few minutes and I have grown to count on him to be looking out for my needs at every moment. He has also proven to me that he puts his clients first.", "Brett O.", "Google"],
    ["I cannot say enough about how great our agent was! He listened to what I needed for a rental and put together a great list. When we went to look, he was looking at the property with my best interest in mind, and if he noticed something wrong, he pointed it out. I have never encountered this level of honesty in a realtor. He was also very kind and an overall great person!", "Buyer", "Google"],
    ["I've had the pleasure of working with this team more than once. Aside from being professional and personable, our agent is truly an expert negotiator. He's extremely knowledgeable, provides exceptional guidance throughout the buying process, and is well-connected. Most importantly, you'll soon learn that he truly cares and is your advocate every step of the way. I wouldn't buy or sell without him!", "Buyer & Seller", "Zillow"],
    ["Our last purchase was the 3rd time working with this team. Our agent was on the doorstep the day it went live. We had the keys weeks later after a competitive negotiation. Great to work with and gets it done.", "Buyer", "Zillow"],
    ["This team has handled my real estate needs for many years across multiple transactions. My agent has always acted in my best interest and is one of the most impressive negotiators I've ever worked with. He's offered advice from rental management to remodeling and has always been the resource I go to when I have a real estate-related question. I highly recommend them to prospective buyers, sellers, and especially investors.", "Andrew L.", "Zillow"],
  ];
  for (let i = 0; i < testimonials.length; i++) {
    const [quote, author, source] = testimonials[i];
    await db.execute({
      sql: `INSERT INTO testimonials (quote, author, source, sortOrder, published) VALUES (?,?,?,?,true)`,
      args: [quote, author, source, i + 1],
    });
  }

  // ---- Team (TREC: only Steven Van Orden, Designated Broker, titled Broker & Owner; Peter Allen is Owner · REALTOR®) ----
  await db.execute(`DELETE FROM team_members`);
  const team = [
    ["Peter Allen", "Owner · REALTOR®", "792381", "Peter leads Lifestyle Design Realty with a builder's mindset and a client-first philosophy. From first-time buyers to portfolio investors, he pairs deep Central Texas market knowledge with modern marketing to deliver results across San Antonio, New Braunfels, Austin, DFW, and Houston.", "(210) 981-3830", "peter@lifestyledesignrealty.com"],
    ["Steven Van Orden", "Broker & Owner · Designated Broker", "", "Steven is passionate about real estate and advocating for his clients. Having started his real estate career in 2005 in corporate relocation, he is well versed in navigating the stressful process of relocating to a new city. With his vast knowledge of Austin neighborhoods, he excels at helping his clients find their dream home.", "", "steven@lifestyledesignrealty.com"],
    ["Stefanie", "REALTOR®", "", "Stefanie brings warmth and precision to every transaction, guiding buyers and sellers through each milestone with clear communication and relentless attention to detail.", "", "stefanie@lifestyledesignrealty.com"],
    ["Abby", "REALTOR®", "", "Abby specializes in helping growing families find the right community — pairing school research, commute planning, and new-construction expertise into a seamless search.", "", "abby@lifestyledesignrealty.com"],
    ["Irma", "REALTOR®", "", "Bilingual and deeply connected in San Antonio, Irma helps clients navigate every step of the process with confidence — from first showing to final signature.", "", "irma@lifestyledesignrealty.com"],
    ["Laila", "REALTOR®", "", "Laila combines sharp market analysis with a concierge-level client experience, helping buyers win in competitive markets and sellers maximize their equity.", "", "laila@lifestyledesignrealty.com"],
    ["Tiffany", "REALTOR®", "740830", "Tiffany's background in design gives her sellers an edge — from staging strategy to listing presentation, she makes homes unforgettable to buyers.", "", "tiffany@lifestyledesignrealty.com"],
  ];
  for (let i = 0; i < team.length; i++) {
    const [name, title, license, bio, phone, email] = team[i];
    await db.execute({
      sql: `INSERT INTO team_members (name, title, license, bio, phone, email, sortOrder, active) VALUES (?,?,?,?,?,?,?,true)`,
      args: [name, title, license, bio, phone, email, i + 1],
    });
  }

  // ---- Neighborhoods / city pages ----
  await db.execute(`DELETE FROM neighborhoods`);
  const hoods = [
    ["san-antonio", "San Antonio", "South Central Texas", "Historic soul, modern momentum", "San Antonio blends 300 years of history with one of the fastest-growing economies in Texas. From the River Walk and Pearl District to master-planned communities on the far west and north sides, the Alamo City offers big-city amenities at a cost of living most metros can't touch.\n\nMilitary families love the proximity to Joint Base San Antonio; investors love the steady appreciation; and first-time buyers love that homeownership is still within reach.", IMG.citySanAntonio, "$310K", "Big-city amenities, small-town prices — and breakfast tacos that ruin you for anywhere else.", 1, 1],
    ["new-braunfels", "New Braunfels", "SA–Austin Corridor", "River-town charm between two metros", "Anchored by the Comal and Guadalupe Rivers, New Braunfels is one of the fastest-growing cities in America — and it's easy to see why. Historic Gruene Hall, riverside dining, and Hill Country scenery meet brand-new master-planned communities with quick access to both San Antonio and Austin.", IMG.cityNewBraunfels, "$375K", "Weekends on the river, evenings at Gruene Hall — every day feels like a getaway.", 1, 2],
    ["austin", "Austin", "Central Texas", "Tech energy meets Hill Country living", "Austin remains the magnet of Texas — a global tech hub with a live-music heartbeat. From East Austin's creative core to lakeside estates on Lake Travis and value-rich suburbs like Kyle and Buda, the metro offers a lifestyle for every chapter.", IMG.cityAustin, "$540K", "Keep it weird, keep it walkable — Austin is Texas's creative capital.", 1, 3],
    ["dfw", "DFW", "North Texas", "The corporate powerhouse of the South", "Dallas–Fort Worth is the largest metro in Texas and one of the strongest job markets in the nation. Elite school districts, endless master-planned communities, and the deepest new-construction pipeline in the state make DFW a relocation favorite.", IMG.cityDfw, "$420K", "Two downtowns, endless suburbs, and a job market that never sleeps.", 1, 4],
    ["houston", "Houston", "Gulf Coast", "Global city, Texas value", "Houston is America's fourth-largest city and arguably its best value — world-class dining, medical and energy careers, and serious square footage for the money. From the Heights to Katy and The Woodlands, every lifestyle has a zip code here.", IMG.cityHouston, "$345K", "A global city where your money still buys land, space, and a pool.", 1, 5],
    ["alamo-ranch", "Alamo Ranch", "San Antonio — Far West Side", "One of San Antonio's fastest-growing communities", "Alamo Ranch is a booming far-west San Antonio community known for newer construction, highly rated schools, and unbeatable retail convenience. Buyers get modern floor plans and community amenities minutes from Lackland AFB and SeaWorld.", IMG.areaAlamoRanch, "$340K", "New builds, big skies, and everything you need within five minutes.", 0, 6],
    ["kyle", "Kyle", "Austin Metro — South", "Austin value on the I-35 corridor", "Kyle offers some of the best value in the Austin metro — new master-planned communities, a fast-growing downtown, and a commute that beats most Austin neighborhoods. Perfect for first-time buyers and families chasing space without leaving the metro.", IMG.areaKyle, "$335K", "The smart-money side of the Austin metro.", 0, 7],
    ["boerne", "Boerne", "Texas Hill Country", "Hill Country living, 30 minutes from San Antonio", "Boerne pairs postcard Hill Country scenery with a charming Main Street, exemplary schools, and luxury acreage communities. It's the escape-to-the-hills lifestyle — without giving up city convenience.", IMG.areaBoerne, "$525K", "Where Hill Country sunsets come standard.", 0, 8],
  ];
  for (const [slug, name, region, tagline, description, heroImage, medianPrice, vibe, isCityPage, sortOrder] of hoods) {
    await db.execute({
      sql: `INSERT INTO neighborhoods (slug, name, region, tagline, description, heroImage, medianPrice, vibe, isCityPage, sortOrder, published) VALUES (?,?,?,?,?,?,?,?,?,?,true)`,
      args: [slug, name, region, tagline, description, heroImage, medianPrice, vibe, isCityPage, sortOrder],
    });
  }

  // ---- Bio links ----
  await db.execute(`DELETE FROM bio_links`);
  const links = [
    ["Search Homes", "/search"],
    ["Find Your Texas City (Quiz)", "/city-finder"],
    ["New Builds Across Texas", "https://a.nhb.app/u/peter-allen"],
    ["What's My Home Worth?", "/valuation"],
    ["Schedule a Consultation", "/contact"],
    ["Join Our Team", "/join"],
  ];
  for (let i = 0; i < links.length; i++) {
    await db.execute({
      sql: `INSERT INTO bio_links (label, url, sortOrder, active) VALUES (?,?,?,true)`,
      args: [links[i][0], links[i][1], i + 1],
    });
  }

  // ---- Sample listings (placeholders — replace via admin CMS) ----
  await db.execute(`DELETE FROM listings`);
  const listings = [
    ["1204-hilltop-vista-boerne", "1204 Hilltop Vista", "Boerne", "78006", 1249000, 4, "3.5", 3820, "Active", "Perched on 1.4 acres with panoramic Hill Country views, this modern estate blends limestone, steel, and glass. A vanishing-edge pool, outdoor kitchen, and a light-flooded great room make this an entertainer's dream 30 minutes from downtown San Antonio.", IMG.listingCordillera, "Peter Allen", 1, 1, 0, "Residential"],
    ["842-gruene-crossing-new-braunfels", "842 Gruene Crossing", "New Braunfels", "78130", 585000, 4, "3", 2760, "Active", "Steps from historic Gruene, this newly built home pairs farmhouse character with modern efficiency — white oak floors, a chef's kitchen, and a covered patio built for river-town evenings.", IMG.listingHillCountryWhite, "Stefanie", 1, 0, 1, "Residential"],
    ["317-eastside-modern-austin", "317 Eastside Modern", "Austin", "78702", 949000, 3, "2.5", 2140, "Active", "Architect-designed East Austin modern with a rooftop deck and skyline views. Walk to coffee, cocktails, and the hike-and-bike trail — city living at its finest.", IMG.listingAustinModern, "Steven", 1, 1, 0, "Residential"],
    ["9210-legacy-ranch-dfw", "9210 Legacy Ranch Dr", "DFW", "75035", 675000, 5, "4", 3480, "Pending", "Master-planned living in Frisco's most sought-after corridor — five bedrooms, a game room, media room, and exemplary schools within walking distance.", IMG.listingGracelyn, "Abby", 1, 0, 1, "Residential"],
    ["4518-heights-bungalow-houston", "4518 Heights Bungalow", "Houston", "77008", 515000, 3, "2", 1980, "Active", "A reimagined Heights bungalow with designer finishes throughout — quartz kitchen, spa bath, and a rare two-car garage on a picture-perfect tree-lined street.", IMG.listingHoustonSunset, "Laila", 1, 0, 0, "Residential"],
    ["77-alamo-ranch-estates-san-antonio", "77 Alamo Ranch Estates", "San Antonio", "78253", 429000, 4, "3", 2650, "Sold", "SOLD over asking in 6 days. New-construction beauty in Alamo Ranch with an open-concept layout, flex office, and community pool, park, and trails.", IMG.listingBarnhouse, "Irma", 1, 0, 1, "Residential"],
  ];
  for (const [slug, address, city, zip, price, beds, baths, sqft, status, description, heroImage, agentName, featured, hasPool, isNewConstruction, propertyType] of listings) {
    await db.execute({
      sql: `INSERT INTO listings (slug, address, city, state, zip, price, beds, baths, sqft, status, description, heroImage, photos, agentName, featured, hasPool, isNewConstruction, propertyType, source)
            VALUES (?,?,?,'TX',?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'cms')`,
      args: [slug, address, city, zip, price, beds, baths, sqft, status, description, heroImage, JSON.stringify([heroImage, IMG.interiorMoody, IMG.listingPoolEstate]), agentName, featured, hasPool, isNewConstruction, propertyType],
    });
  }

  console.log("Seed complete");
  await conn.end();
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
