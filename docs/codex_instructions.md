# Instructions For Future Codex Sessions

Khi làm việc với project này:

- Luôn giữ OpenProject là source of truth.
- Không thêm local database, GitHub webhook riêng, project CRUD, user CRUD hoặc mapping email thủ công nếu user chưa yêu cầu.
- Không suy luận effort từ số lượng commit.
- Frontend dùng chữ Sprint, backend dùng OpenProject Version.
- Khi thay đổi logic thời gian, phải nghĩ theo hướng BA/PM:
  - số liệu là tín hiệu để trao đổi
  - không dùng làm kết luận hiệu suất tuyệt đối
- Nếu API trả rỗng, kiểm tra dữ liệu OpenProject trước khi kết luận lỗi code.
- Trước khi thêm tính năng mới, hỏi user nếu tính năng đó làm thay đổi business workflow.