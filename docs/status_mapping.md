# Status Mapping Agreement

Dashboard giu nguyen status goc cua OpenProject khi hien thi, nhung map status do ve nhom chuan de tinh KPI. File cau hinh dang dung:

```txt
backend/status-mapping.json
```

## Nhom status chuan

| Nhom | Y nghia nghiep vu | Anh huong KPI |
| --- | --- | --- |
| `notStarted` | Task chua vao luong thuc hien | Khong tinh implementation time |
| `ready` | Task da san sang lam nhung chua bat dau | Khong tinh implementation time |
| `active` | Dang phat trien/thuc hien | Co the bat dau implementation time neu nam trong `devStart` |
| `review` | Dang review code/nghiep vu | Khong dung de tinh thoi gian chinh |
| `testing` | Dang test/QA | Co the ket thuc implementation time neu nam trong `devEnd` |
| `developed` | Dev da xong theo dinh nghia cua team | Ket thuc implementation time neu nam trong `devEnd` |
| `blocked` | Dang bi chan/cho xu ly | Tinh blocked time |
| `done` | Da hoan thanh | Duoc tinh 100% neu OpenProject khong co `% done` |
| `cancelled` | Huy/tu choi/khong lam nua | Khong tu dong tinh la hoan thanh |

## Quy tac can chot voi BA/PM/Tech Lead

1. `devStart`: status nao bat dau tinh implementation time.
2. `devEnd`: status nao ket thuc implementation time, vi du `Ready For Testing` hoac `Developed`.

## Cach them custom status

Neu OpenProject co status moi, them dung ten status vao mot nhom trong `backend/status-mapping.json`.

Vi du:

```json
{
  "notStarted": ["New", "To do", "Backlog"],
  "active": ["In Progress", "Implementing", "Dang lam"],
  "developed": ["Developed", "Ready For Testing"],
  "done": ["Done", "Closed", "Prod"],
  "blocked": ["Blocked", "On Hold", "Waiting for Customer"]
}
```

Sau khi cap nhat mapping, restart backend de dashboard dung cau hinh moi.
