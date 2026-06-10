-- =============================================================
-- MIGRATION: subjects → topics ajratish
-- Production serverda FAQAT BIR MARTA bajaring!
-- sudo -u postgres psql anjir_db -f migration_topics.sql
-- =============================================================

BEGIN;

-- 1. Yangi jadvallar
CREATE TABLE IF NOT EXISTS topics (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  teacher_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS topic_classes (
  topic_id UUID NOT NULL REFERENCES topics(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (topic_id, class_id)
);

CREATE INDEX IF NOT EXISTS idx_topics_subject ON topics(subject_id);
CREATE INDEX IF NOT EXISTS idx_topics_teacher ON topics(teacher_id);

-- 2. Mavzularni subjects → topics ga ko'chirish (UUID'larni saqlab)
INSERT INTO topics (id, name, subject_id, teacher_id, created_at)
SELECT s.id, s.name, stl.fan_subject_id, NULL, s.created_at
FROM subjects s
JOIN subject_topic_links stl ON stl.topic_subject_id = s.id
ON CONFLICT (id) DO NOTHING;

-- 3. Topic-class bog'lanishlarini teacher_assignments'dan topic_classes ga ko'chirish
INSERT INTO topic_classes (topic_id, class_id)
SELECT DISTINCT ta.subject_id, ta.class_id
FROM teacher_assignments ta
WHERE ta.subject_id IN (SELECT id FROM topics)
ON CONFLICT DO NOTHING;

-- 4. Content jadvallariga topic_id ustuni qo'shish
ALTER TABLE lectures    ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;
ALTER TABLE assignments ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;
ALTER TABLE tests       ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;
ALTER TABLE games       ADD COLUMN IF NOT EXISTS topic_id UUID REFERENCES topics(id) ON DELETE SET NULL;

-- 5. topic_id ni eski subject_id dan to'ldirish (bir xil UUID ishlatilgani uchun)
UPDATE lectures    SET topic_id = subject_id WHERE subject_id IN (SELECT id FROM topics);
UPDATE assignments SET topic_id = subject_id WHERE subject_id IN (SELECT id FROM topics);
UPDATE tests       SET topic_id = subject_id WHERE subject_id IN (SELECT id FROM topics);
UPDATE games       SET topic_id = subject_id WHERE subject_id IN (SELECT id FROM topics);

-- 6. teacher_assignments'dan mavzularni o'chirish (ular endi topic_classes da)
DELETE FROM teacher_assignments WHERE subject_id IN (SELECT id FROM topics);

-- 7. school_subjects'dan mavzularni o'chirish
DELETE FROM school_subjects WHERE subject_id IN (SELECT id FROM topics);

-- 8. Content jadvallaridan subject_id FK ni olib tashlash
ALTER TABLE lectures    DROP COLUMN IF EXISTS subject_id;
ALTER TABLE assignments DROP COLUMN IF EXISTS subject_id;
ALTER TABLE tests       DROP COLUMN IF EXISTS subject_id;
ALTER TABLE games       DROP COLUMN IF EXISTS subject_id;

-- 9. subject_topic_links jadvalni o'chirish
DROP TABLE IF EXISTS subject_topic_links;

-- 10. Mavzularni subjects jadvalidan o'chirish
DELETE FROM subjects WHERE id IN (SELECT id FROM topics);

-- Indekslar
CREATE INDEX IF NOT EXISTS idx_lectures_topic   ON lectures(topic_id);
CREATE INDEX IF NOT EXISTS idx_tests_topic       ON tests(topic_id);

COMMIT;
