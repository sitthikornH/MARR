-- Project MARR database structure, MARR-V.4
-- Dumped 2026-11-12 08:56:51 UTC from marr_db (MySQL 8.4.11) by scripts/dump-schema.mjs.
-- Structure only, no data. Restore into an empty server: mysql -u root -p < this file

CREATE DATABASE IF NOT EXISTS `marr_db` DEFAULT CHARACTER SET utf8mb4;
USE `marr_db`;

SET FOREIGN_KEY_CHECKS = 0;

-- app_settings
CREATE TABLE IF NOT EXISTS `app_settings` (
  `id` int NOT NULL,
  `auto_sync_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `sync_interval_minutes` int NOT NULL DEFAULT '60',
  `last_sync_at` datetime DEFAULT NULL,
  `last_sync_status` varchar(20) DEFAULT NULL,
  `last_sync_message` varchar(500) DEFAULT NULL,
  `auto_import_enabled` tinyint(1) NOT NULL DEFAULT '0',
  `import_interval_minutes` int NOT NULL DEFAULT '1440',
  `last_import_at` datetime DEFAULT NULL,
  `last_import_status` varchar(20) DEFAULT NULL,
  `last_import_message` varchar(500) DEFAULT NULL,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- attendance
CREATE TABLE IF NOT EXISTS `attendance` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `date` date NOT NULL,
  `time_in` time DEFAULT NULL,
  `time_out` time DEFAULT NULL,
  `location_name` varchar(100) DEFAULT NULL,
  `leave_type` varchar(50) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_attendance_employee_date` (`employee_id`,`date`),
  CONSTRAINT `fk_attendance_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- attendance_report
CREATE TABLE IF NOT EXISTS `attendance_report` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `emp_code` varchar(255) NOT NULL,
  `employee_name` varchar(255) NOT NULL,
  `position` varchar(255) DEFAULT NULL,
  `date` date NOT NULL,
  `start_work_at` time DEFAULT NULL,
  `get_off_work_at` time DEFAULT NULL,
  `time_in` time DEFAULT NULL,
  `time_out` time DEFAULT NULL,
  `notice` varchar(500) DEFAULT NULL,
  `overtime_request_history` text,
  `place` varchar(255) DEFAULT NULL,
  `row_type` varchar(20) NOT NULL,
  `checklog_id` varchar(50) DEFAULT NULL,
  `day_type` varchar(20) NOT NULL DEFAULT 'workday',
  `holiday_name` varchar(255) DEFAULT NULL,
  `department` varchar(255) DEFAULT NULL,
  `approver_code` varchar(255) DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_attendance_report_employee_date` (`employee_id`,`date`),
  CONSTRAINT `fk_attendance_report_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- employees
CREATE TABLE IF NOT EXISTS `employees` (
  `id` int NOT NULL AUTO_INCREMENT,
  `emp_code` varchar(20) NOT NULL,
  `name` varchar(100) NOT NULL,
  `base_allowance` decimal(10,2) NOT NULL DEFAULT '0.00',
  `base_ot_rate` decimal(10,2) NOT NULL DEFAULT '0.00',
  `return_home_rate` decimal(10,2) NOT NULL DEFAULT '0.00',
  `work_shift` varchar(11) NOT NULL DEFAULT '08:00-17:00',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `emp_code` (`emp_code`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- location_rates
CREATE TABLE IF NOT EXISTS `location_rates` (
  `id` int NOT NULL AUTO_INCREMENT,
  `location_name` varchar(100) NOT NULL,
  `travel_fee` decimal(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  UNIQUE KEY `location_name` (`location_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- login_history
CREATE TABLE IF NOT EXISTS `login_history` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int DEFAULT NULL,
  `username` varchar(100) NOT NULL,
  `employee_name` varchar(100) DEFAULT NULL,
  `role` varchar(10) NOT NULL,
  `event` varchar(10) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `fk_login_history_user` (`user_id`),
  KEY `idx_login_history_created` (`created_at`),
  CONSTRAINT `fk_login_history_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- mileage_claim
CREATE TABLE IF NOT EXISTS `mileage_claim` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `month` int NOT NULL,
  `year` int NOT NULL,
  `rate_per_km` decimal(10,2) NOT NULL DEFAULT '5.00',
  `telephone_amount` decimal(10,2) DEFAULT NULL,
  `remarks` text,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mileage_claim_employee_month_year` (`employee_id`,`month`,`year`),
  CONSTRAINT `fk_mileage_claim_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- mileage_entry
CREATE TABLE IF NOT EXISTS `mileage_entry` (
  `id` int NOT NULL AUTO_INCREMENT,
  `claim_id` int NOT NULL,
  `date` date NOT NULL,
  `seq` int NOT NULL DEFAULT '1',
  `time` varchar(20) DEFAULT NULL,
  `from_place` varchar(255) DEFAULT NULL,
  `to_place` varchar(255) DEFAULT NULL,
  `km` decimal(10,2) NOT NULL DEFAULT '0.00',
  `site` varchar(100) DEFAULT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_mileage_entry_claim_date_seq` (`claim_id`,`date`,`seq`),
  CONSTRAINT `fk_mileage_entry_claim` FOREIGN KEY (`claim_id`) REFERENCES `mileage_claim` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- mileage_other_item
CREATE TABLE IF NOT EXISTS `mileage_other_item` (
  `id` int NOT NULL AUTO_INCREMENT,
  `claim_id` int NOT NULL,
  `description` varchar(255) NOT NULL,
  `period` varchar(50) DEFAULT NULL,
  `amount` decimal(10,2) NOT NULL DEFAULT '0.00',
  PRIMARY KEY (`id`),
  KEY `fk_mileage_other_item_claim` (`claim_id`),
  CONSTRAINT `fk_mileage_other_item_claim` FOREIGN KEY (`claim_id`) REFERENCES `mileage_claim` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- overtime_added_at
CREATE TABLE IF NOT EXISTS `overtime_added_at` (
  `overtime_id` varchar(50) NOT NULL,
  `employee_id` int NOT NULL,
  `requested_at` datetime NOT NULL,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`overtime_id`),
  KEY `idx_overtime_added_at_employee` (`employee_id`),
  CONSTRAINT `fk_overtime_added_at_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- overtime_request
CREATE TABLE IF NOT EXISTS `overtime_request` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `overtime_id` varchar(50) NOT NULL,
  `date` date NOT NULL,
  `time_start` time NOT NULL,
  `time_end` time NOT NULL,
  `minutes` int NOT NULL DEFAULT '0',
  `overtime_type` varchar(50) DEFAULT NULL,
  `day_type` varchar(50) DEFAULT NULL,
  `reason` varchar(500) DEFAULT NULL,
  `status` varchar(20) NOT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_overtime_request_id` (`overtime_id`),
  KEY `idx_overtime_request_employee_date` (`employee_id`,`date`),
  CONSTRAINT `fk_overtime_request_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- sessions
CREATE TABLE IF NOT EXISTS `sessions` (
  `id` int NOT NULL AUTO_INCREMENT,
  `user_id` int NOT NULL,
  `token_hash` char(64) NOT NULL,
  `expires_at` datetime NOT NULL,
  `last_active_at` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `token_hash` (`token_hash`),
  KEY `fk_sessions_user` (`user_id`),
  CONSTRAINT `fk_sessions_user` FOREIGN KEY (`user_id`) REFERENCES `users` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- time_adjustment_request
CREATE TABLE IF NOT EXISTS `time_adjustment_request` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `record_no` varchar(50) NOT NULL,
  `emp_code` varchar(255) NOT NULL,
  `employee_name` varchar(255) DEFAULT NULL,
  `position` varchar(255) DEFAULT NULL,
  `employee_group` varchar(255) DEFAULT NULL,
  `date` date NOT NULL,
  `from_time_in` varchar(8) DEFAULT NULL,
  `from_time_out` varchar(8) DEFAULT NULL,
  `to_time_in` varchar(8) DEFAULT NULL,
  `to_time_out` varchar(8) DEFAULT NULL,
  `reason` varchar(1000) DEFAULT NULL,
  `place` varchar(255) DEFAULT NULL,
  `added_by` varchar(255) DEFAULT NULL,
  `created_date` varchar(30) DEFAULT NULL,
  `status` varchar(50) DEFAULT NULL,
  `image_url` varchar(1000) DEFAULT NULL,
  `source_report_id` varchar(50) DEFAULT NULL,
  `record_type` varchar(100) DEFAULT NULL,
  `system_owner` varchar(255) DEFAULT NULL,
  `approver` varchar(255) DEFAULT NULL,
  `approval_type` varchar(100) DEFAULT NULL,
  `imported_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_time_adjustment_record_no` (`record_no`),
  KEY `idx_time_adjustment_employee_date` (`employee_id`,`date`),
  CONSTRAINT `fk_time_adjustment_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- users
CREATE TABLE IF NOT EXISTS `users` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int DEFAULT NULL,
  `username` varchar(100) NOT NULL,
  `password_hash` varchar(255) DEFAULT NULL,
  `role` varchar(10) NOT NULL DEFAULT 'user',
  `must_change_password` tinyint(1) NOT NULL DEFAULT '1',
  `failed_attempts` int NOT NULL DEFAULT '0',
  `locked_until` datetime DEFAULT NULL,
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `username` (`username`),
  UNIQUE KEY `employee_id` (`employee_id`),
  CONSTRAINT `fk_users_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- welfare_summary
CREATE TABLE IF NOT EXISTS `welfare_summary` (
  `id` int NOT NULL AUTO_INCREMENT,
  `employee_id` int NOT NULL,
  `month` int NOT NULL,
  `year` int NOT NULL,
  `total_allowance` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_travel` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_ot` decimal(10,2) NOT NULL DEFAULT '0.00',
  `total_return_home` decimal(10,2) NOT NULL DEFAULT '0.00',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uq_welfare_employee_month_year` (`employee_id`,`month`,`year`),
  CONSTRAINT `fk_welfare_employee` FOREIGN KEY (`employee_id`) REFERENCES `employees` (`id`) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- Single-row settings the app expects
INSERT IGNORE INTO app_settings (id) VALUES (1);
