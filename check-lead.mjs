import "dotenv/config";
import mysql from "mysql2/promise";
const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [rows] = await conn.execute("SELECT id, name, intent, fubStatus FROM leads WHERE email='manus-test@example.com'");
console.log(rows);
// check FUB side
const key = process.env.FUB_API_KEY;
const auth = Buffer.from(key + ":").toString("base64");
const r = await fetch("https://api.followupboss.com/v1/people?email=manus-test@example.com", { headers: { Authorization: "Basic " + auth } });
const j = await r.json();
console.log("FUB people found:", j.people?.length, j.people?.[0]?.tags);
// cleanup FUB test contact
if (j.people?.length) {
  for (const p of j.people) {
    const d = await fetch("https://api.followupboss.com/v1/people/" + p.id, { method: "DELETE", headers: { Authorization: "Basic " + auth } });
    console.log("deleted FUB person", p.id, d.status);
  }
}
await conn.execute("DELETE FROM leads WHERE email='manus-test@example.com'");
console.log("cleaned local lead");
await conn.end();
