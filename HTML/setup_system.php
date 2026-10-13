<?php
/**
 * Fitclub Gym - System Setup & Migration Script
 * Optimized for cross-device functionality and professional UI.
 */

date_default_timezone_set('Asia/Manila');
require __DIR__.'/config.php';

// Helper for UUID v4 generation
function uuidv4() {
    $data = random_bytes(16);
    $data[6] = chr((ord($data[6]) & 0x0f) | 0x40);
    $data[8] = chr((ord($data[8]) & 0x3f) | 0x80);
    return vsprintf('%s%s-%s-%s-%s-%s%s%s', str_split(bin2hex($data), 4));
}

$results = [];
$error = null;

try {
    // 1. Define all necessary tables
    $tables = [
        "members" => "CREATE TABLE IF NOT EXISTS members (
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
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "notifications" => "CREATE TABLE IF NOT EXISTS notifications (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id CHAR(36) NOT NULL,
            title VARCHAR(100) NOT NULL,
            message TEXT NOT NULL,
            type ENUM('onsite', 'expiry', 'report', 'system') NOT NULL,
            is_read TINYINT(1) DEFAULT 0,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_notif_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "coaches" => "CREATE TABLE IF NOT EXISTS coaches (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id CHAR(36) NOT NULL,
            credentials TEXT,
            habits TEXT,
            max_trainees INT DEFAULT 10,
            credentials_image VARCHAR(255) NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_coach_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "coach_availability" => "CREATE TABLE IF NOT EXISTS coach_availability (
            id INT AUTO_INCREMENT PRIMARY KEY,
            coach_id INT NOT NULL,
            available_date DATE NOT NULL,
            status ENUM('Available', 'Unavailable') DEFAULT 'Available',
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_avail_coach FOREIGN KEY (coach_id) REFERENCES coaches(id) ON DELETE CASCADE,
            UNIQUE(coach_id, available_date)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "coaching_assignments" => "CREATE TABLE IF NOT EXISTS coaching_assignments (
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
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "workout_routines" => "CREATE TABLE IF NOT EXISTS workout_routines (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id CHAR(36) NOT NULL,
            routine_name VARCHAR(100) NOT NULL,
            day_of_week ENUM('Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday') NULL,
            assigned_by_coach_id INT NULL,
            routine_data JSON NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_routine_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "reports" => "CREATE TABLE IF NOT EXISTS reports (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id CHAR(36) NOT NULL,
            category VARCHAR(50) NOT NULL,
            issue TEXT NOT NULL,
            status ENUM('Pending', 'Resolved', 'In Progress') DEFAULT 'Pending',
            resolution TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_report_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "subscriptions" => "CREATE TABLE IF NOT EXISTS subscriptions (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id CHAR(36) NOT NULL,
            start_date DATE NOT NULL,
            duration_days INT NOT NULL,
            expires_on DATE NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_sub_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "attendance" => "CREATE TABLE IF NOT EXISTS attendance (
            id INT AUTO_INCREMENT PRIMARY KEY,
            member_id CHAR(36) NOT NULL,
            check_in DATETIME NOT NULL,
            check_out DATETIME DEFAULT NULL,
            duration_minutes INT DEFAULT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_att_member FOREIGN KEY (member_id) REFERENCES members(id) ON DELETE CASCADE,
            INDEX idx_att_member_date (member_id, check_in)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "password_reset_tokens" => "CREATE TABLE IF NOT EXISTS password_reset_tokens (
            id INT AUTO_INCREMENT PRIMARY KEY,
            user_id CHAR(36) NOT NULL,
            token VARCHAR(6) NOT NULL,
            expires_at DATETIME NOT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            CONSTRAINT fk_token_user FOREIGN KEY (user_id) REFERENCES members(id) ON DELETE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci",
        "system_settings" => "CREATE TABLE IF NOT EXISTS system_settings (
            id INT AUTO_INCREMENT PRIMARY KEY,
            settings_key VARCHAR(50) NOT NULL UNIQUE,
            settings_value TEXT NULL,
            created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci"
    ];

    foreach ($tables as $name => $sql) {
        $pdo->exec($sql);
        $results[] = "Table '$name' is ready.";
    }

    // 2. Ensure at least one Admin exists
    $admin_exists = $pdo->query("SELECT COUNT(*) FROM members WHERE role='Admin'")->fetchColumn();
    if (!$admin_exists) {
        $admin_id = uuidv4();
        $admin_user = 'admin';
        $admin_pass = password_hash('Admin123!', PASSWORD_DEFAULT);
        $pdo->prepare("INSERT INTO members (id, username, password, name, gender, age, role, status) VALUES (?, ?, ?, 'System Admin', 'Other', 30, 'Admin', 'Active')")
            ->execute([$admin_id, $admin_user, $admin_pass]);
        $results[] = "Default admin account created (User: admin / Pass: Admin123!).";
    }

    // 3. Generate Temporary Members (Ensuring 20 exist)
    $temp_count = $pdo->query("SELECT COUNT(*) FROM members WHERE role='Temporary'")->fetchColumn();
    if ($temp_count < 20) {
        $needed = 20 - $temp_count;
        for ($i = 0; $i < $needed; $i++) {
            $id = uuidv4();
            $rfid = 'TEMP-' . str_pad(mt_rand(0, 999999), 6, '0', STR_PAD_LEFT);
            $name = "Temp User " . ($temp_count + $i + 1);
            
            $pdo->prepare("INSERT INTO members (id, rfid, name, gender, age, role, status) VALUES (?, ?, ?, 'Other', 25, 'Temporary', 'Active')")
                ->execute([$id, $rfid, $name]);
                
            $pdo->prepare("INSERT INTO subscriptions (member_id, start_date, duration_days, expires_on) VALUES (?, CURDATE(), 9999, NULL)")
                ->execute([$id]);
        }
        $results[] = "Generated $needed temporary members.";
    } else {
        $results[] = "Temporary members are already populated (Count: $temp_count).";
    }

    $results[] = "System setup completed successfully.";

} catch (PDOException $e) {
    $error = $e->getMessage();
}
?>
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>System Setup | Fitclub Gym</title>
    <link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/bootstrap-icons@1.11.0/font/bootstrap-icons.css">
    <style>
        :root {
            --gold: #D4AF37;
            --silver: #C0C0C0;
            --dark: #1a1a1a;
        }
        body {
            background-color: #f4f4f4;
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            margin: 0;
            padding: 20px;
        }
        .setup-card {
            background: white;
            border-radius: 15px;
            box-shadow: 0 10px 30px rgba(0,0,0,0.1);
            max-width: 600px;
            width: 100%;
            overflow: hidden;
            border-top: 5px solid var(--gold);
        }
        .setup-header {
            background: var(--silver);
            padding: 30px;
            text-align: center;
            border-bottom: 2px solid var(--gold);
        }
        .setup-header h1 {
            margin: 0;
            font-weight: 800;
            color: var(--dark);
            letter-spacing: 1px;
            text-transform: uppercase;
        }
        .setup-body {
            padding: 40px;
        }
        .log-item {
            padding: 10px 15px;
            border-left: 3px solid var(--gold);
            background: #f9f9f9;
            margin-bottom: 10px;
            font-size: 0.95rem;
            display: flex;
            align-items: center;
            gap: 10px;
        }
        .log-item i { color: var(--gold); }
        .error-box {
            background: #fff5f5;
            border-left: 3px solid #dc3545;
            padding: 15px;
            color: #dc3545;
            margin-bottom: 20px;
        }
        .btn-gold {
            background: var(--dark);
            color: var(--gold);
            border: 2px solid var(--gold);
            font-weight: bold;
            text-transform: uppercase;
            padding: 12px 30px;
            transition: all 0.3s;
            width: 100%;
            margin-top: 20px;
        }
        .btn-gold:hover {
            background: var(--gold);
            color: var(--dark);
        }
    </style>
</head>
<body>
    <div class="setup-card">
        <div class="setup-header">
            <h1><i class="bi bi-gear-fill me-2"></i>System Setup</h1>
        </div>
        <div class="setup-body">
            <?php if ($error): ?>
                <div class="error-box">
                    <h5 class="fw-bold"><i class="bi bi-exclamation-triangle-fill me-2"></i>Setup Failed</h5>
                    <p class="mb-0"><?php echo htmlspecialchars($error); ?></p>
                </div>
            <?php else: ?>
                <div class="mb-4">
                    <h5 class="fw-bold mb-3">Execution Logs:</h5>
                    <?php foreach ($results as $log): ?>
                        <div class="log-item">
                            <i class="bi bi-check-circle-fill"></i>
                            <span><?php echo htmlspecialchars($log); ?></span>
                        </div>
                    <?php endforeach; ?>
                </div>
                <div class="text-center text-success fw-bold">
                    <i class="bi bi-shield-check me-2"></i>Database is fully synchronized and ready for use.
                </div>
            <?php endif; ?>
            
            <a href="index.html" class="btn btn-gold">
                Go to Dashboard <i class="bi bi-arrow-right ms-2"></i>
            </a>
        </div>
        
    </div>

    <script>
        // RFID Hardware Scanner Integration
        let lastScanTime = 0;
        
        function pollForRFIDScans() {
            fetch('api.php?action=get_last_scan')
                .then(response => response.json())
                .then(data => {
                    if (data.status === 'success' && data.rfid && data.time > lastScanTime) {
                        lastScanTime = data.time;
                        showScanNotification(data.rfid);
                    }
                })
                .catch(err => console.log('RFID poll error:', err));
        }

        function showScanNotification(rfid) {
            console.log('RFID Scanned:', rfid);
            // Show a toast notification
            const notif = document.createElement('div');
            notif.className = 'alert alert-info alert-dismissible fade show';
            notif.style.cssText = 'position:fixed; top:20px; right:20px; z-index:9999; min-width:300px;';
            notif.innerHTML = `
                <i class="bi bi-rfid me-2"></i>
                <strong>RFID Detected:</strong> ${rfid}
                <button type="button" class="btn-close" data-bs-dismiss="alert"></button>
            `;
            document.body.appendChild(notif);
            
            setTimeout(() => notif.remove(), 5000);
        }

        // Start polling for RFID scans every second
        setInterval(pollForRFIDScans, 1000);
    </script>
</body>
</html>
