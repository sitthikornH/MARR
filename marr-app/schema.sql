-- Project MARR (HR Welfare) database schema
-- Run with: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS marr_db;
USE marr_db;

-- Named employee groups (e.g. SUB1, O&M, Solar1) an employee belongs to and a supervisor account
-- can be granted access to (see users' 3 report group-access columns below) — independent of any
-- particular supervisor login, so a group can exist with no employees or no supervisor yet.
CREATE TABLE IF NOT EXISTS employee_groups (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(100) NOT NULL UNIQUE,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 'No group' is a real, permanent group every ungrouped employee is assigned to (not NULL) so it's
-- directly selectable like any other group when granting a supervisor's report access.
INSERT IGNORE INTO employee_groups (name) VALUES ('No group'), ('SUB1'), ('O&M'), ('SUB2'), ('Solar1'), ('Solar2'), ('Biomass');

CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emp_code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  base_allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
  base_allowance_holiday DECIMAL(10,2) NOT NULL DEFAULT 0, -- site allowance per worked holiday; shown as "Allowance Holiday" on the Employees page
  base_ot_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
  return_home_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
  work_shift VARCHAR(11) NOT NULL DEFAULT '08:00-17:00', -- "08:00-17:00" | "08:30-17:30" (lib/workShift.ts)
  group_id INT NULL, -- employee_groups.id; which named group this employee belongs to (defaults to 'No group' at creation), set on the Employees page
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_employees_group FOREIGN KEY (group_id) REFERENCES employee_groups(id) ON DELETE SET NULL
);
-- Upgrade for databases whose employees predates work_shift (run once):
-- ALTER TABLE employees ADD COLUMN work_shift VARCHAR(11) NOT NULL DEFAULT '08:00-17:00' AFTER return_home_rate;
-- Upgrade for databases whose employees predates group_id (run once; employee_groups must exist first):
-- ALTER TABLE employees ADD COLUMN group_id INT NULL AFTER work_shift;
-- ALTER TABLE employees ADD CONSTRAINT fk_employees_group FOREIGN KEY (group_id)
--   REFERENCES employee_groups(id) ON DELETE SET NULL;
-- Upgrade for databases whose employees still has the old supervisor_id (a direct FK to a specific
-- supervisor login, replaced 2026-11-21 by the group_id above so a group can be shared by several
-- supervisor logins, or exist before anyone is assigned to it): backfill group_id from whichever
-- group each supervisor login was renamed to, then drop the old column:
-- UPDATE employees e JOIN users u ON u.id = e.supervisor_id JOIN employee_groups g ON g.name = '<new group name>'
--   SET e.group_id = g.id WHERE u.username = '<old supervisor login>'; -- once per renamed login
-- ALTER TABLE employees DROP FOREIGN KEY fk_employees_supervisor, DROP COLUMN supervisor_id;
-- Upgrade for databases whose employee_groups predates the 'No group' row (added 2026-11-23 so
-- ungrouped employees have a real, selectable group instead of NULL; run once):
-- INSERT IGNORE INTO employee_groups (name) VALUES ('No group');
-- UPDATE employees SET group_id = (SELECT id FROM employee_groups WHERE name = 'No group') WHERE group_id IS NULL;
-- Upgrade for databases whose employees predates base_allowance_holiday (run once); backfill with the
-- old 3.5x-of-base_allowance assumption from the Allowance Report so existing printouts don't change:
-- ALTER TABLE employees ADD COLUMN base_allowance_holiday DECIMAL(10,2) NOT NULL DEFAULT 0 AFTER base_allowance;
-- UPDATE employees SET base_allowance_holiday = base_allowance * 3.5;

-- The company's own declared holiday calendar (e.g. the yearly ENSYS announcement), overriding
-- TimeMint's own annual holiday data for the same date when building attendance_report.
CREATE TABLE IF NOT EXISTS company_holidays (
  date DATE NOT NULL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS location_rates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  location_name VARCHAR(100) NOT NULL UNIQUE,
  travel_fee DECIMAL(10,2) NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attendance (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  date DATE NOT NULL,
  time_in TIME NULL,
  time_out TIME NULL,
  location_name VARCHAR(100) NULL,
  leave_type VARCHAR(50) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_attendance_employee_date (employee_id, date)
);

CREATE TABLE IF NOT EXISTS welfare_summary (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  month INT NOT NULL,
  year INT NOT NULL,
  total_allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_travel DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_ot DECIMAL(10,2) NOT NULL DEFAULT 0,
  total_return_home DECIMAL(10,2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_welfare_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_welfare_employee_month_year (employee_id, month, year)
);

-- TimeMint attendance report rows, same columns as TimeMint's report export (example/HR1.xlsx):
-- one row per check-in, plus one row per leave, holiday or absent day.
CREATE TABLE IF NOT EXISTS attendance_report (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  emp_code VARCHAR(255) NOT NULL,
  employee_name VARCHAR(255) NOT NULL,
  position VARCHAR(255) NULL,
  date DATE NOT NULL,
  start_work_at TIME NULL,
  get_off_work_at TIME NULL,
  time_in TIME NULL,
  time_out TIME NULL,
  notice VARCHAR(500) NULL,
  overtime_request_history TEXT NULL,
  place VARCHAR(255) NULL,
  row_type VARCHAR(20) NOT NULL,
  checklog_id VARCHAR(50) NULL,
  day_type VARCHAR(20) NOT NULL DEFAULT 'workday', -- workday / holiday (weekly) / company_holiday
  holiday_name VARCHAR(255) NULL,
  department VARCHAR(255) NULL,
  approver_code VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_attendance_report_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_attendance_report_employee_date (employee_id, date)
);

-- TimeMint overtime requests (approved and pending), saved by the attendance import.
-- The welfare OT formula uses approved requests overlapped by check-in/out intervals.
CREATE TABLE IF NOT EXISTS overtime_request (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  overtime_id VARCHAR(50) NOT NULL,
  date DATE NOT NULL,
  time_start TIME NOT NULL,
  time_end TIME NOT NULL,
  minutes INT NOT NULL DEFAULT 0,
  overtime_type VARCHAR(50) NULL,
  day_type VARCHAR(50) NULL,
  reason VARCHAR(500) NULL,
  status VARCHAR(20) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_overtime_request_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_overtime_request_id (overtime_id),
  INDEX idx_overtime_request_employee_date (employee_id, date)
);

-- "เพิ่มเมื่อ" (when the employee submitted the OT request): the Overtime API has no such field, so it's
-- read from TimeMint's website (viewot.php) the same way as time_adjustment_request below. Kept in its
-- own table, keyed on overtime_id, because the attendance import deletes and reinserts overtime_request
-- rows on every run and would otherwise lose it.
CREATE TABLE IF NOT EXISTS overtime_added_at (
  overtime_id VARCHAR(50) NOT NULL PRIMARY KEY,
  employee_id INT NOT NULL,
  requested_at DATETIME NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_overtime_added_at_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_overtime_added_at_employee (employee_id)
);

-- Time adjustment request history, from TimeMint's "Time Adjustment Request" report files (TimeMint
-- has no API for these records). Same columns as the report; upserted on record_no, never deleted.
CREATE TABLE IF NOT EXISTS time_adjustment_request (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  record_no VARCHAR(50) NOT NULL,
  emp_code VARCHAR(255) NOT NULL,
  employee_name VARCHAR(255) NULL,
  position VARCHAR(255) NULL,
  employee_group VARCHAR(255) NULL,
  date DATE NOT NULL,
  from_time_in VARCHAR(8) NULL,
  from_time_out VARCHAR(8) NULL,
  to_time_in VARCHAR(8) NULL,
  to_time_out VARCHAR(8) NULL,
  reason VARCHAR(1000) NULL,
  place VARCHAR(255) NULL,
  added_by VARCHAR(255) NULL,
  created_date VARCHAR(30) NULL,
  status VARCHAR(50) NULL,
  image_url VARCHAR(1000) NULL,
  source_report_id VARCHAR(50) NULL,
  record_type VARCHAR(100) NULL,
  system_owner VARCHAR(255) NULL,
  approver VARCHAR(255) NULL,
  approval_type VARCHAR(100) NULL,
  imported_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_time_adjustment_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_time_adjustment_record_no (record_no),
  INDEX idx_time_adjustment_employee_date (employee_id, date)
);

-- "Other Income for Mileage and Telephone Charge" form: one claim per employee per month,
-- one mileage entry per day (submitted row by row), and free-form other-income lines
-- (Telephone & Internet, Go back home, ...).
CREATE TABLE IF NOT EXISTS mileage_claim (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NOT NULL,
  month INT NOT NULL,
  year INT NOT NULL,
  rate_per_km DECIMAL(10,2) NOT NULL DEFAULT 5.00,
  telephone_amount DECIMAL(10,2) NULL, -- Telephone line; the latest saved value pre-fills later months
  remarks TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mileage_claim_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uq_mileage_claim_employee_month_year (employee_id, month, year)
);

CREATE TABLE IF NOT EXISTS mileage_entry (
  id INT AUTO_INCREMENT PRIMARY KEY,
  claim_id INT NOT NULL,
  date DATE NOT NULL,
  seq INT NOT NULL DEFAULT 1, -- leg of the day: 1 = accommodation -> first place, 2 = first -> second place, ...
  time VARCHAR(20) NULL,
  from_place VARCHAR(255) NULL,
  to_place VARCHAR(255) NULL,
  km DECIMAL(10,2) NOT NULL DEFAULT 0,
  site VARCHAR(100) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_mileage_entry_claim FOREIGN KEY (claim_id)
    REFERENCES mileage_claim(id) ON DELETE CASCADE,
  UNIQUE KEY uq_mileage_entry_claim_date_seq (claim_id, date, seq)
);

CREATE TABLE IF NOT EXISTS mileage_other_item (
  id INT AUTO_INCREMENT PRIMARY KEY,
  claim_id INT NOT NULL,
  description VARCHAR(255) NOT NULL,
  period VARCHAR(50) NULL,
  amount DECIMAL(10,2) NOT NULL DEFAULT 0,
  CONSTRAINT fk_mileage_other_item_claim FOREIGN KEY (claim_id)
    REFERENCES mileage_claim(id) ON DELETE CASCADE
);

-- Login accounts. Employees get one at TimeMint sync (username = email part before @, else emp_code;
-- first password = TimeMint phone number, then a 4-digit PIN). Admins may have no employee.
CREATE TABLE IF NOT EXISTS users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  employee_id INT NULL UNIQUE,
  username VARCHAR(100) NOT NULL UNIQUE, -- stored lowercase
  password_hash VARCHAR(255) NULL, -- NULL = no password yet (admin must reset)
  role VARCHAR(10) NOT NULL DEFAULT 'user', -- 'user' | 'admin' | 'supervisor' (restricted admin, see employee_groups)
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  -- The next 8 columns only apply to role='supervisor'; each is an independent toggle an admin sets
  -- per account on Settings > Supervisors (not a fixed set of presets).
  can_manage_employees TINYINT(1) NOT NULL DEFAULT 0, -- full Employees-page access, like an admin
  can_manage_time_adjustment_history TINYINT(1) NOT NULL DEFAULT 0, -- Settings > Time Adjustment History access
  -- One group-access pair per report form: NULL + *_all=0 = sees nobody via that report (the safe
  -- default for a new account); *_all=1 = every employee group, regardless of *_group_id; otherwise
  -- scoped to employee_groups.id = *_group_id. Several supervisor logins may share the same group.
  timemint_group_id INT NULL,
  timemint_all TINYINT(1) NOT NULL DEFAULT 0,
  ot_group_id INT NULL,
  ot_all TINYINT(1) NOT NULL DEFAULT 0,
  fixed_time_group_id INT NULL,
  fixed_time_all TINYINT(1) NOT NULL DEFAULT 0,
  allowance_group_id INT NULL,
  allowance_all TINYINT(1) NOT NULL DEFAULT 0,
  mileage_group_id INT NULL,
  mileage_all TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE,
  CONSTRAINT fk_users_timemint_group FOREIGN KEY (timemint_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_ot_group FOREIGN KEY (ot_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_fixed_time_group FOREIGN KEY (fixed_time_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_allowance_group FOREIGN KEY (allowance_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL,
  CONSTRAINT fk_users_mileage_group FOREIGN KEY (mileage_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL
);
-- Upgrade for databases whose users predates the 2 supervisor-permission columns above (run once):
-- ALTER TABLE users
--   ADD COLUMN can_manage_employees TINYINT(1) NOT NULL DEFAULT 0 AFTER locked_until,
--   ADD COLUMN can_manage_time_adjustment_history TINYINT(1) NOT NULL DEFAULT 0 AFTER can_manage_employees;
-- Upgrade for databases whose users still has the old timemint_scope/ot_scope/fixed_time_scope
-- ('own'/'all' strings, replaced 2026-11-21 by the 6 group-access columns above so "own" can mean a
-- named, shareable group instead of only "employees.supervisor_id = this login"):
-- ALTER TABLE users
--   ADD COLUMN timemint_group_id INT NULL AFTER can_manage_time_adjustment_history,
--   ADD COLUMN timemint_all TINYINT(1) NOT NULL DEFAULT 0 AFTER timemint_group_id,
--   ADD COLUMN ot_group_id INT NULL AFTER timemint_all,
--   ADD COLUMN ot_all TINYINT(1) NOT NULL DEFAULT 0 AFTER ot_group_id,
--   ADD COLUMN fixed_time_group_id INT NULL AFTER ot_all,
--   ADD COLUMN fixed_time_all TINYINT(1) NOT NULL DEFAULT 0 AFTER fixed_time_group_id,
--   ADD CONSTRAINT fk_users_timemint_group FOREIGN KEY (timemint_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL,
--   ADD CONSTRAINT fk_users_ot_group FOREIGN KEY (ot_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL,
--   ADD CONSTRAINT fk_users_fixed_time_group FOREIGN KEY (fixed_time_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL;
-- UPDATE users SET timemint_all = (timemint_scope = 'all'), ot_all = (ot_scope = 'all'), fixed_time_all = (fixed_time_scope = 'all');
-- -- then set each 'own' login's *_group_id to its mapped group (see the employees.group_id upgrade note above), and:
-- ALTER TABLE users DROP COLUMN timemint_scope, DROP COLUMN ot_scope, DROP COLUMN fixed_time_scope;
-- Upgrade for databases whose users predates the allowance/mileage report-access columns above
-- (added 2026-11-23 so a supervisor can also be granted the Allowance Report and Mileage forms,
-- the same group-or-all pattern as timemint/ot/fixed_time; run once):
-- ALTER TABLE users
--   ADD COLUMN allowance_group_id INT NULL AFTER fixed_time_all,
--   ADD COLUMN allowance_all TINYINT(1) NOT NULL DEFAULT 0 AFTER allowance_group_id,
--   ADD COLUMN mileage_group_id INT NULL AFTER allowance_all,
--   ADD COLUMN mileage_all TINYINT(1) NOT NULL DEFAULT 0 AFTER mileage_group_id,
--   ADD CONSTRAINT fk_users_allowance_group FOREIGN KEY (allowance_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL,
--   ADD CONSTRAINT fk_users_mileage_group FOREIGN KEY (mileage_group_id) REFERENCES employee_groups(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE, -- sha256 of the cookie token; the token itself is never stored
  expires_at DATETIME NOT NULL,
  last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, -- idle over 30 minutes = must log in again
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
);

-- Upgrade for databases whose sessions predates last_active_at (run once):
-- ALTER TABLE sessions ADD COLUMN last_active_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER expires_at;

-- One row per sign-in and sign-out (lib/auth.ts startSession/endSession), including the automatic
-- sign-out after 30 minutes idle. username/employee_name/role are a snapshot at the time of the event,
-- so the history still reads correctly after a rename or after the account is removed.
CREATE TABLE IF NOT EXISTS login_history (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NULL,
  username VARCHAR(100) NOT NULL,
  employee_name VARCHAR(100) NULL,
  role VARCHAR(10) NOT NULL,
  event VARCHAR(10) NOT NULL, -- 'login' | 'logout'
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_login_history_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_login_history_created (created_at)
);

-- Upgrade for databases whose time_adjustment_request predates record_type (run once):
-- ALTER TABLE time_adjustment_request
--   ADD COLUMN record_type VARCHAR(100) NULL AFTER source_report_id,
--   ADD COLUMN system_owner VARCHAR(255) NULL AFTER record_type,
--   ADD COLUMN approver VARCHAR(255) NULL AFTER system_owner,
--   ADD COLUMN approval_type VARCHAR(100) NULL AFTER approver;

-- Upgrade for databases whose attendance_report predates the columns above
-- (run once; MySQL errors if a column already exists, which is safe to ignore):
-- ALTER TABLE attendance_report
--   ADD COLUMN day_type VARCHAR(20) NOT NULL DEFAULT 'workday' AFTER checklog_id,
--   ADD COLUMN holiday_name VARCHAR(255) NULL AFTER day_type,
--   ADD COLUMN department VARCHAR(255) NULL AFTER holiday_name,
--   ADD COLUMN approver_code VARCHAR(255) NULL AFTER department;
-- ALTER TABLE mileage_claim ADD COLUMN telephone_amount DECIMAL(10,2) NULL AFTER rate_per_km;
-- ALTER TABLE mileage_entry ADD COLUMN seq INT NOT NULL DEFAULT 1 AFTER date,
--   ADD UNIQUE KEY uq_mileage_entry_claim_date_seq (claim_id, date, seq);
-- ALTER TABLE mileage_entry DROP INDEX uq_mileage_entry_claim_date;

-- Single-row system settings (id is always 1)
CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY,
  auto_sync_enabled TINYINT(1) NOT NULL DEFAULT 0,
  sync_interval_minutes INT NOT NULL DEFAULT 60,
  last_sync_at DATETIME NULL,
  last_sync_status VARCHAR(20) NULL,
  last_sync_message VARCHAR(500) NULL,
  -- automatic company-wide attendance import (lib/companyImport.ts), runs once a day at import_hour
  auto_import_enabled TINYINT(1) NOT NULL DEFAULT 0,
  import_hour TINYINT NOT NULL DEFAULT 1,
  last_import_at DATETIME NULL,
  last_import_status VARCHAR(20) NULL,
  last_import_message VARCHAR(500) NULL
);
-- Upgrade: ALTER TABLE app_settings ADD COLUMN auto_import_enabled TINYINT(1) NOT NULL DEFAULT 0,
--   ADD COLUMN import_hour TINYINT NOT NULL DEFAULT 1, ADD COLUMN last_import_at DATETIME NULL,
--   ADD COLUMN last_import_status VARCHAR(20) NULL, ADD COLUMN last_import_message VARCHAR(500) NULL;
-- Upgrade: the auto import used to run on a fixed interval (import_interval_minutes); it now runs
--   once a day at a chosen hour instead: ALTER TABLE app_settings ADD COLUMN import_hour TINYINT NOT NULL
--   DEFAULT 1 AFTER auto_import_enabled, DROP COLUMN import_interval_minutes;

INSERT IGNORE INTO app_settings (id) VALUES (1);
