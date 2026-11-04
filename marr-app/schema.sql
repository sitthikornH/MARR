-- Project MARR (HR Welfare) database schema
-- Run with: mysql -u root -p < schema.sql

CREATE DATABASE IF NOT EXISTS marr_db;
USE marr_db;

CREATE TABLE IF NOT EXISTS employees (
  id INT AUTO_INCREMENT PRIMARY KEY,
  emp_code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(100) NOT NULL,
  base_allowance DECIMAL(10,2) NOT NULL DEFAULT 0,
  base_ot_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
  return_home_rate DECIMAL(10,2) NOT NULL DEFAULT 0,
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
  role VARCHAR(10) NOT NULL DEFAULT 'user', -- 'user' | 'admin'
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  failed_attempts INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_users_employee FOREIGN KEY (employee_id)
    REFERENCES employees(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS sessions (
  id INT AUTO_INCREMENT PRIMARY KEY,
  user_id INT NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE, -- sha256 of the cookie token; the token itself is never stored
  expires_at DATETIME NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id)
    REFERENCES users(id) ON DELETE CASCADE
);

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
  -- automatic company-wide attendance import (lib/companyImport.ts)
  auto_import_enabled TINYINT(1) NOT NULL DEFAULT 0,
  import_interval_minutes INT NOT NULL DEFAULT 1440,
  last_import_at DATETIME NULL,
  last_import_status VARCHAR(20) NULL,
  last_import_message VARCHAR(500) NULL
);
-- Upgrade: ALTER TABLE app_settings ADD COLUMN auto_import_enabled TINYINT(1) NOT NULL DEFAULT 0,
--   ADD COLUMN import_interval_minutes INT NOT NULL DEFAULT 1440, ADD COLUMN last_import_at DATETIME NULL,
--   ADD COLUMN last_import_status VARCHAR(20) NULL, ADD COLUMN last_import_message VARCHAR(500) NULL;

INSERT IGNORE INTO app_settings (id) VALUES (1);
