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

-- Upgrade for databases whose attendance_report predates the columns above
-- (run once; MySQL errors if a column already exists, which is safe to ignore):
-- ALTER TABLE attendance_report
--   ADD COLUMN day_type VARCHAR(20) NOT NULL DEFAULT 'workday' AFTER checklog_id,
--   ADD COLUMN holiday_name VARCHAR(255) NULL AFTER day_type,
--   ADD COLUMN department VARCHAR(255) NULL AFTER holiday_name,
--   ADD COLUMN approver_code VARCHAR(255) NULL AFTER department;

-- Single-row system settings (id is always 1)
CREATE TABLE IF NOT EXISTS app_settings (
  id INT PRIMARY KEY,
  auto_sync_enabled TINYINT(1) NOT NULL DEFAULT 0,
  sync_interval_minutes INT NOT NULL DEFAULT 60,
  last_sync_at DATETIME NULL,
  last_sync_status VARCHAR(20) NULL,
  last_sync_message VARCHAR(500) NULL
);

INSERT IGNORE INTO app_settings (id) VALUES (1);
