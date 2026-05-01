"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const pool_1 = require("./pool");
async function migrate() {
    const sql = fs_1.default.readFileSync(path_1.default.join(__dirname, "schema.sql"), "utf-8");
    const client = await pool_1.pool.connect();
    try {
        await client.query(sql);
        console.log("✅ Migration muvaffaqiyatli bajarildi");
    }
    catch (err) {
        console.error("❌ Migration xatosi:", err);
        throw err;
    }
    finally {
        client.release();
        await pool_1.pool.end();
    }
}
migrate();
