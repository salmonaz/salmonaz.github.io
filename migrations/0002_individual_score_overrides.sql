-- Chạy một lần CHỈ với database đã được tạo từ phiên bản cũ.
-- Không chạy file này nếu vừa tạo database mới bằng schema.sql mới.

ALTER TABLE students ADD COLUMN school_name TEXT;

UPDATE students
SET school_name = full_name
WHERE school_name IS NULL OR TRIM(school_name) = '';

CREATE TABLE IF NOT EXISTS student_score_overrides (
  student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  final_score REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_student_score_overrides_student
ON student_score_overrides(student_id);
