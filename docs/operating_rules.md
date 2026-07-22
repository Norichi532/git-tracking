# Operating Rules

Để dashboard có số liệu tốt, team cần vận hành OpenProject nhất quán:

1. PM tạo Project, Version/Sprint và Work Package trong OpenProject.
2. Work Package phải có assignee.
3. Work Package phải được gắn vào đúng Version/Sprint.
4. Dev chuyển status đúng thời điểm:
   - Khi bắt đầu làm: `In progress`
   - Khi hoàn tất phần dev: `Developed`
   - Khi bị chặn: status có chứa `Blocked`
5. Dev log work vào Work Package trong OpenProject.
6. Branch/PR/commit phải reference Work Package, ví dụ:
   - `OP#123: implement progress board`
   - `op-123-progress-board`
7. GitHub integration của OpenProject phải được cấu hình đúng.

Dashboard chỉ phân tích dữ liệu đã được OpenProject ghi nhận. Nếu quá khứ không có status history hoặc logged work, dashboard không thể tự khôi phục chính xác.