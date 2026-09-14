# digiLQD — Thi đua 11 Tin

Dashboard tĩnh cho **lớp 11 Tin**, giữ phong cách glassmorphism/Bootstrap nhưng không chứa dữ liệu minh họa. Khi nguồn chưa có dữ liệu, giao diện hiển thị trạng thái trống thay vì thay bằng số liệu giả.

## Chạy local

Mở `index.html` bằng một web server tĩnh (ví dụ Live Server trong VS Code). Không có bước cài đặt hay backend bắt buộc.

## Nguồn dữ liệu thật

Nguồn đối chiếu: [dashboard digiLQD](https://www.dtnlqd.vn/dashboard.html), mã nguồn công khai `js/firebase-init.js` và `js/thidua.js` của website.

`script.js` dùng Firestore REST API công khai đúng như dashboard đang dùng:

- Project: `doanthptchuyenlequydon`
- Cấu hình năm học: `site/thidua`
- Danh sách lớp: `thidua_lops`
- Tổng hợp điểm: `thidua_tonghop/{nienHoc}`
- Nhật ký lớp: truy vấn `thidua_ghi` theo `lopId`
- ID đã xác minh của **11 Tin**: `MM2KGZwgLGLHDvod10ZW`

Năm học được đọc động từ `site/thidua`; không cần sửa code khi digiLQD đổi năm học. API endpoint, khóa web công khai và ID lớp tập trung tại `API_CONFIG` trong `script.js` để dễ kiểm tra hoặc cập nhật.

Tại lần xác minh ngày 14/09/2026, cấu hình nguồn là năm học **2026–2027**. 11 Tin chưa phát sinh lượt cộng/trừ điểm, nên tổng điểm là 0 và lớp được xếp hạng cùng các lớp có 0 điểm; đây không phải tình trạng thiếu dữ liệu.

## CORS và cache

Firestore REST API của nguồn được gọi trực tiếp từ trình duyệt. Có cache `localStorage` tối đa 5 phút để giảm request; nút **Thử lại** luôn bỏ cache và tải mới. Nếu môi trường triển khai chặn CORS, hãy đặt proxy chỉ đọc ở phía server rồi thay `API_CONFIG.base` bằng URL proxy đó; không thêm token đặc quyền vào frontend.


## Kiểm tra giao diện

CSS hỗ trợ desktop (≥992px), tablet (768–991px), mobile (≤767px), dark/light mode lưu bằng `localStorage`, loading/error/empty state và `prefers-reduced-motion`.
