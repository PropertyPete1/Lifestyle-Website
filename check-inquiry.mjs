import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.query(
  "SELECT id, name, email, phone, sourceTag, fubStatus, fubId, message FROM leads WHERE email = 'test-webinquiry@example.com'"
);
for (const r of rows) console.log(JSON.stringify(r, null, 2));

// Verify the FUB contact was tagged correctly
const apiKey = process.env.FUB_API_KEY;
if (apiKey && rows.length) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    "User-Agent": "LifestyleDesignRealty-Website/1.0",
    "X-System": "Lifestyle Design Realty Website",
  };
  if (process.env.FUB_X_SYSTEM_KEY) headers["X-System-Key"] = process.env.FUB_X_SYSTEM_KEY;
  const res = await fetch(
    "https://api.followupboss.com/v1/people?email=" + encodeURIComponent("test-webinquiry@example.com"),
    { headers }
  );
  const data = await res.json().catch(() => ({}));
  const person = data?.people?.[0];
  console.log("FUB person:", person ? { id: person.id, name: person.name, tags: person.tags, source: person.source, phones: person.phones?.map(p => p.value) } : "not found", "status:", res.status);
}
await conn.end();
