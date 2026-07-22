# Status Mapping Agreement

Dashboard giu nguyen status goc cua OpenProject khi hien thi, nhung map status do ve nhom chuan de tinh KPI. File cau hinh dang dung:

```txt
backend/status-mapping.json
```

## Nhom status chuan

| Nhom | Y nghia nghiep vu | Anh huong KPI |
| --- | --- | --- |
| `notStarted` | Task chua vao luong thuc hien | Khong tinh cycle/dev time |
| `ready` | Task da san sang lam nhung chua bat dau | Khong tinh cycle/dev time |
| `active` | Dang phat trien/thuc hien | Bat dau cycle neu nam trong `cycleStart`; co the bat dau dev time neu nam trong `devStart` |
| `review` | Dang review code/nghiep vu | Tinh vao active time neu nam trong `workInFlight` |
| `testing` | Dang test/QA | Tinh vao active time neu nam trong `workInFlight` |
| `developed` | Dev da xong theo dinh nghia cua team | Ket thuc dev time neu nam trong `devEnd` |
| `blocked` | Dang bi chan/cho xu ly | Tinh blocked time |
| `done` | Da hoan thanh | Ket thuc cycle, duoc tinh 100% neu OpenProject khong co `% done` |
| `cancelled` | Huy/tu choi/khong lam nua | Ket thuc cycle, khong tu dong tinh la hoan thanh |

## Quy tac can chot voi BA/PM/Tech Lead

1. `devStart`: status nao bat dau tinh dev time.
2. `devEnd`: status nao ket thuc dev time.
3. `cycleStart`: status nao bat dau tinh cycle time.
4. `terminal`: status nao ket thuc cycle time.
5. `workInFlight`: status nao duoc tinh la active time.

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
