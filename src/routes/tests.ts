import { Router } from "express";
import { z } from "zod";
import multer from "multer";
import { pool } from "../db/pool";
import { requireAuth } from "../middleware/auth";
import { requireRole } from "../middleware/role";
import { generateTestExcel, parseTestExcel } from "../utils/testExcel";
import type { AuthRequest } from "../types";

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

const router = Router();
router.use(requireAuth);

// GET /tests?teacher_id=&class_id=
router.get("/", async (req, res) => {
  const { teacher_id, class_id } = req.query as Record<string, string>;
  let rows;
  if (class_id) {
    ({ rows } = await pool.query(
      `SELECT t.*, sub.name AS subject_name
       FROM tests t
       JOIN test_classes tc ON tc.test_id = t.id
       JOIN subjects sub ON sub.id = t.subject_id
       WHERE tc.class_id = $1
       ORDER BY t.created_at DESC`,
      [class_id]
    ));
  } else if (teacher_id) {
    ({ rows } = await pool.query(
      `SELECT t.*, sub.name AS subject_name
       FROM tests t
       JOIN subjects sub ON sub.id = t.subject_id
       WHERE t.teacher_id = $1
       ORDER BY t.created_at DESC`,
      [teacher_id]
    ));
  } else {
    res.status(400).json({ error: "teacher_id yoki class_id kerak" });
    return;
  }
  res.json(rows);
});

// GET /tests/template — bo'sh shablon yuklab olish
router.get("/template", requireRole("teacher", "super_admin"), async (_req, res) => {
  const template = await generateTestExcel({
    title: "Namuna test sarlavhasi",
    description: "Test tavsifi (ixtiyoriy)",
    time_limit: 30,
    test_type: "home_study",
    max_attempts: 3,
    questions: [
      {
        question_text: "Namuna savol 1 (bir javobli)",
        question_type: "single",
        points: 1,
        options: [
          { option_text: "Variant A", is_correct: true },
          { option_text: "Variant B", is_correct: false },
          { option_text: "Variant C", is_correct: false },
          { option_text: "Variant D", is_correct: false },
        ],
      },
      {
        question_text: "Namuna savol 2 (ko'p javobli)",
        question_type: "multiple",
        points: 2,
        options: [
          { option_text: "Variant A", is_correct: true },
          { option_text: "Variant B", is_correct: false },
          { option_text: "Variant C", is_correct: true },
          { option_text: "Variant D", is_correct: false },
        ],
      },
      {
        question_text: "Namuna savol 3 (to'g'ri/noto'g'ri)",
        question_type: "true_false",
        points: 1,
        options: [
          { option_text: "To'g'ri", is_correct: true },
          { option_text: "Noto'g'ri", is_correct: false },
        ],
      },
    ],
  });
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", "attachment; filename*=UTF-8''test-shablon.xlsx");
  res.send(template);
});

// POST /tests/import — Excel dan test yuklash
router.post("/import", requireRole("teacher", "super_admin"), upload.single("file"), async (req: AuthRequest, res) => {
  if (!req.file) { res.status(400).json({ error: "Fayl kerak" }); return; }
  let parsed;
  try {
    parsed = await parseTestExcel(req.file.buffer);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : "Fayl o'qishda xatolik" });
    return;
  }
  const { subject_id, class_ids } = req.body as { subject_id?: string; class_ids?: string };
  if (!subject_id) { res.status(400).json({ error: "subject_id kerak" }); return; }
  const classIds: string[] = class_ids ? JSON.parse(class_ids) : [];
  const { rows } = await pool.query(
    `INSERT INTO tests (teacher_id, subject_id, title, description, time_limit, test_type, max_attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.user!.sub, subject_id, parsed.title, parsed.description,
     parsed.time_limit, parsed.test_type, parsed.max_attempts]
  );
  const testId = rows[0].id;
  await upsertTestData(pool, testId, { ...parsed, subject_id, class_ids: classIds });
  res.status(201).json({ id: testId, question_count: parsed.questions.length });
});

// GET /tests/:id (with questions + options)
router.get("/:id", async (req, res) => {
  const { rows: tests } = await pool.query(
    `SELECT t.*, sub.name AS subject_name,
            COALESCE(
              (SELECT json_agg(tc.class_id) FROM test_classes tc WHERE tc.test_id = t.id), '[]'
            ) AS class_ids
     FROM tests t
     JOIN subjects sub ON sub.id = t.subject_id
     WHERE t.id = $1`,
    [req.params.id]
  );
  if (!tests[0]) { res.status(404).json({ error: "Topilmadi" }); return; }

  const { rows: questions } = await pool.query(
    `SELECT q.*, COALESCE(
       (SELECT json_agg(json_build_object('id',o.id,'option_text',o.option_text,'is_correct',o.is_correct)
        ORDER BY o.id)
        FROM question_options o WHERE o.question_id = q.id), '[]'
     ) AS question_options
     FROM questions q
     WHERE q.test_id = $1
     ORDER BY q.sort_order`,
    [req.params.id]
  );

  res.json({ ...tests[0], questions });
});

const OptionSchema = z.object({ option_text: z.string(), is_correct: z.boolean() });
const QuestionSchema = z.object({
  question_text: z.string().min(1),
  question_type: z.enum(["single", "multiple", "true_false", "fill_blank"]),
  image_url: z.string().url().nullable().optional(),
  image_alt: z.string().nullable().optional(),
  points: z.number().int().min(1).default(1),
  options: z.array(OptionSchema).default([]),
});
const TestSchema = z.object({
  subject_id:   z.string().uuid(),
  title:        z.string().min(1),
  description:  z.string().nullable().optional(),
  time_limit:   z.number().int().positive().nullable().optional(),
  test_type:    z.enum(["entry", "post_topic", "home_study"]).default("home_study"),
  max_attempts: z.number().int().positive().nullable().optional(),
  class_ids:    z.array(z.string().uuid()).default([]),
  questions:    z.array(QuestionSchema).min(1),
});

async function upsertTestData(
  client: typeof pool,
  testId: string,
  input: z.infer<typeof TestSchema>
) {
  // Sinflar
  await client.query("DELETE FROM test_classes WHERE test_id = $1", [testId]);
  if (input.class_ids.length > 0) {
    await client.query(
      `INSERT INTO test_classes (test_id, class_id) SELECT $1, unnest($2::uuid[])`,
      [testId, input.class_ids]
    );
  }
  // Eski savollar
  await client.query("DELETE FROM questions WHERE test_id = $1", [testId]);
  // Yangi savollar
  for (const [i, q] of input.questions.entries()) {
    const { rows: qRows } = await client.query(
      `INSERT INTO questions (test_id, question_text, question_type, image_url, image_alt, points, sort_order)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [testId, q.question_text, q.question_type, q.image_url ?? null, q.image_alt ?? null, q.points, i]
    );
    const qId = qRows[0].id;
    const options = q.question_type === "true_false"
      ? [{ option_text: "To'g'ri", is_correct: q.options[0]?.is_correct ?? true },
         { option_text: "Noto'g'ri", is_correct: !(q.options[0]?.is_correct ?? true) }]
      : q.options;
    if (options.length > 0) {
      await client.query(
        `INSERT INTO question_options (question_id, option_text, is_correct)
         SELECT $1, t.option_text, t.is_correct FROM jsonb_to_recordset($2::jsonb) AS t(option_text text, is_correct boolean)`,
        [qId, JSON.stringify(options)]
      );
    }
  }
}

// POST /tests
router.post("/", requireRole("teacher", "super_admin"), async (req: AuthRequest, res) => {
  const parsed = TestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message }); return; }

  const { rows } = await pool.query(
    `INSERT INTO tests (teacher_id, subject_id, title, description, time_limit, test_type, max_attempts)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [req.user!.sub, parsed.data.subject_id, parsed.data.title, parsed.data.description ?? null,
     parsed.data.time_limit ?? null, parsed.data.test_type, parsed.data.max_attempts ?? null]
  );
  const testId = rows[0].id;
  await upsertTestData(pool, testId, parsed.data);
  res.status(201).json({ id: testId });
});

// PUT /tests/:id
router.put("/:id", requireRole("teacher", "super_admin"), async (req: AuthRequest, res) => {
  const parsed = TestSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: parsed.error.errors[0]?.message }); return; }

  await pool.query(
    `UPDATE tests SET subject_id=$1, title=$2, description=$3, time_limit=$4, test_type=$5, max_attempts=$6
     WHERE id=$7 AND (teacher_id=$8 OR $9='super_admin')`,
    [parsed.data.subject_id, parsed.data.title, parsed.data.description ?? null,
     parsed.data.time_limit ?? null, parsed.data.test_type, parsed.data.max_attempts ?? null,
     req.params.id, req.user!.sub, req.user!.role]
  );
  await upsertTestData(pool, req.params.id, parsed.data);
  res.json({ ok: true });
});

// GET /tests/:id/export — Excel yuklab olish
router.get("/:id/export", requireRole("teacher", "director", "super_admin"), async (req, res) => {
  const { rows: tests } = await pool.query(
    `SELECT t.title, t.description, t.time_limit, t.test_type, t.max_attempts FROM tests t WHERE t.id = $1`,
    [req.params.id]
  );
  if (!tests[0]) { res.status(404).json({ error: "Test topilmadi" }); return; }

  const { rows: questions } = await pool.query(
    `SELECT q.question_text, q.question_type, q.points,
            COALESCE(json_agg(json_build_object('option_text',o.option_text,'is_correct',o.is_correct) ORDER BY o.id) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
     FROM questions q
     LEFT JOIN question_options o ON o.question_id = q.id
     WHERE q.test_id = $1
     GROUP BY q.id ORDER BY q.sort_order`,
    [req.params.id]
  );

  const buffer = await generateTestExcel({ ...tests[0], questions });
  const filename = encodeURIComponent(tests[0].title.replace(/[^\w\s-]/g, "")) + ".xlsx";
  res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${filename}`);
  res.send(buffer);
});


// DELETE /tests/:id
router.delete("/:id", requireRole("teacher", "super_admin"), async (req: AuthRequest, res) => {
  await pool.query(
    "DELETE FROM tests WHERE id=$1 AND (teacher_id=$2 OR $3='super_admin')",
    [req.params.id, req.user!.sub, req.user!.role]
  );
  res.json({ ok: true });
});

// POST /tests/:id/attempts — attempt boshlash
router.post("/:id/attempts", requireRole("student"), async (req: AuthRequest, res) => {
  const studentId = req.user!.sub;
  const testId = req.params.id;

  const { rows: test } = await pool.query(
    "SELECT max_attempts FROM tests WHERE id = $1", [testId]
  );
  if (!test[0]) { res.status(404).json({ error: "Test topilmadi" }); return; }

  if (test[0].max_attempts) {
    const { rows: cnt } = await pool.query(
      "SELECT COUNT(*) FROM test_attempts WHERE student_id=$1 AND test_id=$2 AND finished_at IS NOT NULL",
      [studentId, testId]
    );
    if (Number(cnt[0].count) >= test[0].max_attempts) {
      res.status(403).json({ error: "Urinishlar soni tugadi" }); return;
    }
  }

  const { rows } = await pool.query(
    "INSERT INTO test_attempts (student_id, test_id) VALUES ($1,$2) RETURNING id",
    [studentId, testId]
  );
  res.status(201).json({ attempt_id: rows[0].id });
});

// POST /tests/attempts/:attemptId/finish
router.post("/attempts/:attemptId/finish", requireRole("student"), async (req: AuthRequest, res) => {
  const { answers, score } = req.body as {
    answers: { questionId: string; selectedOptionIds?: string[]; answerText?: string; isCorrect: boolean }[];
    score: number;
  };

  await pool.query(
    "UPDATE test_attempts SET finished_at=NOW(), score=$1 WHERE id=$2 AND student_id=$3",
    [score, req.params.attemptId, req.user!.sub]
  );

  if (answers?.length > 0) {
    await pool.query(
      `INSERT INTO test_answers (attempt_id, question_id, answer_text, selected_option_ids, is_correct)
       SELECT $1, t.question_id, t.answer_text, t.selected_option_ids, t.is_correct
       FROM jsonb_to_recordset($2::jsonb) AS t(question_id uuid, answer_text text, selected_option_ids uuid[], is_correct boolean)`,
      [req.params.attemptId, JSON.stringify(answers.map((a) => ({
        question_id: a.questionId,
        answer_text: a.answerText ?? null,
        selected_option_ids: a.selectedOptionIds ?? null,
        is_correct: a.isCorrect,
      })))]
    );
  }

  res.json({ ok: true });
});

// GET /tests/:id/attempts?student_id=
// GET /tests/:id/result?student_id= — result page data
router.get("/:id/result", async (req, res) => {
  const { student_id } = req.query as Record<string, string>;
  if (!student_id) { res.status(400).json({ error: "student_id kerak" }); return; }

  const [testRes, attemptsRes] = await Promise.all([
    pool.query(`SELECT title, max_attempts FROM tests WHERE id = $1`, [req.params.id]),
    pool.query(
      `SELECT score, finished_at FROM test_attempts WHERE student_id=$1 AND test_id=$2 AND finished_at IS NOT NULL ORDER BY finished_at DESC`,
      [student_id, req.params.id]
    ),
  ]);
  if (!testRes.rows[0]) { res.status(404).json({ error: "Topilmadi" }); return; }
  res.json({ ...testRes.rows[0], attempts: attemptsRes.rows });
});

router.get("/:id/attempts", async (req, res) => {
  const { student_id } = req.query as Record<string, string>;
  if (!student_id) { res.status(400).json({ error: "student_id kerak" }); return; }
  const { rows } = await pool.query(
    "SELECT id, started_at, finished_at, score FROM test_attempts WHERE student_id=$1 AND test_id=$2 ORDER BY started_at DESC",
    [student_id, req.params.id]
  );
  res.json(rows);
});

export default router;
