import { Router } from "express";
import { pool } from "../db/pool";

const router = Router();

// GET /public/schools — ro'yxatdan o'tish uchun (auth kerak emas)
router.get("/schools", async (_req, res) => {
  const { rows } = await pool.query(`SELECT id, name FROM schools ORDER BY name`);
  res.json(rows);
});

export default router;
