-- Chạy một lần CHỈ với database đã được tạo từ phiên bản cũ.
-- Website cũng tự tạo bảng này khi mở sơ đồ chỗ ngồi, nên không bắt buộc
-- phải chạy tay nếu backend đang hoạt động bình thường.

CREATE TABLE IF NOT EXISTS seating_group_layout (
  seat_month TEXT NOT NULL,
  position_no INTEGER NOT NULL CHECK (position_no BETWEEN 1 AND 4),
  group_no INTEGER NOT NULL CHECK (group_no BETWEEN 1 AND 4),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (seat_month, position_no),
  UNIQUE (seat_month, group_no)
);

CREATE INDEX IF NOT EXISTS idx_seating_group_layout_month
ON seating_group_layout(seat_month);
