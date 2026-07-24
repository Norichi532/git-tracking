# Business Logic

Dashboard dùng để phân tích tiến độ và effort, không dùng để giám sát nhân viên theo kiểu đếm từng commit.

Nguồn dữ liệu:
- Project, member, version/sprint, work package: OpenProject API
- Status history: OpenProject Work Package activities
- Logged work: OpenProject time entries
- GitHub activity: OpenProject GitHub integration

Các chỉ số chính:
- Progress: lấy từ `percentageDone` hoặc `derivedPercentageDone`; nếu không có thì status done/closed = 100%, còn lại = 0%.
- Implementation time: thời gian từ lần đầu task vào `In progress` đến lần đầu task vào `Ready For Testing` hoặc `Developed`.
- Blocked time: tổng thời gian task nằm trong status blocked.
- Logged work: tổng time entries đã log trên Work Package.
- Unaccounted time: `max(0, Implementation time - Logged work - Blocked time)`.

Unaccounted time không có nghĩa là nhân viên không làm việc. Đây là tín hiệu để PM trao đổi thêm về họp, chờ review, context switching, research, quên log time hoặc status chưa được cập nhật đúng.
