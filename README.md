# Git Commit Tracker — bản tách Backend / Frontend

Cùng 1 sản phẩm như trước, nhưng backend và frontend giờ là 2 thư mục độc lập,
chạy 2 server riêng và nói chuyện với nhau qua HTTP (có bật CORS).

```
git-commit-tracker-split/
├── backend/         # Node.js/Express + API + webhook + tự động gắn webhook GitHub
│   ├── server.js
│   ├── db.js
│   ├── github.js
│   ├── env.js
│   ├── .env.example
│   └── package.json
└── frontend/        # HTML/CSS/JS thuần, chỉ gọi API sang backend
    ├── index.html
    ├── app.js
    └── style.css
```

## 1. Chạy Backend

```bash
cd backend
npm install
cp .env.example .env
# Mo .env, dien WEBHOOK_BASE_URL va GITHUB_TOKEN nhu truoc
npm start
```
Backend chạy ở `http://localhost:3000` — chỉ trả JSON, không có giao diện.

## 2. Chạy Frontend

Frontend là file tĩnh thuần, chỉ cần 1 static server bất kỳ. Cách đơn giản
nhất — dùng extension **Live Server** trong VS Code:

1. Mở thư mục `frontend/` trong VS Code.
2. Chuột phải vào `index.html` → **Open with Live Server**.
3. Trình duyệt tự mở, thường ở `http://127.0.0.1:5500`.

Hoặc dùng dòng lệnh (không cần cài gì nếu máy có Node):
```bash
cd frontend
npx serve .
```

## 3. Nếu backend không chạy ở cổng 3000

Mở `frontend/app.js`, sửa dòng đầu file:
```js
const API_BASE = "http://localhost:3000"; // doi thanh cong/domain thuc te
```

## Có gì khác so với bản gộp chung trước đó?

- Backend không còn dòng `express.static(...)` — không phục vụ HTML/CSS/JS nữa,
  chỉ còn thuần API (`/api/...`, `/webhooks/git`).
- Backend có thêm `cors()` để cho phép frontend (chạy ở domain/cổng khác) gọi
  API sang được — nếu không có dòng này, trình duyệt sẽ tự chặn request.
- `.env`, `GITHUB_TOKEN`, `WEBHOOK_BASE_URL` copy y nguyên từ bản cũ, dán vào
  `backend/.env` — không cần lấy token mới hay URL tunnel mới.
- Webhook GitHub vẫn trỏ vào backend (cổng 3000) như trước, không đổi gì.

## Khi nào nên tách thế này?

Hữu ích khi deploy backend/frontend lên 2 nơi khác nhau, có 2 team phụ trách
riêng, hoặc muốn scale backend độc lập. Với quy mô demo, gộp chung 1 server
như bản trước vẫn đơn giản hơn — đây chỉ là bản tách theo yêu cầu.

## Đã sửa: xóa dự án giờ dọn sạch, không để lại rác

Trước đây xóa dự án trên web chỉ xóa dòng project, để lại 2 vấn đề:
1. Webhook trên GitHub vẫn còn — thêm lại dự án cùng URL sẽ báo lỗi 422
   ("webhook đã tồn tại").
2. Các commit thuộc dự án đó vẫn còn trong `db.json`, hiện "(không rõ)".

Giờ xóa 1 dự án sẽ **tự động**:
- Gọi GitHub API xóa webhook tương ứng (nếu dự án đó được tạo bằng tính năng
  tự động gắn webhook và còn `GITHUB_TOKEN` hợp lệ trong `.env`).
- Xóa toàn bộ commit thuộc dự án đó khỏi database.

→ Xóa xong, thêm lại cùng repo sẽ tạo webhook mới sạch sẽ, không còn lỗi 422.
