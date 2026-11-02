-- Seed data for Project MARR
-- Run with: mysql -u root -p marr_db < seed.sql
-- Assumes schema.sql has already been run.

USE marr_db;

-- 2 employees
INSERT INTO employees (emp_code, name, base_allowance, base_ot_rate, return_home_rate) VALUES
  ('EMP001', 'John Doe', 50.00, 15.00, 500.00),
  ('EMP002', 'Jane Smith', 55.00, 18.00, 600.00);

-- 3 location rates
INSERT INTO location_rates (location_name, travel_fee) VALUES
  ('Head Office', 20.00),
  ('Branch A', 35.00),
  ('Client Site', 50.00);

-- Dummy attendance for September 2026 (1 full month)
-- Employee 1 (id=1): near-full attendance with some overtime and one sick day.
INSERT INTO attendance (employee_id, date, time_in, time_out, location_name, leave_type) VALUES
  (1, '2026-09-01', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-02', '08:00:00', '18:30:00', 'Branch A', NULL),
  (1, '2026-09-03', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-04', '08:00:00', '19:00:00', 'Client Site', NULL),
  (1, '2026-09-07', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-08', '08:00:00', '17:30:00', 'Branch A', NULL),
  (1, '2026-09-09', NULL, NULL, NULL, 'Sick'),
  (1, '2026-09-10', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-11', '08:00:00', '18:00:00', 'Client Site', NULL),
  (1, '2026-09-14', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-15', '08:00:00', '17:00:00', 'Branch A', NULL),
  (1, '2026-09-16', '08:00:00', '19:30:00', 'Client Site', NULL),
  (1, '2026-09-17', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-18', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-21', '08:00:00', '17:00:00', 'Branch A', NULL),
  (1, '2026-09-22', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-23', '08:00:00', '18:00:00', 'Client Site', NULL),
  (1, '2026-09-24', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-25', '08:00:00', '17:00:00', 'Branch A', NULL),
  (1, '2026-09-28', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-29', '08:00:00', '17:00:00', 'Head Office', NULL),
  (1, '2026-09-30', '08:00:00', '17:30:00', 'Client Site', NULL);

-- Employee 2 (id=2): partial attendance (below 80% working-hours threshold) with some leave days.
INSERT INTO attendance (employee_id, date, time_in, time_out, location_name, leave_type) VALUES
  (2, '2026-09-01', '08:00:00', '17:00:00', 'Head Office', NULL),
  (2, '2026-09-02', NULL, NULL, NULL, 'Annual Leave'),
  (2, '2026-09-03', '08:00:00', '17:00:00', 'Head Office', NULL),
  (2, '2026-09-04', NULL, NULL, NULL, 'Annual Leave'),
  (2, '2026-09-07', '08:00:00', '17:00:00', 'Branch A', NULL),
  (2, '2026-09-08', NULL, NULL, NULL, 'Sick'),
  (2, '2026-09-09', NULL, NULL, NULL, 'Sick'),
  (2, '2026-09-10', '08:00:00', '17:00:00', 'Head Office', NULL),
  (2, '2026-09-11', '08:00:00', '17:00:00', 'Head Office', NULL),
  (2, '2026-09-14', NULL, NULL, NULL, 'Annual Leave'),
  (2, '2026-09-15', '08:00:00', '17:00:00', 'Branch A', NULL),
  (2, '2026-09-16', '08:00:00', '17:00:00', 'Head Office', NULL);
