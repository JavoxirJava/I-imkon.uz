import fs from "fs";
import path from "path";
import { pool } from "./pool";

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, "schema.sql"), "utf-8");
  const client = await pool.connect();
  try {
    await client.query(sql);
    console.log("✅ Migration muvaffaqiyatli bajarildi");
  } catch (err) {
    console.error("❌ Migration xatosi:", err);
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
