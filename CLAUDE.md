# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project

Project MARR — an HR Welfare management app. Next.js 15 (App Router, Turbopack) + TypeScript + Tailwind CSS v4 frontend and API in a single project, backed by MySQL via `mysql2/promise`. The app lives in `marr-app/`; there is nothing at the repo root except this file and `marr-app/`.

Light theme only — there is no dark mode toggle, and no dark-mode CSS should be reintroduced into `app/globals.css`.

## Commands

Run all commands from `marr-app/`:

- `npm install` — install dependencies
- `npm run dev` — dev server with Turbopack (http://localhost:3000)
- `npm run build` — production build (also runs type-checking and lint; treat a failing build as a real error, not noise). It overwrites `.next/`, so a running `npm run dev` starts returning 500s afterwards and must be restarted
- `npm run start` — run the production build

No test runner is configured yet.

`D:\MARR` is a Git repository (branch `main`, committer Sitthikorn.hong@gmail.com, installed 2026-11-02 at `C:\Program Files\Git\cmd\git.exe`). Each release also stores the live database structure (no data) as `marr-app/db/schema_MARR-V.<n>.sql`, written by `npm run dump-schema -- MARR-V.<n>` (`scripts/dump-schema.mjs`, from `SHOW CREATE TABLE`). Unlike the hand-maintained `schema.sql`, which has upgrade notes, this is an exact snapshot that can be restored with `mysql -u root -p < db/schema_MARR-V.<n>.sql`. Released versions are annotated tags named `MARR-V.<n>` (tag names cannot contain spaces); `MARR-V.1` is the first. The root `.gitignore` keeps `.env*`, `node_modules/`, `.next/` and `versions/` out of Git. `versions/` also holds a zip snapshot of V.1 (`MARR V.1.zip`) made before Git was installed.

### Database setup

MySQL must be running locally. From `marr-app/`:

```
mysql -u root -p < schema.sql
mysql -u root -p marr_db < seed.sql
```

Connection config is read from `.env.local` (`DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`) by `lib/db.ts`.

## Architecture

### Directory layout

App Router and `lib/` live at the project root of `marr-app/` (not under `src/`), per explicit project convention:

```
marr-app/
  schema.sql          # table definitions (run once against MySQL)
  seed.sql            # sample data: 2 employees, 3 locations, 1 month of attendance
  .env.local           # DB connection env vars (gitignored)
  lib/
    db.ts             # mysql2 pool + query()/execute() helpers
    types.ts          # shared TS interfaces for all tables/API payloads
  app/
    layout.tsx        # global nav (Dashboard/Employees/Attendance/Welfare Summary)
    page.tsx           # Dashboard
    employees/page.tsx
    attendance/page.tsx
    welfare/page.tsx
    api/
      employees/route.ts            # GET all, POST create
      employees/[id]/route.ts       # GET one (404), PUT welfare rates only (emp_code/name belong to the TimeMint sync), DELETE
      attendance/route.ts           # GET (filter by employee_id/month/year), POST create
      attendance/[id]/route.ts      # GET one (404), DELETE
      locations/route.ts            # GET all location_rates
      welfare/calculate/route.ts    # POST: compute + persist a welfare_summary row
```

The `@/*` path alias resolves to the `marr-app/` root (e.g. `@/lib/db`, `@/lib/types`), not `src/`.

### Data flow

Pages are client components (`"use client"`) that call the API via relative `fetch` paths (`/api/employees`, etc.) — there is no direct DB access from page components. All DB access goes through `lib/db.ts`'s pooled connection; route handlers under `app/api/**/route.ts` are the only code that imports `lib/db`, with two exceptions: `lib/employeeSync.ts` (shared by the sync/settings routes and the background scheduler) and `lib/auth.ts` (sessions, used by every route).

### Login and permissions

Every page and API needs a session. `middleware.ts` sends requests without the `marr_session` cookie to `/login` (pages) or answers 401 (API). It only checks that the cookie is present; each route handler validates the session with `requireAuth(request, { admin? })` from `lib/auth.ts` and scopes data with `canAccessEmployee(auth, employeeId)`. **Every new route handler must call `requireAuth`.**

- **Roles:** `user` (employee) sees and edits only their own Welfare Summary, Allowance Report and Mileage form; `admin` sees everyone and is the only role allowed on Employees, Attendance, Import, Settings, sync and `/api/users`. `GET /api/employees` returns only the caller's own row for users, and adds `account` (username, role, has_password, locked) for admins. `app/NavBar.tsx` hides admin links and redirects users away from admin pages, but that's convenience only; the API is the gate.
- **Accounts:** stored in `users` (one per employee, or an admin with no employee) and `sessions` (sha256 of a random cookie token, 12h). The employee sync creates a missing account via `createEmployeeAccount()`: username = email part before "@" (lowercase), falling back to `emp_code` lowercased when there's no email, the part is shared by several employees, or it's taken. First password = TimeMint `EmpTel` digits (hashed, never stored raw), with `must_change_password = 1`. The sync never changes an existing account.
- **First login:** until the password is changed, every route except `/api/auth/*` answers 403. Users must pick a 4-digit PIN, admins at least 8 characters (`lib/password.ts`).
- **Hashing and lockout:** passwords use scrypt from `node:crypto` (`scrypt$N$r$p$salt$hash`). 5 wrong passwords in a row lock the account for 15 minutes.
- **Admin tools:** `npm run create-admin -- <username> <password> [emp_code]` creates or updates an admin (`scripts/create-admin.mjs`, same hash format). The Employees page's Login column calls `POST /api/users/[employeeId]`, which resets to the TimeMint phone (or an admin-supplied temp password), unlocks, forces a new PIN, ends sessions and creates the account if missing. `PUT /api/users/[employeeId] { role }` switches user/admin; admins can't demote themselves.

### Employee sync (Settings page)

`/settings` toggles automatic import of employees from TimeMint (API v3.0, docs at https://doc.timemint.co/). Settings live in the single-row `app_settings` table (id = 1). `instrumentation.ts` starts `lib/syncScheduler.ts` on server boot, which checks every minute and calls `runEmployeeSync()` when auto sync is on and the interval has elapsed; `POST /api/employees/sync` runs it on demand.

TimeMint calls are all `POST` of `{ name, param }` to one base URL, and the body's own `status` must be checked (HTTP 200 can carry an error). Each sync first requests a one-time token (`GenerateTokenServiceOnTimemint`, Service `"Employee"`, 15-minute expiry), then `GetEmpData` with `Service: "GetByCom"`. Config comes from `.env.local` (`TIMEMINT_API_URL`, `TIMEMINT_API_KEY`), never from the DB. TimeMint keys start with `$TMK$`, and Next.js expands `$VAR` in env files, so every `$` in the key must be written as `\$` or the key is silently truncated (TimeMint then returns a misleading `Column 'create_by' cannot be null` error). Mapping: `EmpID` → `emp_code`, `EmpNameTH` (fallback `EmpNameEN`) → `name`. Resigned (`EmpResignDate` ≤ today) or suspended (`EmployeeActiveStatus` 99) employees and records whose `EmpID` exceeds `emp_code`'s 20 chars are ignored. Sync upserts on `emp_code`, updates only `name`, never touches welfare rates, and never deletes employees.

The TimeMint client (`callTimeMint`, `getToken`, and the `fetch*` helpers) lives in `lib/timemint.ts` and has no DB access. TimeMint tokens are JWTs of (issued-at second, company, member) with no service in them and are stored under a unique constraint, so two token requests in the same second fail with `Duplicate entry ... for key 'token'`; `getToken` serializes requests and spaces them >1.1s apart.

### Company-wide import (all employees in one go)

Every TimeMint fetcher in `lib/timemint.ts` takes a `Scope`: `{ empId }` (`Service: "GetByID"`) or `"company"` (`Service: "GetByCom"`). Each returns results keyed by EmpID (`ByEmployee<T>`, read with `forEmployee()`). `lib/companyImport.ts` (imports lib/db, like employeeSync) holds the shared import pipeline:
- `fetchSources(scope, start, end)`: the 7 APIs, with check-logs and leaves required and the rest optional.
- `buildForEmployee()`: builds one employee's rows from the fetched sources.
- `saveEmployeeImport()`: replaces one employee's `attendance_report` / `overtime_request` / `attendance` rows on a given connection.
- `runCompanyImport(start, end)`: one GetByCom call per API, then all MARR employees saved in one transaction. It records the outcome in `app_settings.last_import_*`.

`POST /api/timemint/attendance/all { month, year }` (admin) runs it for a calendar month; a month takes ~16s, mostly the >1.1s token spacing. It's on the Import page ("All employees — one month") and Settings ("Import this month now"). With `auto_import_enabled`, `lib/syncScheduler.ts` runs it every `import_interval_minutes` for the current month, plus the previous month during days 1–5, after the employee sync. TimeMint employees missing from MARR are reported (`not_in_marr`: run the sync first), and MARR employees TimeMint doesn't return are skipped. Per-call limits: Leave/OT/Shift/Holiday allow 100 employees and 31 days; CheckLog allows 10,000 person-days and 90 days. Past 100 employees, split by group (GetByGroup); that isn't implemented yet.

TimeMint's Report API (`GetReportData`) only lists report files already generated in TimeMint (it can't create one), and the Excel (ALPHA) export lacks OT approval status, leave unit, department and approver, so it isn't used.

### Attendance import from TimeMint (`/attendance/import`)

Pick an employee and a date range (max 90 days, the CheckLog limit; Leave, Overtime, weekly Holiday and Shift requests are chunked into 31-day windows, annual holidays are fetched per year). `POST /api/timemint/attendance` with `save: false` returns a preview; `save: true` replaces that employee's rows in the range in **two** tables in one transaction:

- `attendance_report` — the same columns as TimeMint's attendance report export (`example/HR1.xlsx`): one row per check-log (in-only and out-only check-logs are separate rows), one per leave per day, and for days with neither: `Company holiday (<name>)`, `Holiday` (weekly), `Absence all day` (workday up to today) or an empty future row. `Start work at`/`Get off work at` come from the day's shift (`ShiftDisplayStart/EndWorkTime`), else the employee's `EmpWorkTime` + `WorkHoursPerDay` (+1h if `EmpBreakTime` is set), and are NULL ("-") on holidays. `Time Adjustment` = `CheckLogAdjustment`. Overtime requests (approved and pending) are formatted like the export and attached to the day's first row. `row_type` and `checklog_id` are extra helper columns. Built by the pure `buildAttendanceReport()` in `lib/attendanceReport.ts`.
- `overtime_request` — every OT request (approved and pending) in the range, unique on `overtime_id`; replaced only when the Overtime fetch succeeded, so a missing API topic doesn't wipe earlier imports. Feeds welfare rule 3.
- `attendance` — one row per day that has check-logs or an approved full-day leave, derived from the report rows: earliest time in, latest time out, first check-in's place, `leave_type` = `LeaveTypeEN` for `LeaveUnit` "Days". This is what the welfare calculation reads.

Hourly leaves, overnight check-outs, out-only days and missing check-outs are reported as warnings. Check-logs and leaves are required; profile, overtime, shift and holiday fetches are optional and degrade to a warning (e.g. when the API key lacks that topic). Places missing from `location_rates` are listed because their travel fee will be 0. The API key needs the topics พนักงาน ("Employee"), บันทึกเข้า-ออก ("CheckLog"), บันทึกการลา ("Leave"), บันทึกการทำงานล่วงเวลา ("Overtime"), กะทำงาน ("Shift") and วันหยุด ("Holiday"). A 31-day import needs ~7 tokens spaced >1s apart, so it takes ~10–20s.

### Allowance report (`/welfare/allowance-report`)

The "Allowance Report" button on Welfare Summary opens `/welfare/allowance-report?employee_id=&month=&year=` in a new tab: a printable A4 reproduction of the company's paper form "Other Income for Allowance" (ENSYS). `GET /api/welfare/allowance-report` builds it from the **stored** `attendance_report` rows (so the month must be imported and saved first), one line per calendar day: worked day (time = shift start–end, else first in–last out; site = distinct places; on a workday, a missing check-in or a first check-in more than 60 min after `start_work_at` is "no check-in", and a missing check-out or a last check-out before 13:00 is "no check-out"; first check-in to last check-out, minus the part inside the 12:00–13:00 lunch break, of 4h or less is "worked h:mm h excl. lunch (not more than 4 h)"; any of these makes the day `uncounted` — shown in Remarks, not counted. Worked holidays are exempt from these rules). The Time cell's right edge shows the allowance count (1, 2, … / H1, H2, …); the Site cell's right edge shows the work-day count used by welfare rule 4 (see `lib/dayRules.ts`), worked holiday (`day_type` ≠ workday, marked "(H)"), leave, holiday off ("X"), absence. Total Day = worked workdays × Site Allowance/Day (default `employees.base_allowance`); Total Holiday = worked holidays × Site Allowance/Holiday (default day rate × 3.5, which reproduces the form's 300 → 1,050 — an assumption, editable on screen before printing). These numbers are independent of the four welfare formulas below. Department and direct superior (`EmpApproverID`, resolved to a name via `employees.emp_code`) come from extra `attendance_report` columns filled at import.

### Mileage & Telephone form (`/welfare/mileage`)

The "Mileage & Telephone" button on Welfare Summary opens `/welfare/mileage?employee_id=&month=&year=`: the company's "Other Income for Mileage and Telephone Charge" form (ENSYS, Mileage - 301, Telephone & Internet Charge - 310). `GET /api/welfare/mileage` returns the header (same sources as the allowance report), the month's days classified by `lib/dayRules.ts`, and what has been submitted. Each day with check-ins (`work` / `uncounted` / `holiday_work`) gets **one row per leg** (Date, Time, From, To, TOTAL KM — no Site column). Legs come from `day_places`: the day's check-in places in time order with consecutive repeats collapsed. Leg 1 is "ที่พัก" → first place (with the shift time), and each later leg goes from the previous place → the next. Each leg is submitted on its own with `PUT /api/welfare/mileage/entry`, an upsert keyed by `(claim, date, seq)`; `mileage_entry.seq` is the leg number and `site` is no longer filled. Legs saved before this change are kept as leg 1. "Total Other Income" lists Mileage (km × rate), **ค่ากลับบ้าน** (computed live with `returnHomeBonus()` from `lib/dayRules.ts`, the same as welfare rule 4), **Telephone** (`mileage_claim.telephone_amount`; when the month has none saved, the latest amount saved in an earlier month is pre-filled and flagged "from last saved"), then free extra lines. Rate per km (default 5.00), telephone, remarks and extra lines are saved with `PUT /api/welfare/mileage/claim`. Tables: `mileage_claim` (one per employee/month) → `mileage_entry` (one per day) and `mileage_other_item`. Totals and the printout use **submitted** rows only; unsubmitted rows print blank except the pre-filled place.

### TimeMint attendance report (`/welfare/timemint`)

The "TimeMint" button on Welfare Summary opens `/welfare/timemint?employee_id=&month=&year=`, a printable copy of TimeMint's own attendance report layout (sample: `ฟอร์มเอกสาร/Timemint.pdf`). `GET /api/welfare/timemint-report` (own records or admin) builds it from stored data, with one row per calendar day:
- **รหัสพนักงาน / ชื่อพนักงาน:** emp_code and `employees.name` (Thai).
- **วันที่, เวลาทำงาน:** the date and the shift start–end.
- **บันทึกเวลา:** first check-in and last check-out.
- **สถานที่:** one line per check-log, `[in->out] > [ place ]`, with a missing time shown as 00:00. With no check-logs, the cell holds the leave type in Thai or the company holiday name.
- **จำนวนวันลา (ลากิจ / ลาป่วย / ลาพักร้อน):** from full-day leaves in `attendance.leave_type`, matched on Personal / Sick / Vacation|Annual Leave. Hourly leaves aren't counted.

A ยอดรวม row follows, then "วันทำงานตาม TimeMint = days with check-logs" and the time the report was produced. Rows use the same highlight colours as the other forms.

### Welfare calculation (`app/api/welfare/calculate/route.ts`)

This is the one non-trivial piece of business logic. Given `{ employee_id, month, year }`, it runs inside a single MySQL transaction (`pool.getConnection()` → `beginTransaction`/`commit`/`rollback`/`release`) and computes four numbers from that employee's `attendance` rows for the given month, then upserts a row in `welfare_summary` (unique on `employee_id, month, year`, so recalculating a month overwrites it rather than duplicating):

1. **Allowance** — `base_allowance × (count of days with time_in AND time_out set AND leave_type NULL AND (time_out − time_in − the part inside the 12:00–13:00 lunch break) > 4h)` (`MIN_ALLOWANCE_HOURS`, `hoursExcludingLunch()`; `attendance.time_in/out` are the day's first check-in / last check-out). The 4h filter applies only to the allowance count; rule 4's worked hours still use every valid day.
2. **Travel** — sum of `location_rates.travel_fee` for every attendance row whose `location_name` matches, joined in SQL (`LEFT JOIN location_rates`).
3. **Overtime** — only on days with an **approved** TimeMint OT request (`overtime_request.status = 'Approved'`); days without one get no OT, whatever the check-out time. That day's worked intervals come from `attendance_report` check-log rows (rows with both times are intervals; separate in-only / out-only rows are paired in time order) and only the minutes overlapping the request window(s) count. Each day is rounded to whole hours — remainder < 20 min dropped, ≥ 20 min rounded up (`OT_ROUND_UP_MINUTES`) — then summed and multiplied by `base_ot_rate`. Holidays follow the same rule. The response also returns `ot_hours`.
4. **Return Home Bonus** — computed by `returnHomeBonus()` in `lib/dayRules.ts` (shared with the mileage form) — tiered on **work days / base days**: base days = days in month − Sundays − TimeMint company holidays (`attendance_report.day_type = 'company_holiday'`, not double-counted when on a Sunday; so the month must be imported). Leave days are **not** deducted, per the user. Thresholds drop fractions of a day: half = `floor(50% × base)`, full = `floor(80% × base)`. Work days < half → 0; half ≤ work days < full → `return_home_rate / 2`; ≥ full → full `return_home_rate`. Work days come from `classifyMonth()` in `lib/dayRules.ts` over the month's `attendance_report` rows (`work_day`): a workday that passes every allowance-report rule (check-in ≤ 1h late, check-out ≥ 13:00, > 4h excluding lunch), or a worked holiday with check-in and check-out and > 4h excluding lunch. The response also returns `work_days`, `base_days`, `half_threshold_days` and `full_threshold_days`.

Rules 1–3 live only in this route handler. The per-day classification (allowance report "work"/"uncounted" and `work_day`) lives only in `lib/dayRules.ts`, shared by this route and `/api/welfare/allowance-report` — change day rules there, not in either route.

### TypeScript/mysql2 gotcha

`mysql2`'s `execute()` overloads require values to match its `ExecuteValues` type, which (unlike `QueryValues`) does **not** include `undefined`. Fields narrowed only by `Number.isInteger(x)` or similar non-primitive guards stay `T | undefined` to the type checker and silently fail overload resolution with a confusing "Argument of type 'string' is not assignable to parameter of type 'QueryOptions'" error (TS reports the *other* overload's mismatch). Fix: assign to a definitively-typed local (`const x: number = value as number`) after validating, and pass that local to `execute`/`query` — see `welfareId`/`monthNum`/`yearNum` in the welfare route for the pattern. `lib/db.ts`'s `query`/`execute` helpers also cast params `as any[]` for the same reason.

### Return Home options

`employees.return_home_rate` is limited to three values defined in `lib/returnHome.ts` and shown as a dropdown on the Employees page: 0 = "ไม่มีค่ากลับบ้าน", 1,000 = "D < 350 กม", 2,000 = "D > 350 กม" (THB per month, by home distance). `POST /api/employees` and `PUT /api/employees/[id]` reject any other value; a legacy non-standard value is shown as a disabled option until an allowed one is chosen. The welfare calculation still uses the stored number as-is (rule 4).

### Conventions

- All SQL is parameterized (`?` placeholders) — no string-interpolated SQL anywhere.
- Every route handler returns `NextResponse.json(...)` with an explicit status (200/201/400/404/500) and a `{ error: string }` shape on failure.
- Dynamic route handlers use Next.js 15's async `params`: `{ params }: { params: Promise<{ id: string }> }`, then `const { id } = await params`.
