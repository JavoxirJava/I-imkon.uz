/**
 * Supabase → local PostgreSQL migration script.
 * Barcha public.* jadvallarini ko'chirib, userlarga "12345678" parol beradi.
 *
 * Ishlatish:
 *   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... tsx src/db/migrate-from-supabase.ts
 *   yoki server/.env ga qo'shib: tsx src/db/migrate-from-supabase.ts
 */

import "dotenv/config";
import { createClient } from "@supabase/supabase-js";
import bcrypt from "bcryptjs";
import { pool } from "./pool";

const supabase = createClient(
  process.env.SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
);

async function fetchAll<T>(table: string): Promise<T[]> {
  const { data, error } = await supabase.from(table).select("*");
  if (error) throw new Error(`${table}: ${error.message}`);
  return (data ?? []) as T[];
}

async function run() {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    // 1. USERS — parol "12345678"
    console.log("→ users...");
    const passwordHash = await bcrypt.hash("12345678", 10);
    const users = await fetchAll<{
      id: string; phone: string; first_name: string;
      last_name: string; role: string; status: string; created_at: string;
    }>("users");

    for (const u of users) {
      await client.query(
        `INSERT INTO users (id, phone, password_hash, first_name, last_name, role, status, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
         ON CONFLICT (id) DO NOTHING`,
        [u.id, u.phone, passwordHash, u.first_name, u.last_name, u.role, u.status, u.created_at]
      );
    }
    console.log(`   ${users.length} user`);

    // 2. SCHOOLS
    console.log("→ schools...");
    const schools = await fetchAll<{ id: string; name: string; address: string | null; director_id: string | null; created_at: string }>("schools");
    for (const s of schools) {
      await client.query(
        `INSERT INTO schools (id, name, address, director_id, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.name, s.address, s.director_id, s.created_at]
      );
    }
    console.log(`   ${schools.length} school`);

    // 3. CLASSES
    console.log("→ classes...");
    const classes = await fetchAll<{ id: string; school_id: string; grade: number; letter: string; created_at: string }>("classes");
    for (const c of classes) {
      await client.query(
        `INSERT INTO classes (id, school_id, grade, letter, created_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [c.id, c.school_id, c.grade, c.letter, c.created_at]
      );
    }
    console.log(`   ${classes.length} class`);

    // 4. SUBJECTS
    console.log("→ subjects...");
    const subjects = await fetchAll<{ id: string; name: string; created_at: string }>("subjects");
    for (const s of subjects) {
      await client.query(
        `INSERT INTO subjects (id, name, created_at)
         VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.name, s.created_at]
      );
    }
    console.log(`   ${subjects.length} subject`);

    // 5. SCHOOL_SUBJECTS
    console.log("→ school_subjects...");
    const schoolSubjects = await fetchAll<{ school_id: string; subject_id: string }>("school_subjects");
    for (const ss of schoolSubjects) {
      await client.query(
        `INSERT INTO school_subjects (school_id, subject_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [ss.school_id, ss.subject_id]
      );
    }
    console.log(`   ${schoolSubjects.length} school_subject`);

    // 6. TEACHER_ASSIGNMENTS
    console.log("→ teacher_assignments...");
    const tas = await fetchAll<{ id: string; teacher_id: string; school_id: string; class_id: string; subject_id: string }>("teacher_assignments");
    for (const ta of tas) {
      await client.query(
        `INSERT INTO teacher_assignments (id, teacher_id, school_id, class_id, subject_id)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [ta.id, ta.teacher_id, ta.school_id, ta.class_id, ta.subject_id]
      );
    }
    console.log(`   ${tas.length} teacher_assignment`);

    // 7. STUDENT_PROFILES
    console.log("→ student_profiles...");
    const sps = await fetchAll<{ user_id: string; school_id: string; class_id: string; approved_by: string | null; approved_at: string | null; rejection_reason: string | null }>("student_profiles");
    for (const sp of sps) {
      await client.query(
        `INSERT INTO student_profiles (user_id, school_id, class_id, approved_by, approved_at, rejection_reason)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (user_id) DO NOTHING`,
        [sp.user_id, sp.school_id, sp.class_id, sp.approved_by, sp.approved_at, sp.rejection_reason]
      );
    }
    console.log(`   ${sps.length} student_profile`);

    // 8. ACCESSIBILITY_PROFILES
    console.log("→ accessibility_profiles...");
    const aps = await fetchAll<{
      user_id: string; vision_mode: boolean; hearing_mode: boolean; motor_mode: boolean;
      tts_source: string; font_size: string; contrast_mode: string; color_blind_mode: string;
      reduce_motion: boolean; subtitles_always: boolean; screening_completed: boolean; updated_at: string;
    }>("accessibility_profiles");
    for (const ap of aps) {
      await client.query(
        `INSERT INTO accessibility_profiles
           (user_id, vision_mode, hearing_mode, motor_mode, tts_source, font_size,
            contrast_mode, color_blind_mode, reduce_motion, subtitles_always, screening_completed, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (user_id) DO NOTHING`,
        [ap.user_id, ap.vision_mode, ap.hearing_mode, ap.motor_mode, ap.tts_source,
         ap.font_size, ap.contrast_mode, ap.color_blind_mode, ap.reduce_motion,
         ap.subtitles_always, ap.screening_completed, ap.updated_at]
      );
    }
    console.log(`   ${aps.length} accessibility_profile`);

    // 9. LECTURES
    console.log("→ lectures...");
    const lectures = await fetchAll<{
      id: string; creator_id: string; school_id: string | null; subject_id: string;
      class_id: string | null; title: string; description: string | null;
      content_type: string; file_url: string; created_at: string;
    }>("lectures");
    for (const l of lectures) {
      await client.query(
        `INSERT INTO lectures (id, creator_id, school_id, subject_id, class_id, title, description, content_type, file_url, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT (id) DO NOTHING`,
        [l.id, l.creator_id, l.school_id, l.subject_id, l.class_id, l.title, l.description, l.content_type, l.file_url, l.created_at]
      );
    }
    console.log(`   ${lectures.length} lecture`);

    // 10. LECTURE_SUBTITLES
    console.log("→ lecture_subtitles...");
    const subtitles = await fetchAll<{ id: string; lecture_id: string; vtt_url: string; language: string; source: string }>("lecture_subtitles");
    for (const s of subtitles) {
      await client.query(
        `INSERT INTO lecture_subtitles (id, lecture_id, vtt_url, language, source)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.lecture_id, s.vtt_url, s.language, s.source]
      );
    }
    console.log(`   ${subtitles.length} subtitle`);

    // 11. ASSIGNMENTS
    console.log("→ assignments...");
    const assignments = await fetchAll<{
      id: string; teacher_id: string; subject_id: string; class_id: string;
      title: string; description: string | null; file_url: string | null;
      deadline: string | null; created_at: string;
    }>("assignments");
    for (const a of assignments) {
      await client.query(
        `INSERT INTO assignments (id, teacher_id, subject_id, class_id, title, description, file_url, deadline, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [a.id, a.teacher_id, a.subject_id, a.class_id, a.title, a.description, a.file_url, a.deadline, a.created_at]
      );
    }
    console.log(`   ${assignments.length} assignment`);

    // 12. ASSIGNMENT_SUBMISSIONS
    console.log("→ assignment_submissions...");
    const subs = await fetchAll<{
      id: string; assignment_id: string; student_id: string;
      text: string | null; file_url: string | null; submitted_at: string;
      grade: number | null; comment: string | null;
    }>("assignment_submissions");
    for (const s of subs) {
      await client.query(
        `INSERT INTO assignment_submissions (id, assignment_id, student_id, content, file_url, submitted_at, score, teacher_comment)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [s.id, s.assignment_id, s.student_id, s.text, s.file_url, s.submitted_at, s.grade, s.comment]
      );
    }
    console.log(`   ${subs.length} submission`);

    // 13. TESTS
    console.log("→ tests...");
    const tests = await fetchAll<{
      id: string; teacher_id: string | null; subject_id: string; title: string;
      description: string | null; time_limit: number | null; test_type: string;
      max_attempts: number | null; created_at: string;
    }>("tests");
    for (const t of tests) {
      await client.query(
        `INSERT INTO tests (id, teacher_id, subject_id, title, description, time_limit, test_type, max_attempts, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [t.id, t.teacher_id, t.subject_id, t.title, t.description, t.time_limit, t.test_type, t.max_attempts, t.created_at]
      );
    }
    console.log(`   ${tests.length} test`);

    // 14. TEST_CLASSES
    console.log("→ test_classes...");
    const testClasses = await fetchAll<{ test_id: string; class_id: string }>("test_classes");
    for (const tc of testClasses) {
      await client.query(
        `INSERT INTO test_classes (test_id, class_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [tc.test_id, tc.class_id]
      );
    }

    // 15. QUESTIONS
    console.log("→ questions...");
    const questions = await fetchAll<{
      id: string; test_id: string; question_text: string; question_type: string;
      image_url: string | null; image_alt: string | null; points: number; order: number;
    }>("questions");
    for (const q of questions) {
      await client.query(
        `INSERT INTO questions (id, test_id, question_text, question_type, image_url, image_alt, points, sort_order)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [q.id, q.test_id, q.question_text, q.question_type, q.image_url, q.image_alt, q.points, q.order]
      );
    }
    console.log(`   ${questions.length} question`);

    // 16. QUESTION_OPTIONS
    console.log("→ question_options...");
    const options = await fetchAll<{ id: string; question_id: string; option_text: string; is_correct: boolean }>("question_options");
    for (const o of options) {
      await client.query(
        `INSERT INTO question_options (id, question_id, option_text, is_correct)
         VALUES ($1,$2,$3,$4) ON CONFLICT (id) DO NOTHING`,
        [o.id, o.question_id, o.option_text, o.is_correct]
      );
    }
    console.log(`   ${options.length} option`);

    // 17. TEST_ATTEMPTS
    console.log("→ test_attempts...");
    const attempts = await fetchAll<{ id: string; student_id: string; test_id: string; started_at: string; finished_at: string | null; score: number | null }>("test_attempts");
    for (const a of attempts) {
      await client.query(
        `INSERT INTO test_attempts (id, student_id, test_id, started_at, finished_at, score)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [a.id, a.student_id, a.test_id, a.started_at, a.finished_at, a.score]
      );
    }

    // 18. TEST_ANSWERS
    console.log("→ test_answers...");
    const answers = await fetchAll<{ id: string; attempt_id: string; question_id: string; answer_text: string | null; selected_option_ids: string[] | null; is_correct: boolean }>("test_answers");
    for (const a of answers) {
      await client.query(
        `INSERT INTO test_answers (id, attempt_id, question_id, answer_text, selected_option_ids, is_correct)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [a.id, a.attempt_id, a.question_id, a.answer_text, a.selected_option_ids, a.is_correct]
      );
    }

    // 19. GAMES
    console.log("→ games...");
    const games = await fetchAll<{ id: string; teacher_id: string; template_type: string; subject_id: string; title: string; content_json: object; created_at: string }>("games");
    for (const g of games) {
      await client.query(
        `INSERT INTO games (id, teacher_id, template_type, subject_id, title, content_json, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING`,
        [g.id, g.teacher_id, g.template_type, g.subject_id, g.title, JSON.stringify(g.content_json), g.created_at]
      );
    }
    console.log(`   ${games.length} game`);

    // 20. GAME_CLASSES
    const gameClasses = await fetchAll<{ game_id: string; class_id: string }>("game_classes");
    for (const gc of gameClasses) {
      await client.query(
        `INSERT INTO game_classes (game_id, class_id) VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [gc.game_id, gc.class_id]
      );
    }

    // 21. GAME_ATTEMPTS
    console.log("→ game_attempts...");
    const gameAttempts = await fetchAll<{ id: string; student_id: string; game_id: string; score: number; duration: number; completed_at: string }>("game_attempts");
    for (const ga of gameAttempts) {
      await client.query(
        `INSERT INTO game_attempts (id, student_id, game_id, score, duration, completed_at)
         VALUES ($1,$2,$3,$4,$5,$6) ON CONFLICT (id) DO NOTHING`,
        [ga.id, ga.student_id, ga.game_id, ga.score, ga.duration, ga.completed_at]
      );
    }

    // 22. BOOKS
    console.log("→ books...");
    const books = await fetchAll<{
      id: string; uploader_id: string; title: string; description: string | null;
      pdf_url: string; audio_url: string | null; audio_source: string | null;
      ocr_required: boolean; created_at: string;
    }>("books");
    for (const b of books) {
      await client.query(
        `INSERT INTO books (id, uploader_id, title, description, pdf_url, audio_url, audio_source, ocr_required, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT (id) DO NOTHING`,
        [b.id, b.uploader_id, b.title, b.description, b.pdf_url, b.audio_url, b.audio_source, b.ocr_required, b.created_at]
      );
    }
    console.log(`   ${books.length} book`);

    // 23. BOOK_BOOKMARKS
    console.log("→ book_bookmarks...");
    const bookmarks = await fetchAll<{ user_id: string; book_id: string; page: number; audio_timestamp: number | null; updated_at: string }>("book_bookmarks");
    for (const bm of bookmarks) {
      await client.query(
        `INSERT INTO book_bookmarks (user_id, book_id, page, audio_timestamp, updated_at)
         VALUES ($1,$2,$3,$4,$5) ON CONFLICT (user_id, book_id) DO NOTHING`,
        [bm.user_id, bm.book_id, bm.page, bm.audio_timestamp, bm.updated_at]
      );
    }

    // 24. NOTIFICATIONS
    console.log("→ notifications...");
    const notifications = await fetchAll<{ id: string; user_id: string; type: string; title: string; message: string; link: string | null; read: boolean; created_at: string }>("notifications");
    for (const n of notifications) {
      await client.query(
        `INSERT INTO notifications (id, user_id, type, title, message, link, read, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (id) DO NOTHING`,
        [n.id, n.user_id, n.type, n.title, n.message, n.link, n.read, n.created_at]
      );
    }
    console.log(`   ${notifications.length} notification`);

    await client.query("COMMIT");
    console.log("\n✓ Migration tugadi!");
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("✗ Xato, rollback:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

run();
