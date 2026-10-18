CREATE TABLE IF NOT EXISTS students (
  id TEXT PRIMARY KEY,
  full_name TEXT NOT NULL,
  school_name TEXT,
  group_no INTEGER CHECK (group_no BETWEEN 1 AND 4),
  photo_key TEXT,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seating (
  seat_month TEXT NOT NULL,
  seat_id TEXT NOT NULL,
  student_id TEXT NOT NULL REFERENCES students(id),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (seat_month, seat_id),
  UNIQUE (seat_month, student_id)
);

CREATE TABLE IF NOT EXISTS score_events (
  id TEXT PRIMARY KEY,
  student_id TEXT NOT NULL REFERENCES students(id),
  delta REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS student_score_overrides (
  student_id TEXT PRIMARY KEY REFERENCES students(id) ON DELETE CASCADE,
  final_score REAL NOT NULL,
  reason TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_seating_month ON seating(seat_month);
CREATE INDEX IF NOT EXISTS idx_score_events_student ON score_events(student_id);
CREATE INDEX IF NOT EXISTS idx_student_score_overrides_student ON student_score_overrides(student_id);

INSERT OR IGNORE INTO students (id, full_name, created_at) VALUES
  ('hs-01', 'Bùi Việt Anh', datetime('now')),
  ('hs-02', 'Phan Tùng Anh', datetime('now')),
  ('hs-03', 'Lưu Gia Bảo', datetime('now')),
  ('hs-04', 'Thái Quốc Bảo', datetime('now')),
  ('hs-05', 'Nguyễn Quốc Bình', datetime('now')),
  ('hs-06', 'Đinh Tiến Dũng', datetime('now')),
  ('hs-07', 'Trần Lê Dũng', datetime('now')),
  ('hs-08', 'Lê Đoàn Tấn Đạt', datetime('now')),
  ('hs-09', 'Bùi Thế Minh Đức', datetime('now')),
  ('hs-10', 'Đặng Anh Đức', datetime('now')),
  ('hs-11', 'Lê Đăng Hiếu', datetime('now')),
  ('hs-12', 'Điêu Gia Huy', datetime('now')),
  ('hs-13', 'Nguyễn Chơn Huy', datetime('now')),
  ('hs-14', 'Võ Minh Huy', datetime('now')),
  ('hs-15', 'Nguyễn Lê Hưng', datetime('now')),
  ('hs-16', 'Lê Tiến Khánh', datetime('now')),
  ('hs-17', 'Phạm Đăng Khoa', datetime('now')),
  ('hs-18', 'Đậu Hoàng Khương', datetime('now')),
  ('hs-19', 'Nguyễn Phan Gia Linh', datetime('now')),
  ('hs-20', 'Phạm Khánh Linh', datetime('now')),
  ('hs-21', 'Trần Tùng Lĩnh', datetime('now')),
  ('hs-22', 'Đào Nguyễn Kiến Lương', datetime('now')),
  ('hs-23', 'Nguyễn Hồng Minh', datetime('now')),
  ('hs-24', 'Trịnh Hoàng Minh', datetime('now')),
  ('hs-25', 'Trần Khánh Nam', datetime('now')),
  ('hs-26', 'Nguyễn Lê Thảo Nguyên', datetime('now')),
  ('hs-27', 'Lê Tuấn Nguyễn', datetime('now')),
  ('hs-28', 'Nguyễn Đức Nhân', datetime('now')),
  ('hs-29', 'Đinh Hồng Quân', datetime('now')),
  ('hs-30', 'Nguyễn Hồng Sang', datetime('now')),
  ('hs-31', 'Đồng Đại Tiến', datetime('now')),
  ('hs-32', 'Phan Minh Toàn', datetime('now')),
  ('hs-33', 'Nguyễn Minh Trí', datetime('now')),
  ('hs-34', 'Đỗ Thanh Tùng', datetime('now')),
  ('hs-35', 'Tăng Nguyễn Minh Vân', datetime('now')),
  ('hs-36', 'Bùi Vũ Thảo Vy', datetime('now'));

UPDATE students
SET school_name = full_name
WHERE school_name IS NULL OR TRIM(school_name) = '';
