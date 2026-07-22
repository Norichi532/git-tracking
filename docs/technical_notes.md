# Technical Notes

Backend:
- Node.js + Express.
- File chính:
  - `backend/server.js`
  - `backend/openproject.js`
  - `backend/env.js`

Frontend:
- HTML/CSS/JS thuần.
- File chính:
  - `frontend/index.html`
  - `frontend/app.js`
  - `frontend/style.css`
  - `frontend/settings.html`
  - `frontend/settings.js`

API nội bộ:
- `GET /api/openproject/projects`
- `GET /api/openproject/projects/:id/members`
- `GET /api/openproject/projects/:id/sprints`
- `GET /api/progress?openProjectId=&openProjectUserId=&sprintId=&businessHours=`

Lưu ý:
- Endpoint `/sprints` của app thực chất trả OpenProject Versions.
- Backend nên hỗ trợ cả `/api/v3/workspaces/{id}/versions` và `/api/v3/projects/{id}/versions`.
- Không thêm lại GitHub webhook/local DB nếu không có yêu cầu rõ ràng.