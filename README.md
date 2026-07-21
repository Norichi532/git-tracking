# Git Tracking Dashboard

Git Tracking Dashboard là dashboard nội bộ dùng để theo dõi tiến độ task theo dự án, thành viên và sprint. Ứng dụng này được thiết kế theo hướng **OpenProject là nguồn dữ liệu chính**.

GitHub history không còn được thu thập trực tiếp bởi ứng dụng này. Thay vào đó, team sử dụng **OpenProject GitHub integration** để liên kết branch, pull request và commit với Work Package trong OpenProject.

## Mục tiêu sản phẩm

Dashboard giúp PM, Scrum Master và team dev trả lời nhanh các câu hỏi:

- Trong sprint này, một thành viên đang được giao task nào?
- Task đang ở trạng thái nào?
- Tiến độ trung bình của thành viên trong sprint là bao nhiêu?
- Task nào đã hoàn thành, task nào đang làm, task nào chưa bắt đầu?
- GitHub activity liên quan đến task nằm ở đâu trong OpenProject?

## Nguyên tắc business

### 1. OpenProject là source of truth

Ứng dụng chỉ đọc dữ liệu từ OpenProject:

- Project
- Member
- Version, được hiển thị trên frontend như Sprint
- Work Package
- Assignee
- Status
- Percentage done
- Link GitHub activity trong Work Package

Ứng dụng không tự tạo project, user, webhook GitHub hoặc commit history riêng.

### 2. GitHub được quản lý bởi OpenProject integration

GitHub repository cần được tích hợp với OpenProject bằng GitHub integration chính thức của OpenProject.

Khi dev tạo branch, pull request hoặc commit, GitHub activity phải reference đúng Work Package để OpenProject tự liên kết activity đó vào task.

PM xem GitHub activity chính thức trong tab GitHub của từng Work Package trên OpenProject.

### 3. Email GitHub và OpenProject phải trùng nhau

Team thống nhất mỗi nhân viên dùng cùng email cho:

- OpenProject account
- GitHub account
- Git local config

Ví dụ:

```bash
git config user.name "Binh Nguyen"
git config user.email "binh@company.com"
```

Việc chuẩn hóa email giúp GitHub/OpenProject nhận diện activity nhất quán theo nhân sự, không cần mapping thủ công trong dashboard.

## Tính năng hiện tại

### Dashboard tiến độ sprint

Luồng sử dụng chính:

```txt
Chọn dự án -> Chọn thành viên -> Chọn sprint -> Xem board task
```

Lưu ý: frontend dùng thuật ngữ **Sprint** cho đúng Agile/Scrum, còn backend lấy dữ liệu từ **OpenProject Version**, vì OpenProject instance hiện quản lý sprint bằng Version.

Mỗi task hiển thị:

- Work Package ID
- Tên task
- Type
- Status
- Priority
- Percentage done
- Thời điểm cập nhật gần nhất
- Dev time từ `In progress` đến `Developed`
- Logged work từ time entries của OpenProject
- Phần thời gian chưa phân bổ
- Blocked time
- Last GitHub activity từ OpenProject GitHub integration
- Cảnh báo dữ liệu hoặc cảnh báo vận hành nếu có

### Tổng quan tiến độ

Dashboard tính các chỉ số:

- Tổng số task
- Tiến độ trung bình
- Số task hoàn thành
- Số task đang làm
- Dev time trung bình cho các task đã đi tới `Developed`
- Tổng logged work
- Tổng thời gian chưa phân bổ
- Blocked time tổng
- Tổng số cảnh báo

Progress được tính từ OpenProject:

1. Ưu tiên `percentageDone` hoặc `derivedPercentageDone`.
2. Nếu không có %, task có status đóng/hoàn thành được tính là 100%.
3. Các task còn lại được tính là 0%.

### Cách tính thời gian đi qua pipeline

Dashboard tính thời gian dựa trên lịch sử thay đổi status của Work Package trong OpenProject. Mục tiêu không phải chứng minh nhân viên code đủ 8 tiếng/ngày, mà là đo task đi qua pipeline trong bao lâu và đối chiếu với logged work để ước lượng effort thực tế.

Các chỉ số:

- `Cycle time`: tính từ lần đầu task vào trạng thái đang làm/bị block đến lúc task đóng. Nếu task chưa đóng, tính đến thời điểm hiện tại.
- `Dev time`: tính từ lần đầu task vào `In progress` đến lần đầu task vào `Developed`.
- `Active time`: tổng thời gian task nằm trong trạng thái đang làm, review, testing hoặc development.
- `Blocked time`: tổng thời gian task nằm trong trạng thái blocked.
- `Logged work`: tổng thời gian nhân viên log vào Work Package qua OpenProject time entries.
- `Unaccounted time`: phần chênh lệch còn lại, tính theo công thức `max(0, Dev time - Logged work - Blocked time)`.

Nhóm status mặc định:

- Active: status có chứa `progress`, `review`, `test`, `qa`, `develop`, `implement`, `đang`.
- Blocked: status có chứa `block`, `blocked`, `chặn`.
- Done/terminal: status có chứa `closed`, `done`, `resolved`, `rejected`, `cancelled`, `canceled`, `đóng`, `hoàn thành`.
- Các status khác như `Specified`, `In specification`, `New`, `Backlog` được xem là chưa bắt đầu làm.

Ví dụ:

```txt
Specified -> In progress -> Blocked -> In progress -> Closed
```

Dashboard sẽ tính:

- `Cycle time`: từ lần đầu vào `In progress` đến lúc vào `Closed`.
- `Dev time`: từ lần đầu vào `In progress` đến lúc vào `Developed`, nếu task có mốc `Developed`.
- `Active time`: tổng hai khoảng `In progress`.
- `Blocked time`: khoảng nằm trong `Blocked`.
- `Logged work`: tổng time entries đã log trên Work Package đó.
- `Unaccounted time`: phần thời gian pipeline chưa được giải thích bởi logged work hoặc blocked time.

### Cảnh báo

Dashboard hiển thị cảnh báo ở cấp task để PM biết chỗ nào cần trao đổi thêm với team:

- Task đã vào `In progress` nhưng chưa tới `Developed`.
- Task đã bắt đầu dev nhưng chưa có logged work.
- Logged work thấp bất thường so với dev time.
- Thời gian chưa phân bổ từ 4 giờ làm việc trở lên.
- Blocked time từ 2 giờ làm việc trở lên.
- Task đang làm nhưng chưa có pull request liên kết trong OpenProject.
- Task chưa có assignee.

### Rule giờ làm việc

Dashboard có một trang cấu hình rule giờ làm việc:

```txt
frontend/settings.html
```

Rule được lưu trong `localStorage` của trình duyệt và được gửi lên backend khi gọi `/api/progress`.

Mặc định:

```txt
Giờ làm việc: 08:00 - 17:00
Nghỉ trưa: 12:00 - 13:00
Ngày làm việc: Thứ 2 - Thứ 6
Timezone offset: UTC+7, tương đương 420 phút
```

Có thể cấu hình:

- bật/tắt chế độ chỉ tính giờ làm việc
- giờ bắt đầu/kết thúc
- giờ nghỉ trưa
- ngày làm việc trong tuần
- timezone offset
- danh sách ngày nghỉ theo format `YYYY-MM-DD`

Nếu tắt chế độ chỉ tính giờ làm việc, dashboard sẽ tính theo calendar time 24/7.

## Quy tắc đặt tên branch, pull request và commit

Để OpenProject GitHub integration liên kết GitHub activity với Work Package, message hoặc PR description cần chứa mã Work Package.

### Format đề xuất

```txt
OP#<workPackageId>: <nội dung>
```

Ví dụ:

```txt
OP#123: implement sprint progress dashboard
OP#124: fix OpenProject member dropdown
OP#125: update task progress layout
```

### Branch name

Nên dùng Git snippets được OpenProject gợi ý trong tab GitHub của Work Package.

Nếu đặt thủ công, dùng format:

```txt
op-<workPackageId>-short-description
```

Ví dụ:

```txt
op-123-progress-dashboard
op-124-member-dropdown
```

### Pull request

Pull request nên reference Work Package trong title hoặc description:

```txt
OP#123: implement sprint progress dashboard
```

Khi PR được liên kết đúng, OpenProject sẽ hiển thị PR và trạng thái PR trong Work Package.

### Commit

Commit nên ngắn gọn, rõ hành động và có mã Work Package:

```txt
OP#123: add progress summary cards
OP#123: render assigned work packages
OP#124: handle empty member list
```

Không nên dùng commit chung chung:

```txt
update
fix bug
done
final
```

## Kiến trúc thư mục

```txt
git-tracking/
├── backend/
│   ├── server.js        # Express API cho dashboard
│   ├── openproject.js   # OpenProject API client
│   ├── env.js           # Minimal .env loader
│   └── package.json
└── frontend/
    ├── index.html
    ├── app.js
    ├── settings.html
    ├── settings.js
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

OPENPROJECT_BASE_URL=
OPENPROJECT_API_KEY=
```

Ý nghĩa:

- `PORT`: port backend, mặc định là `3000`.
- `OPENPROJECT_BASE_URL`: URL OpenProject, ví dụ `https://openproject.example.com`.
- `OPENPROJECT_API_KEY`: API key của user có quyền đọc project, member, version và work package.

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

```txt
GET /api/openproject/projects
GET /api/openproject/projects/:id/members
GET /api/openproject/projects/:id/sprints
GET /api/progress?openProjectId=&openProjectUserId=&sprintId=&businessHours=
```

Ghi chú: endpoint `/sprints` trả về OpenProject Versions để frontend giữ đúng thuật ngữ Scrum.

## Những phần đã loại bỏ

Các phần sau không còn cần thiết vì GitHub history được quản lý bởi OpenProject GitHub integration:

- Backend GitHub webhook endpoint riêng
- Tự động tạo/xóa webhook GitHub
- Local `db.json`
- Local project CRUD
- Local user CRUD
- Mapping nhiều Git email trong dashboard
- Suy luận progress từ commit message custom
- Tính effort thực tế bằng cách đếm toàn bộ commit của user

## Luồng vận hành đề xuất

1. PM tạo Project, Version/Sprint và Work Package trong OpenProject.
2. PM gán Assignee cho từng Work Package.
3. Admin cấu hình GitHub integration trong OpenProject.
4. Dev dùng cùng email cho GitHub, OpenProject và Git local config.
5. Dev tạo branch/PR/commit có reference `OP#<workPackageId>`.
6. OpenProject tự liên kết GitHub activity vào Work Package.
7. Dashboard đọc OpenProject để hiển thị tiến độ theo Project, Member và Sprint.

## Giới hạn hiện tại

- Dashboard chỉ đọc dữ liệu, không cập nhật ngược về OpenProject.
- Dashboard phụ thuộc vào dữ liệu Work Package và GitHub integration đã được cấu hình đúng trong OpenProject.
- Logged work chỉ phản ánh dữ liệu nhân viên log trong OpenProject, không tự động chứng minh toàn bộ thời gian code thực tế.
- Unaccounted time là tín hiệu để PM trao đổi thêm, không nên dùng như kết luận đánh giá hiệu suất độc lập.
- Nếu Work Package không có `percentageDone`, progress sẽ phụ thuộc vào status đóng/mở.
- Chưa có authentication riêng cho dashboard.
- Frontend hiện là HTML/CSS/JS thuần.

## Định hướng nâng cấp

- Thêm authentication cho dashboard.
- Thêm báo cáo theo sprint/team/member.
- Thêm benchmark theo loại task để so sánh estimate, logged work và dev time.
- Thêm kiểm tra convention branch/PR trong CI hoặc Git hook để đảm bảo OpenProject liên kết GitHub activity ổn định.
