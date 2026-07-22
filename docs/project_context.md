# Git Tracking Dashboard - Context

Ứng dụng là dashboard nội bộ để PM/Scrum Master theo dõi tiến độ task theo Project, Member và Sprint.

OpenProject là source of truth. Dashboard chỉ đọc dữ liệu từ OpenProject API, không tự tạo project/user/task, không lưu commit history riêng, không suy luận progress từ GitHub commit.

Frontend vẫn dùng thuật ngữ Sprint cho đúng Agile/Scrum, nhưng backend lấy dữ liệu từ OpenProject Version. Với OpenProject API mới, versions có thể nằm ở `/api/v3/workspaces/{id}/versions`; endpoint cũ `/api/v3/projects/{id}/versions` đã deprecated.

GitHub activity được quản lý bởi OpenProject GitHub integration. Dev cần reference Work Package trong branch/PR/commit theo format `OP#<workPackageId>` để OpenProject tự liên kết activity.