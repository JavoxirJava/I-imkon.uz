-- =============================================================
-- anjir-server — To'liq DB sxemasi (standalone PostgreSQL)
-- =============================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- =============================================================
-- ENUMLAR
-- =============================================================

CREATE TYPE user_role AS ENUM ('super_admin', 'director', 'teacher', 'student', 'parent');
CREATE TYPE user_status AS ENUM ('pending', 'active', 'rejected');
CREATE TYPE content_type AS ENUM ('pdf', 'video', 'audio', 'ppt');
CREATE TYPE subtitle_source AS ENUM ('manual', 'ai');
CREATE TYPE test_type AS ENUM ('entry', 'post_topic', 'home_study');
CREATE TYPE question_type AS ENUM ('single', 'multiple', 'true_false', 'fill_blank');
CREATE TYPE game_template AS ENUM ('word_match', 'ordering', 'memory');
CREATE TYPE audio_source AS ENUM ('uploaded', 'web_speech', 'google_tts');
CREATE TYPE tts_source_type AS ENUM ('web_speech', 'google_tts', 'own_reader');
CREATE TYPE font_size_type AS ENUM ('small', 'medium', 'large', 'xlarge');
CREATE TYPE contrast_mode AS ENUM ('normal', 'high', 'dark');
CREATE TYPE color_blind_mode AS ENUM ('normal', 'protanopia', 'deuteranopia', 'tritanopia');

-- =============================================================
-- 1. FOYDALANUVCHILAR
-- =============================================================

CREATE TABLE users (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  phone         TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL,
  first_name    TEXT NOT NULL,
  last_name     TEXT NOT NULL,
  role          user_role NOT NULL DEFAULT 'student',
  status        user_status NOT NULL DEFAULT 'pending',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_role   ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_phone  ON users(phone);

-- Refresh tokenlar
CREATE TABLE refresh_tokens (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token      TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_refresh_tokens_user ON refresh_tokens(user_id);

-- =============================================================
-- 2. MAKTAB VA SINFLAR
-- =============================================================

CREATE TABLE schools (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name        TEXT NOT NULL,
  address     TEXT,
  director_id UUID REFERENCES users(id) ON DELETE SET NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE classes (
  id        UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  school_id UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  grade     SMALLINT NOT NULL CHECK (grade BETWEEN 5 AND 9),
  letter    CHAR(1) NOT NULL CHECK (letter ~ '^[A-Za-z]$'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (school_id, grade, letter)
);

CREATE INDEX idx_classes_school ON classes(school_id);

-- =============================================================
-- 3. FANLAR
-- =============================================================

CREATE TABLE subjects (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  name       TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE school_subjects (
  school_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  PRIMARY KEY (school_id, subject_id)
);

CREATE TABLE teacher_assignments (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id  UUID NOT NULL REFERENCES schools(id) ON DELETE CASCADE,
  class_id   UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  subject_id UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  UNIQUE (teacher_id, class_id, subject_id)
);

CREATE INDEX idx_ta_teacher ON teacher_assignments(teacher_id);
CREATE INDEX idx_ta_class   ON teacher_assignments(class_id);

-- =============================================================
-- 4. O'QUVCHI PROFILLARI
-- =============================================================

CREATE TABLE student_profiles (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  school_id        UUID NOT NULL REFERENCES schools(id),
  class_id         UUID NOT NULL REFERENCES classes(id),
  difficulty_level difficulty_level NOT NULL DEFAULT 'low',
  level_progress_score SMALLINT NOT NULL DEFAULT 3 CHECK (level_progress_score BETWEEN 0 AND 6),
  is_disabled      BOOLEAN NOT NULL DEFAULT FALSE,
  approved_by      UUID REFERENCES users(id) ON DELETE SET NULL,
  approved_at      TIMESTAMPTZ,
  rejection_reason TEXT
);

CREATE INDEX idx_sp_class  ON student_profiles(class_id);
CREATE INDEX idx_sp_school ON student_profiles(school_id);

-- =============================================================
-- 5. OTA-ONA PROFILLARI (YANGI)
-- =============================================================

CREATE TABLE parent_students (
  parent_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (parent_id, student_id)
);

CREATE INDEX idx_ps_parent  ON parent_students(parent_id);
CREATE INDEX idx_ps_student ON parent_students(student_id);

-- =============================================================
-- 6. ACCESSIBILITY PROFILLARI
-- =============================================================

CREATE TABLE accessibility_profiles (
  user_id              UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  vision_mode          BOOLEAN NOT NULL DEFAULT FALSE,
  hearing_mode         BOOLEAN NOT NULL DEFAULT FALSE,
  motor_mode           BOOLEAN NOT NULL DEFAULT FALSE,
  tts_source           tts_source_type NOT NULL DEFAULT 'web_speech',
  font_size            font_size_type  NOT NULL DEFAULT 'medium',
  contrast_mode        contrast_mode   NOT NULL DEFAULT 'normal',
  color_blind_mode     color_blind_mode NOT NULL DEFAULT 'normal',
  reduce_motion        BOOLEAN NOT NULL DEFAULT FALSE,
  subtitles_always     BOOLEAN NOT NULL DEFAULT FALSE,
  screening_completed  BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =============================================================
-- 7. MA'RUZALAR
-- =============================================================

CREATE TABLE lectures (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  creator_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  school_id    UUID REFERENCES schools(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id     UUID REFERENCES classes(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  content_type content_type NOT NULL,
  file_url     TEXT NOT NULL,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_lectures_creator ON lectures(creator_id);
CREATE INDEX idx_lectures_subject ON lectures(subject_id);
CREATE INDEX idx_lectures_class   ON lectures(class_id);

CREATE TABLE lecture_subtitles (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  lecture_id UUID NOT NULL REFERENCES lectures(id) ON DELETE CASCADE,
  vtt_url    TEXT NOT NULL,
  language   TEXT NOT NULL DEFAULT 'uz',
  source     subtitle_source NOT NULL DEFAULT 'manual'
);

-- =============================================================
-- 8. VAZIFALAR
-- =============================================================

CREATE TABLE assignments (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subject_id  UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id    UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  title       TEXT NOT NULL,
  description TEXT,
  file_url    TEXT,
  deadline    TIMESTAMPTZ,
  max_score   SMALLINT NOT NULL DEFAULT 100 CHECK (max_score > 0),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_assignments_class ON assignments(class_id);

CREATE TABLE assignment_submissions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  assignment_id UUID NOT NULL REFERENCES assignments(id) ON DELETE CASCADE,
  student_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content       TEXT,
  file_url      TEXT,
  submitted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  progress_state TEXT,
  teacher_reviewed_at TIMESTAMPTZ,
  teacher_reviewed_by UUID REFERENCES users(id) ON DELETE SET NULL,
  score         SMALLINT CHECK (score >= 0),
  teacher_comment TEXT,
  UNIQUE (assignment_id, student_id)
);

-- =============================================================
-- 9. TESTLAR
-- =============================================================

CREATE TABLE tests (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id   UUID REFERENCES users(id) ON DELETE CASCADE,
  subject_id   UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  time_limit   SMALLINT CHECK (time_limit > 0),
  test_type    test_type NOT NULL DEFAULT 'home_study',
  max_attempts SMALLINT CHECK (max_attempts > 0),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tests_teacher ON tests(teacher_id);
CREATE INDEX idx_tests_subject ON tests(subject_id);

CREATE TABLE test_classes (
  test_id  UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (test_id, class_id)
);

CREATE TABLE questions (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  test_id       UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  question_text TEXT NOT NULL,
  question_type question_type NOT NULL,
  image_url     TEXT,
  image_alt     TEXT,
  points        SMALLINT NOT NULL DEFAULT 1 CHECK (points > 0),
  sort_order    SMALLINT NOT NULL DEFAULT 0
);

CREATE INDEX idx_questions_test ON questions(test_id);

CREATE TABLE question_options (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  question_id UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  option_text TEXT NOT NULL,
  is_correct  BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_options_question ON question_options(question_id);

CREATE TABLE test_attempts (
  id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  test_id     UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  started_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ,
  score       NUMERIC(5,2) CHECK (score BETWEEN 0 AND 100)
);

CREATE INDEX idx_attempts_student ON test_attempts(student_id);
CREATE INDEX idx_attempts_test    ON test_attempts(test_id);

CREATE TABLE test_answers (
  id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  attempt_id          UUID NOT NULL REFERENCES test_attempts(id) ON DELETE CASCADE,
  question_id         UUID NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  answer_text         TEXT,
  selected_option_ids UUID[],
  is_correct          BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX idx_answers_attempt ON test_answers(attempt_id);

-- =============================================================
-- 10. O'YINLAR
-- =============================================================

CREATE TABLE games (
  id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  teacher_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template_type game_template NOT NULL,
  subject_id    UUID NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
  class_id      UUID REFERENCES classes(id) ON DELETE CASCADE,
  title         TEXT NOT NULL,
  external_url  TEXT,
  content_json  JSONB NOT NULL DEFAULT '{}',
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE game_classes (
  game_id  UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (game_id, class_id)
);

CREATE TABLE test_games (
  test_id UUID NOT NULL REFERENCES tests(id) ON DELETE CASCADE,
  game_id UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  PRIMARY KEY (test_id, game_id)
);

CREATE INDEX idx_test_games_test ON test_games(test_id);
CREATE INDEX idx_test_games_game ON test_games(game_id);

CREATE TABLE game_attempts (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  student_id   UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game_id      UUID NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  score        NUMERIC(5,2) NOT NULL DEFAULT 0,
  duration     INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_game_attempts_student ON game_attempts(student_id);
CREATE INDEX idx_game_attempts_game    ON game_attempts(game_id);

-- =============================================================
-- 11. KITOBLAR
-- =============================================================

CREATE TABLE books (
  id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  uploader_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title        TEXT NOT NULL,
  description  TEXT,
  pdf_url      TEXT NOT NULL,
  audio_url    TEXT,
  audio_source audio_source,
  ocr_required BOOLEAN NOT NULL DEFAULT FALSE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE book_classes (
  book_id  UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  class_id UUID NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
  PRIMARY KEY (book_id, class_id)
);

CREATE TABLE book_bookmarks (
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  book_id         UUID NOT NULL REFERENCES books(id) ON DELETE CASCADE,
  page            INTEGER NOT NULL DEFAULT 1 CHECK (page > 0),
  audio_timestamp NUMERIC(10,2),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, book_id)
);

-- =============================================================
-- 12. CHAT (YANGI — ota-ona ↔ o'qituvchi)
-- =============================================================

CREATE TABLE chat_rooms (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  parent_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  teacher_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  student_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (parent_id, teacher_id, student_id)
);

CREATE INDEX idx_chat_rooms_parent  ON chat_rooms(parent_id);
CREATE INDEX idx_chat_rooms_teacher ON chat_rooms(teacher_id);

CREATE TABLE chat_messages (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  room_id    UUID NOT NULL REFERENCES chat_rooms(id) ON DELETE CASCADE,
  sender_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT NOT NULL CHECK (length(trim(content)) > 0),
  read_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_chat_messages_room   ON chat_messages(room_id);
CREATE INDEX idx_chat_messages_sender ON chat_messages(sender_id);

-- =============================================================
-- 13. BILDIRISHNOMALAR
-- =============================================================

CREATE TABLE notifications (
  id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  message    TEXT NOT NULL,
  link       TEXT,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_notifications_user ON notifications(user_id);
CREATE INDEX idx_notifications_read ON notifications(user_id, read);
