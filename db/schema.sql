CREATE DATABASE IF NOT EXISTS fitclub_gym CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE fitclub_gym;

CREATE TABLE IF NOT EXISTS members (
    id CHAR(36) PRIMARY KEY,
    rfid VARCHAR(50) UNIQUE NULL,
    username VARCHAR(50) UNIQUE NULL,
    password VARCHAR(255) NULL,
    name VARCHAR(100) NOT NULL,
    gender VARCHAR(10) NOT NULL,
    age INT NOT NULL,
    role ENUM('Member', 'Coach', 'Staff', 'Admin', 'Temporary') NOT NULL DEFAULT 'Member',
    status ENUM('Active', 'Deactivated', 'Expired') NOT NULL DEFAULT 'Active',
    deactivation_reason TEXT NULL,
    profile_image VARCHAR(255) NULL,
    medical_condition TEXT NULL,
    email VARCHAR(255) NULL,
    phone VARCHAR(50) NULL,
    address TEXT NULL,
    security_question_1 VARCHAR(255) NULL,
    security_answer_1 VARCHAR(255) NULL,
    security_question_2 VARCHAR(255) NULL,
    security_answer_2 VARCHAR(255) NULL,
    security_question_3 VARCHAR(255) NULL,
    security_answer_3 VARCHAR(255) NULL,
    security_question_4 VARCHAR(255) NULL,
    security_answer_4 VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notifications (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    title VARCHAR(100) NOT NULL,
    message TEXT NOT NULL,
    type ENUM('onsite', 'expiry', 'report', 'system') NOT NULL,
    is_read TINYINT(1) DEFAULT 0,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coaches (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id CHAR(36) NOT NULL,
    credentials TEXT,
    habits TEXT,
    max_trainees INT DEFAULT 10,
    credentials_image VARCHAR(255) NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_coach_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coach_availability (
    id INT AUTO_INCREMENT PRIMARY KEY,
    coach_id INT NOT NULL,
    available_date DATE NOT NULL,
    status ENUM('Available', 'Unavailable') DEFAULT 'Available',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_avail_coach FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE,
    UNIQUE(coach_id, available_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS coaching_assignments (
    id INT AUTO_INCREMENT PRIMARY KEY,
    coach_id INT NOT NULL,
    member_id CHAR(36) NOT NULL,
    status ENUM('Pending', 'Active', 'Completed', 'Rejected') DEFAULT 'Pending',
    coach_assessment_rating TINYINT NULL,
    coach_assessment_feedback TEXT NULL,
    member_rating TINYINT NULL,
    member_feedback TEXT NULL,
    completed_at DATETIME NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_assign_coach FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE,
    CONSTRAINT fk_assign_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS workout_routines (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id CHAR(36) NOT NULL,
    routine_name VARCHAR(100) NOT NULL,
    day_of_week ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') NULL,
    assigned_by_coach_id INT NULL,
    routine_data JSON NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_routine_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reports (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    category VARCHAR(50) NOT NULL,
    issue TEXT NOT NULL,
    status ENUM('Pending', 'Resolved', 'In Progress') DEFAULT 'Pending',
    resolution TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_report_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id CHAR(36) NOT NULL,
    start_date DATE NOT NULL,
    duration_days INT NOT NULL,
    expires_on DATE NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_sub_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS attendance (
    id INT AUTO_INCREMENT PRIMARY KEY,
    member_id CHAR(36) NOT NULL,
    check_in DATETIME NOT NULL,
    check_out DATETIME DEFAULT NULL,
    duration_minutes INT DEFAULT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_att_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
    INDEX idx_att_member_date (member_id, check_in)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS password_reset_tokens (
    id INT AUTO_INCREMENT PRIMARY KEY,
    user_id CHAR(36) NOT NULL,
    token VARCHAR(6) NOT NULL,
    expires_at DATETIME NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT fk_token_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    settings_key VARCHAR(50) NOT NULL UNIQUE,
    settings_value TEXT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
