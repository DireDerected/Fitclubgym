<?php
// Database configuration
$db_host='127.0.0.1';
$db_name='fitclub_gym';
$db_user='root';
$db_pass='';
$dsn="mysql:host=$db_host;dbname=$db_name;charset=utf8mb4";

// EMAIL CONFIGURATION - GMAIL SMTP
// -----------------------------------------------------------------------------
$use_email = true;

if ($use_email) {
    if (!defined('SMTP_HOST')) define('SMTP_HOST', 'smtp.gmail.com');
    if (!defined('SMTP_PORT')) define('SMTP_PORT', 587);
    if (!defined('SMTP_USER')) define('SMTP_USER', 'crisostomo1412i@gmail.com');
    if (!defined('SMTP_PASS')) define('SMTP_PASS', 'jsde oujb ssaj twis');
    if (!defined('SMTP_FROM')) define('SMTP_FROM', 'crisostomo1412i@gmail.com');
    if (!defined('SMTP_FROM_NAME')) define('SMTP_FROM_NAME', 'Fitclub Gym');
}

try {
    $pdo=new PDO($dsn,$db_user,$db_pass,[
        PDO::ATTR_ERRMODE=>PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE=>PDO::FETCH_ASSOC,
        PDO::ATTR_EMULATE_PREPARES=>false
    ]);

    // Auto-migration for password_reset_tokens table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'password_reset_tokens'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE password_reset_tokens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id CHAR(36) NOT NULL,
            token VARCHAR(6) NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_token_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE
        )");
    }

    // Auto-migration for system_settings table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'system_settings'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE system_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            settings_key VARCHAR(50) NOT NULL UNIQUE,
            settings_value TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        )");
    }

    // Auto-migration for notifications table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'notifications'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id CHAR(36) NOT NULL,
            title VARCHAR(100) NOT NULL,
            message TEXT NOT NULL,
            type ENUM('onsite', 'expiry', 'report', 'system') NOT NULL,
            is_read TINYINT(1) DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE
        )");
    }

    // Auto-migration for coaches table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'coaches'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE coaches (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id CHAR(36) NOT NULL,
            credentials TEXT,
            habits TEXT,
            max_trainees INT DEFAULT 10,
            credentials_image VARCHAR(255) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_coach_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        )");
    } else {
        $checkCol = $pdo->query("SHOW COLUMNS FROM coaches LIKE 'credentials_image'")->fetch();
        if (!$checkCol) {
            $pdo->exec("ALTER TABLE coaches ADD COLUMN credentials_image VARCHAR(255) NULL AFTER max_trainees");
        }
    }

    // Auto-migration for coach_credential_photos table (multiple credential images)
    $checkTable = $pdo->query("SHOW TABLES LIKE 'coach_credential_photos'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE coach_credential_photos (
            id INT AUTO_INCREMENT PRIMARY KEY,
            coach_id INT NOT NULL,
            image_path VARCHAR(255) NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_cred_photo_coach FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE
        )");
        // Migrate existing single credentials_image into the new table
        $migrate = $pdo->query("SELECT c.id AS coach_id, c.credentials_image FROM coaches c WHERE c.credentials_image IS NOT NULL AND c.credentials_image <> ''")->fetchAll();
        foreach ($migrate as $row) {
            $stmt = $pdo->prepare("INSERT INTO coach_credential_photos (coach_id, image_path) VALUES (?, ?)");
            $stmt->execute([$row['coach_id'], $row['credentials_image']]);
        }
    }

    // Auto-migration for coach_availability table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'coach_availability'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE coach_availability (
            id INT AUTO_INCREMENT PRIMARY KEY,
            coach_id INT NOT NULL,
            available_date DATE NOT NULL,
            status ENUM('Available', 'Unavailable') DEFAULT 'Available',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_avail_coach FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE,
            UNIQUE(coach_id, available_date)
        )");
    }

    // Auto-migration for coaching_assignments table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'coaching_assignments'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE coaching_assignments (
            id INT AUTO_INCREMENT PRIMARY KEY,
            coach_id INT NOT NULL,
            member_id CHAR(36) NOT NULL,
            status ENUM('Pending', 'Active', 'Completed', 'Rejected') DEFAULT 'Pending',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_assign_coach FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE,
            CONSTRAINT fk_assign_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        )");
    } else {
        $statusColumn = $pdo->query("SHOW COLUMNS FROM coaching_assignments LIKE 'status'")->fetch();
        if ($statusColumn && strpos($statusColumn['Type'], "'Rejected'") === false) {
            $pdo->exec("ALTER TABLE coaching_assignments MODIFY COLUMN status ENUM('Pending', 'Active', 'Completed', 'Rejected') DEFAULT 'Pending'");
        }
    }

    // Auto-migration for workout_routines table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'workout_routines'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE workout_routines (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id CHAR(36) NOT NULL,
            routine_name VARCHAR(100) NOT NULL,
            routine_data JSON NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_routine_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        )");
    }

    // Auto-migration for reports table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'reports'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE reports (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id CHAR(36) NOT NULL,
            category VARCHAR(50) NOT NULL,
            issue TEXT NOT NULL,
            status ENUM('Pending', 'Resolved', 'In Progress') DEFAULT 'Pending',
            resolution TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_report_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE
        )");
    } else {
        // Check if reports table has resolution column (added in previous fix)
        $checkColumn = $pdo->query("SHOW COLUMNS FROM reports LIKE 'resolution'")->fetch();
        if (!$checkColumn) {
            $pdo->exec("ALTER TABLE reports ADD COLUMN resolution TEXT NULL AFTER status");
        }
    }

    // Auto-migration for subscriptions table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'subscriptions'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE subscriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id CHAR(36) NOT NULL,
            start_date DATE NOT NULL,
            duration_days INT NOT NULL,
            expires_on DATE NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_sub_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        )");
    }

    // Auto-migration for attendance table
    $checkTable = $pdo->query("SHOW TABLES LIKE 'attendance'")->fetch();
    if (!$checkTable) {
        $pdo->exec("CREATE TABLE attendance (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id CHAR(36) NOT NULL,
            check_in DATETIME NOT NULL,
            check_out DATETIME DEFAULT NULL,
            duration_minutes INT DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_att_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
            INDEX idx_att_member_date (member_id, check_in)
        )");
    }

    // Auto-migration: Add missing columns to members table
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'email'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN email VARCHAR(255) NULL AFTER medical_condition");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'phone'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN phone VARCHAR(50) NULL AFTER email");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'address'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN address TEXT NULL AFTER phone");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_question_1'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_question_1 VARCHAR(255) NULL AFTER address");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_answer_1'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_answer_1 VARCHAR(255) NULL AFTER security_question_1");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_question_2'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_question_2 VARCHAR(255) NULL AFTER security_answer_1");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_answer_2'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_answer_2 VARCHAR(255) NULL AFTER security_question_2");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_question_3'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_question_3 VARCHAR(255) NULL AFTER security_answer_2");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_answer_3'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_answer_3 VARCHAR(255) NULL AFTER security_question_3");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_question_4'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_question_4 VARCHAR(255) NULL AFTER security_answer_3");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_answer_4'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_answer_4 VARCHAR(255) NULL AFTER security_question_4");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_question'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_question VARCHAR(255) NULL AFTER security_answer_4");
    }
    $check_columns = $pdo->query("SHOW COLUMNS FROM members LIKE 'security_answer'")->fetch();
    if (!$check_columns) {
        $pdo->exec("ALTER TABLE members ADD COLUMN security_answer VARCHAR(255) NULL AFTER security_question");
    }

    // Update role enum to include Temporary
    $role_column = $pdo->query("SHOW COLUMNS FROM members LIKE 'role'")->fetch();
    if ($role_column && strpos($role_column['Type'], 'Temporary') === false) {
        $pdo->exec("ALTER TABLE members MODIFY COLUMN role ENUM('Member', 'Coach', 'Staff', 'Admin', 'Temporary') NOT NULL DEFAULT 'Member'");
    }

    // Update subscriptions table's expires_on column to allow NULL (for coaches/staff/temporary)
    $sub_column = $pdo->query("SHOW COLUMNS FROM subscriptions LIKE 'expires_on'")->fetch();
    if ($sub_column && strpos($sub_column['Type'], 'NOT NULL') !== false) {
        $pdo->exec("ALTER TABLE subscriptions MODIFY COLUMN expires_on DATE NULL");
    }

    // Auto-migration for email_logs table (individually hardened)
    try {
        $checkTable = $pdo->query("SHOW TABLES LIKE 'email_logs'")->fetch();
        if (!$checkTable) {
            $pdo->exec("CREATE TABLE email_logs (
                id INT AUTO_INCREMENT PRIMARY KEY,
                recipient_email VARCHAR(255) NOT NULL,
                subject VARCHAR(255) NOT NULL,
                body TEXT NULL,
                status ENUM('pending','sent','failed') DEFAULT 'pending',
                error_message TEXT NULL,
                sent_at DATETIME NULL,
                created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_logs_status (status),
                INDEX idx_logs_sent (sent_at),
                INDEX idx_logs_created (created_at)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        } else {
            $checkCol = $pdo->query("SHOW COLUMNS FROM email_logs LIKE 'created_at'")->fetch();
            if (!$checkCol) {
                $pdo->exec("ALTER TABLE email_logs ADD COLUMN created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER sent_at");
                $pdo->exec("ALTER TABLE email_logs ADD INDEX idx_logs_created (created_at)");
            }
        }
    } catch (Exception $e) {
        error_log("email_logs migration skipped: " . $e->getMessage());
    }

    // Auto-migration for email_notifications_sent table (individually hardened, no FK)
    try {
        $checkTable = $pdo->query("SHOW TABLES LIKE 'email_notifications_sent'")->fetch();
        if (!$checkTable) {
            $pdo->exec("CREATE TABLE email_notifications_sent (
                id INT AUTO_INCREMENT PRIMARY KEY,
                member_id CHAR(36) NOT NULL,
                notification_type ENUM('renewal','expiry_3d','expiry_1d','expired','welcome') NOT NULL,
                subscription_id INT NULL,
                target_date DATE NOT NULL,
                start_date DATE NULL,
                sent_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                UNIQUE KEY uniq_notif (member_id, notification_type, subscription_id, target_date),
                INDEX idx_enotif_member (member_id),
                INDEX idx_enotif_type (notification_type)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        } else {
            // Ensure start_date column exists (added for renewal duplicate-check accuracy)
            $col = $pdo->query("SHOW COLUMNS FROM email_notifications_sent LIKE 'start_date'")->fetch();
            if (!$col) {
                $pdo->exec("ALTER TABLE email_notifications_sent ADD COLUMN start_date DATE NULL AFTER target_date");
            }
        }
    } catch (Exception $e) {
        error_log("email_notifications_sent migration skipped: " . $e->getMessage());
    }

    // Auto-migration: login_attempts table for staff/admin login rate limiting
    try {
        $checkLoginAttempts = $pdo->query("SHOW TABLES LIKE 'login_attempts'")->fetch();
        if (!$checkLoginAttempts) {
            $pdo->exec("CREATE TABLE login_attempts (
                id INT AUTO_INCREMENT PRIMARY KEY,
                username VARCHAR(100) NOT NULL,
                ip_address VARCHAR(45) NOT NULL,
                attempts INT NOT NULL DEFAULT 0,
                last_attempt DATETIME NULL,
                locked_until DATETIME NULL,
                UNIQUE KEY uniq_user_ip (username, ip_address),
                INDEX idx_locked_until (locked_until)
            ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci");
        }
    } catch (Exception $e) {
        error_log("login_attempts migration skipped: " . $e->getMessage());
    }

    // Auto-generate cron secret key if not exists (individually hardened)
    try {
        $cronKeyStmt = $pdo->prepare("SELECT settings_value FROM system_settings WHERE settings_key = 'cron_secret_key' LIMIT 1");
        $cronKeyStmt->execute();
        $cronKey = $cronKeyStmt->fetchColumn();
        if (!$cronKey) {
            $newKey = bin2hex(random_bytes(24));
            $pdo->prepare("INSERT INTO system_settings (settings_key, settings_value) VALUES ('cron_secret_key', ?) ON DUPLICATE KEY UPDATE settings_value = VALUES(settings_value)")->execute([$newKey]);
        }
    } catch (Exception $e) {
        error_log("cron_secret_key init skipped: " . $e->getMessage());
    }

    // Load emailer ONLY AFTER all DB migrations succeed (so functions are available)
    require_once __DIR__ . '/emailer.php';

} catch (PDOException $e) {
    http_response_code(500);
    echo 'DB_ERROR';
    exit;
}
?>
