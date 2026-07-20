# Git Tracking Dashboard

Git Tracking Dashboard là công cụ nội bộ giúp team theo dõi tiến độ công việc dựa trên dữ liệu từ OpenProject và commit GitHub. Ứng dụng kết nối ba nguồn thông tin chính:

- OpenProject: danh sách dự án, thành viên, version dùng như sprint, và work package/task.
- GitHub: webhook push commit từ repository.
- Local database: lưu project đã kết nối, user mapping và commit nhận được.

Mục tiêu của sản phẩm là giúp PM, Scrum Master và team dev nhìn nhanh một thành viên đang xử lý task nào trong sprint, tiến độ đến đâu, và commit nào đang liên quan đến task đó.

## Tổng quan tính năng

### 1. Quản lý dự án từ OpenProject

Người dùng không nhập tên dự án thủ công. Frontend gọi backend để lấy danh sách project từ OpenProject, sau đó chọn project từ dropdown.

Khi thêm project vào hệ thống, người dùng cần nhập thêm GitHub repository URL. Backend lưu:

- `openProjectId`
- tên project lấy từ OpenProject
- `repoUrl`
- `webhookId` nếu tự động tạo webhook GitHub thành công

### 2. Tự động gắn webhook GitHub

Khi thêm project, backend có thể tự động tạo webhook trên GitHub repository nếu đã cấu hình đủ:

- `GITHUB_TOKEN`
- `WEBHOOK_BASE_URL`

Webhook GitHub sẽ gửi push event về:

```txt
POST /webhooks/git
```

Backend nhận commit, tìm project theo repository URL và lưu commit vào local database.

### 3. Quản lý người dùng từ OpenProject

Người dùng được chọn từ danh sách thành viên của project trong OpenProject.

Luồng thao tác:

1. Chọn project OpenProject.
2. Frontend tải danh sách thành viên của project.
3. Chọn thành viên.
4. Hệ thống tự điền email nếu OpenProject trả về email.
5. Người dùng có thể nhập hoặc chỉnh Git email để map commit chính xác.

Mỗi user có thể có nhiều Git email để xử lý trường hợp một dev commit bằng nhiều email khác nhau.

### 4. Nhận và map commit

Khi GitHub gửi webhook push:

- Backend đọc danh sách commit.
- Chuẩn hóa repository URL để tìm project tương ứng.
- Tìm user theo email author trong commit.
- Lưu commit kèm `projectId`, `authorId`, message, URL, ngày commit và SHA.

Nếu commit chưa map được với user, commit vẫn được lưu nhưng sẽ được xem là chưa map. Khi thêm user sau này, backend tự map lại các commit cũ có email trùng.

### 5. Dashboard tiến độ sprint

Dashboard bên phải hiển thị tiến độ theo luồng Agile/Scrum:

```txt
Chọn dự án -> Chọn thành viên -> Chọn sprint -> Xem board task
```

Lưu ý: frontend vẫn gọi là `sprint` để phù hợp ngôn ngữ Agile/Scrum, nhưng backend đang lấy dữ liệu từ **OpenProject Version** vì instance OpenProject hiện quản lý sprint bằng version.

Board hiển thị các task của thành viên trong version/sprint đã chọn:

- mã task
- tên task
- loại task
- trạng thái OpenProject
- phần trăm tiến độ
- số commit liên kết
- commit mới nhất
- danh sách commit gần nhất theo task

Backend lọc task bằng:

- project OpenProject
- assignee OpenProject
- version OpenProject

Sau đó backend ghép thêm commit local dựa trên mã task xuất hiện trong commit message.

## Quy tắc đặt tên commit

Để dashboard có thể theo dõi tiến độ task, commit message cần chứa mã work package của OpenProject.

### Format chuẩn

```txt
OP#<taskId> <state>: <nội dung commit>
```

Hoặc:

```txt
WP#<taskId> <state>: <nội dung commit>
```

Trong đó:

- `taskId`: ID của work package/task trên OpenProject.
- `state`: trạng thái tiến độ mà commit muốn báo.
- nội dung commit: mô tả ngắn gọn thay đổi đã làm.

### Các state hỗ trợ

| State | Ý nghĩa | Tiến độ suy luận nếu OpenProject chưa có % |
| --- | --- | --- |
| `start` | Bắt đầu làm task | 20% |
| `progress` | Đang triển khai | 50% |
| `review` | Đã làm xong, chờ review/test | 80% |
| `fix` | Sửa lỗi hoặc chỉnh theo feedback | 50% |
| `block` | Đang bị chặn | 35% |
| `blocked` | Tương đương `block` | 35% |
| `done` | Hoàn thành | 100% |

Nếu OpenProject có `percentageDone`, dashboard ưu tiên dùng giá trị đó. Nếu không có, dashboard suy luận tiến độ theo commit state mới nhất.

### Ví dụ commit đúng chuẩn

```txt
OP#12 start: setup GitHub webhook handler
OP#12 progress: parse push payload and save commits
OP#12 review: complete progress board UI
OP#12 fix: handle empty OpenProject member list
OP#12 done: finish sprint dashboard integration
OP#15 block: waiting for OpenProject API permission
```

### Quy tắc đề xuất cho team

- Mỗi commit liên quan đến task phải có `OP#<taskId>` hoặc `WP#<taskId>`.
- Một commit chỉ nên đại diện cho một ý nghĩa công việc rõ ràng.
- Không dùng message chung chung như `update`, `fix bug`, `done`.
- Nếu commit xử lý nhiều task, nên tách commit. Nếu bắt buộc, có thể ghi nhiều mã task, ví dụ:

```txt
OP#12 OP#13 fix: align validation between project and member dropdown
```

- Khi hoàn thành task, cần có ít nhất một commit `done` hoặc cập nhật `% done`/status trong OpenProject.

## Kiến trúc thư mục

```txt
git-tracking/
├── backend/
│   ├── server.js        # Express API, webhook handler, progress API
│   ├── openproject.js   # OpenProject API client
│   ├── github.js        # GitHub webhook API client
│   ├── db.js            # File-based JSON database helper
│   ├── env.js           # Minimal .env loader
│   ├── db.json          # Local database
│   └── package.json
└── frontend/
    ├── index.html
    ├── app.js
    └── style.css
```

## Cấu hình môi trường

Tạo file:

```txt
backend/.env
```

Nội dung:

```env
PORT=3000

WEBHOOK_BASE_URL=
GITHUB_TOKEN=

OPENPROJECT_BASE_URL=
OPENPROJECT_API_KEY=
```

Ý nghĩa:

- `PORT`: port backend, mặc định `3000`.
- `WEBHOOK_BASE_URL`: public URL của backend, ví dụ URL ngrok hoặc domain deploy.
- `GITHUB_TOKEN`: GitHub token có quyền tạo/xóa webhook repository.
- `OPENPROJECT_BASE_URL`: URL OpenProject, ví dụ `https://openproject.example.com`.
- `OPENPROJECT_API_KEY`: API key lấy từ tài khoản OpenProject.

## Chạy dự án

### Backend

```bash
cd backend
npm install
npm start
```

Backend chạy tại:

```txt
http://localhost:3000
```

### Frontend

Frontend là HTML/CSS/JS thuần. Có thể chạy bằng Live Server trong VS Code hoặc static server bất kỳ.

Ví dụ:

```bash
cd frontend
npx serve .
```

Nếu backend không chạy ở `localhost:3000`, sửa trong `frontend/app.js`:

```js
const API_BASE = "http://localhost:3000";
```

## API chính

### OpenProject adapter

```txt
GET /api/openproject/projects
GET /api/openproject/projects/:id/members
GET /api/openproject/projects/:id/sprints
```

Ghi chú: endpoint `sprints` đang trả về OpenProject Versions để frontend vẫn dùng thuật ngữ Sprint.

### Project

```txt
GET    /api/projects
POST   /api/projects
DELETE /api/projects/:id
```

### User

```txt
GET    /api/users
POST   /api/users
DELETE /api/users/:id
```

### Commit và progress

```txt
GET  /api/commits
GET  /api/progress?openProjectId=&openProjectUserId=&sprintId=
POST /webhooks/git
```

## Luồng sử dụng đề xuất

1. PM tạo project, version/sprint, task và assignee trong OpenProject.
2. Dev hoặc PM thêm project vào Git Tracking Dashboard bằng OpenProject project + GitHub repo URL.
3. Hệ thống tự tạo webhook GitHub nếu đủ cấu hình.
4. PM thêm user bằng danh sách member từ OpenProject và kiểm tra Git email.
5. Dev commit theo quy tắc `OP#<taskId> <state>: <message>`.
6. GitHub webhook gửi commit về backend.
7. Dashboard hiển thị tiến độ task theo project, member và sprint.

## Giới hạn hiện tại

- Database đang là file JSON, phù hợp demo hoặc nội bộ nhỏ, chưa phù hợp production lớn.
- Progress từ commit là suy luận dựa trên convention, không thay thế hoàn toàn trạng thái chính thức trong OpenProject.
- Dashboard phụ thuộc vào việc team đặt commit message đúng quy tắc.
- Frontend hiện là HTML/CSS/JS thuần, chưa có authentication.

## Định hướng nâng cấp

- Thêm authentication cho dashboard.
- Chuyển database từ JSON sang PostgreSQL.
- Đồng bộ trạng thái task ngược lại OpenProject khi commit `done`.
- Thêm báo cáo theo sprint/team/member.
- Thêm kiểm tra commit convention trong CI hoặc Git hook.
