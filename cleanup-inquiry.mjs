import mysql from "mysql2/promise";
import "dotenv/config";

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const [r] = await conn.execute("DELETE FROM leads WHERE email = 'test-webinquiry@example.com'");
console.log("local leads deleted:", r.affectedRows);

const apiKey = process.env.FUB_API_KEY;
if (apiKey) {
  const headers = {
    Authorization: `Basic ${Buffer.from(`${apiKey}:`).toString("base64")}`,
    "User-Agent": "LifestyleDesignRealty-Website/1.0",
    "X-System": "Lifestyle Design Realty Website",
  };
  if (process.env.FUB_X_SYSTEM_KEY) headers["X-System-Key"] = process.env.FUB_X_SYSTEM_KEY;
  const res = await fetch("https://api.followupboss.com/v1/people/6185", { method: "DELETE", headers });
  console.log("FUB person 6185 delete status:", res.status);
}
await conn.end();
