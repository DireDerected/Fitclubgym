<?php
header('Content-Type: application/json');
session_start();
date_default_timezone_set('Asia/Manila');
require __DIR__.'/HTML/config.php';

$action = $_GET['action'] ?? '';
$response = ['status' => 'error', 'message' => 'Invalid action'];

function uuidv4(){ $data=random_bytes(16); $data[6]=chr((ord($data[6])&0x0f)|0x40); $data[8]=chr((ord($data[8])&0x3f)|0x80); return vsprintf('%s%s-%s-%s-%s-%s%s%s',str_split(bin2hex($data),4)); }
function generate_hex_rfid($nibbles=8){ $bytes=max(1,intval($nibbles/2)); return strtoupper(bin2hex(random_bytes($bytes))); }
function unique_hex_rfid(PDO $pdo, $nibbles=8){
  do {
    $candidate = generate_hex_rfid($nibbles);
    $stmt = $pdo->prepare('SELECT COUNT(*) FROM members WHERE rfid = ?');
    $stmt->execute([$candidate]);
    $exists = $stmt->fetchColumn() > 0;
  } while ($exists);
  return $candidate;
}

function validate_password($pass) {
    if (!$pass) return true;
    if (strlen($pass) < 8) return "Password must be at least 8 characters long.";
    if (!preg_match('/[!@#$%^&*(),.?":{}|<>]/', $pass)) return "Password must contain at least one special character.";
    if (!preg_match('/[0-9]/', $pass)) return "Password must contain at least one number.";
    return true;
}

// Helper function to update membership status to Expired if days left is 0
function updateExpiries(PDO $pdo) {
    try {
        // Update 'Active' members to 'Expired' if their subscription has ended
        // Coaches, Staff, and Admin roles do not expire
        $pdo->query("UPDATE members m 
                    JOIN (SELECT member_id, MAX(expires_on) as max_expires FROM subscriptions GROUP BY member_id) s 
                    ON m.id = s.member_id 
                    SET m.status = 'Expired' 
                    WHERE m.status = 'Active' 
                    AND m.role NOT IN ('Coach', 'Staff', 'Admin')
                    AND s.max_expires IS NOT NULL 
                    AND s.max_expires <= CURDATE()");
    } catch (Exception $e) {
        // Log error
    }
}

function fg_run_expiry_email_cron(PDO $pdo) {
    $results = [
        'expiry_3d' => ['checked' => 0, 'sent' => 0, 'failed' => 0, 'skipped' => 0],
        'expiry_1d' => ['checked' => 0, 'sent' => 0, 'failed' => 0, 'skipped' => 0],
        'expired' => ['checked' => 0, 'sent' => 0, 'failed' => 0, 'skipped' => 0],
        'errors' => []
    ];

    if (!defined('SMTP_HOST') || !SMTP_HOST) {
        $results['errors'][] = 'SMTP not configured';
        return $results;
    }

    $checks = [
        ['type' => 'expiry_3d', 'days' => 3, 'offset' => "DATE_ADD(CURDATE(), INTERVAL 3 DAY)"],
        ['type' => 'expiry_1d', 'days' => 1, 'offset' => "DATE_ADD(CURDATE(), INTERVAL 1 DAY)"],
        ['type' => 'expired', 'days' => 0, 'offset' => "CURDATE()"]
    ];

    foreach ($checks as $check) {
        try {
            $sql = "SELECT m.id, m.name, m.email, s.id as sub_id, s.expires_on
                    FROM (
                        SELECT member_id, MAX(id) as latest_id
                        FROM subscriptions
                        WHERE expires_on = {$check['offset']}
                        GROUP BY member_id
                    ) latest
                    JOIN subscriptions s ON s.id = latest.latest_id
                    JOIN members m ON m.id = latest.member_id
                    WHERE m.status IN ('Active', 'Expired')
                    AND m.role NOT IN ('Coach', 'Staff', 'Admin', 'Temporary')
                    AND m.email IS NOT NULL AND TRIM(m.email) != ''";
            $rows = $pdo->query($sql)->fetchAll();
            $results[$check['type']]['checked'] = count($rows);

            foreach ($rows as $row) {
                try {
                    if (!filter_var($row['email'], FILTER_VALIDATE_EMAIL)) {
                        $results[$check['type']]['skipped']++;
                        continue;
                    }

                    $targetDate = date('Y-m-d', strtotime($row['expires_on']));
                    $dupCheck = $pdo->prepare("SELECT id FROM email_notifications_sent 
                                                WHERE member_id = ? AND notification_type = ? 
                                                AND subscription_id = ? AND target_date = ? LIMIT 1");
                    $dupCheck->execute([$row['id'], $check['type'], $row['sub_id'], $targetDate]);
                    if ($dupCheck->fetch()) {
                        $results[$check['type']]['skipped']++;
                        continue;
                    }

                    $daysLeft = $check['days'];
                    if ($check['type'] === 'expired') {
                        $subject = "Your Fitclub Gym Membership Has Expired";
                        $body = fg_build_expiry_warning_email($row['name'], $row['expires_on'], 0);
                    } else {
                        $subject = "Your Fitclub Gym Membership Expires In {$daysLeft} Day(s)";
                        $body = fg_build_expiry_warning_email($row['name'], $row['expires_on'], $daysLeft);
                    }

                    $sendResult = fg_send_email($row['email'], $subject, $body, true);
                    if ($sendResult['success']) {
                        $pdo->prepare("INSERT INTO email_notifications_sent (member_id, notification_type, subscription_id, target_date) 
                                        VALUES (?, ?, ?, ?)")
                            ->execute([$row['id'], $check['type'], $row['sub_id'], $targetDate]);
                        $results[$check['type']]['sent']++;
                    } else {
                        $results[$check['type']]['failed']++;
                        $results['errors'][] = "{$check['type']} - {$row['email']}: " . ($sendResult['error'] ?? 'Unknown error');
                    }
                } catch (Exception $re) {
                    $results[$check['type']]['failed']++;
                    $results['errors'][] = "{$check['type']} - {$row['email']}: " . $re->getMessage();
                }
            }
        } catch (Exception $e) {
            $results['errors'][] = "Check {$check['type']}: " . $e->getMessage();
        }
    }
    return $results;
}

function ensureColumn(PDO $pdo, string $table, string $column, string $definition): void {
    $stmt = $pdo->prepare("SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ? AND COLUMN_NAME = ?");
    $stmt->execute([$table, $column]);
    if (!$stmt->fetchColumn()) {
        $pdo->exec("ALTER TABLE `$table` ADD COLUMN $definition");
    }
}

function ensureCoachingFeatureSchema(PDO $pdo): void {
    try {
        ensureColumn($pdo, 'workout_routines', 'day_of_week', "day_of_week ENUM('Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday') NULL AFTER routine_name");
        ensureColumn($pdo, 'workout_routines', 'assigned_by_coach_id', "assigned_by_coach_id INT NULL AFTER day_of_week");
        ensureColumn($pdo, 'coaching_assignments', 'coach_assessment_rating', "coach_assessment_rating TINYINT NULL AFTER status");
        ensureColumn($pdo, 'coaching_assignments', 'coach_assessment_feedback', "coach_assessment_feedback TEXT NULL AFTER coach_assessment_rating");
        ensureColumn($pdo, 'coaching_assignments', 'member_rating', "member_rating TINYINT NULL AFTER coach_assessment_feedback");
        ensureColumn($pdo, 'coaching_assignments', 'member_feedback', "member_feedback TEXT NULL AFTER member_rating");
        ensureColumn($pdo, 'coaching_assignments', 'completed_at', "completed_at DATETIME NULL AFTER member_feedback");
    } catch (Exception $e) {
        // Keep requests working even if automatic schema updates are unavailable.
    }
}

try {
    ensureCoachingFeatureSchema($pdo);
    switch ($action) {
    case 'login':
        updateExpiries($pdo);
        $data = json_decode(file_get_contents('php://input'), true);
        $username = trim($data['username'] ?? '');
        $password = $data['password'] ?? '';
        $clientIp = $_SERVER['REMOTE_ADDR'] ?? '0.0.0.0';
        $maxAttempts = 5;
        $lockMinutes = 15;

        if ($username && $password) {
            // --- Rate limit check ---
            $rateStmt = $pdo->prepare("SELECT attempts, locked_until FROM login_attempts WHERE username = ? AND ip_address = ?");
            $rateStmt->execute([$username, $clientIp]);
            $rate = $rateStmt->fetch();

            $attempts = $rate['attempts'] ?? 0;
            $lockedUntil = $rate['locked_until'] ?? null;

            // If a previous lock has expired, reset the counter so the user gets a fresh 5 attempts
            if ($lockedUntil && strtotime($lockedUntil) <= time()) {
                $pdo->prepare("UPDATE login_attempts SET attempts = 0, locked_until = NULL WHERE username = ? AND ip_address = ?")
                    ->execute([$username, $clientIp]);
                $attempts = 0;
                $lockedUntil = null;
            }

            if ($lockedUntil) {
                $remaining = strtotime($lockedUntil) - time();
                $mins = max(1, ceil($remaining / 60));
                $response['message'] = "Too many failed login attempts. Please try again in {$mins} minute(s).";
                break;
            }

            $stmt = $pdo->prepare("SELECT * FROM members WHERE username = ? AND status = 'Active'");
            $stmt->execute([$username]);
            $user = $stmt->fetch();

            if ($user && password_verify($password, $user['password'])) {
                if (in_array($user['role'], ['Staff', 'Admin'])) {
                    // Successful login — reset failed attempts
                    $pdo->prepare("DELETE FROM login_attempts WHERE username = ? AND ip_address = ?")
                        ->execute([$username, $clientIp]);

                    $_SESSION['user_id'] = $user['id'];
                    $_SESSION['role'] = $user['role'];
                    $_SESSION['name'] = $user['name'];
                    $_SESSION['profile_image'] = $user['profile_image'];

                    $redirect = ($user['role'] === 'Admin') ? 'HTML/admin.html' : 'HTML/staff.html';
                    $response = ['status' => 'success', 'redirect' => $redirect];
                } else {
                    $response['message'] = 'Incorrect portal for your account type.';
                }
            } else {
                // Failed login — increment attempts and lock if threshold reached
                $attempts = $attempts + 1;
                $newLockedUntil = ($attempts >= $maxAttempts)
                    ? date('Y-m-d H:i:s', strtotime('+' . $lockMinutes . ' minutes'))
                    : null;

                $upsert = $pdo->prepare(
                    "INSERT INTO login_attempts (username, ip_address, attempts, last_attempt, locked_until)
                     VALUES (?, ?, ?, NOW(), ?)
                     ON DUPLICATE KEY UPDATE attempts = VALUES(attempts), last_attempt = NOW(), locked_until = VALUES(locked_until)"
                );
                $upsert->execute([$username, $clientIp, $attempts, $newLockedUntil]);

                if ($attempts >= $maxAttempts) {
                    $response['message'] = "Too many failed login attempts. Account locked for {$lockMinutes} minutes.";
                } else {
                    $remaining = $maxAttempts - $attempts;
                    $response['message'] = "Invalid username or password. {$remaining} attempt(s) remaining.";
                }
            }
        }
        break;

    case 'rfid_login':
        updateExpiries($pdo);
        $rfid = strtoupper(trim($_POST['rfid'] ?? ''));
        if ($rfid) {
            $stmt = $pdo->prepare("SELECT * FROM members WHERE rfid = ?");
            $stmt->execute([$rfid]);
            $user = $stmt->fetch();

            if ($user) {
                if ($user['status'] === 'Expired') {
                    $response['message'] = 'Your membership is expired.';
                } elseif ($user['status'] === 'Deactivated') {
                    $response['message'] = 'Your account is deactivated.';
                } elseif (in_array($user['role'], ['Member', 'Coach', 'Temporary', 'Staff', 'Admin'])) {
                    $open = $pdo->prepare('SELECT id, check_in FROM attendance WHERE member_id=? AND check_out IS NULL ORDER BY id DESC LIMIT 1');
                    $open->execute([$user['id']]);
                    $attendance = $open->fetch();

                    if ($attendance) {
                        $pdo->prepare('UPDATE attendance SET check_out=NOW(), duration_minutes=TIMESTAMPDIFF(MINUTE,check_in,NOW()) WHERE id=?')
                            ->execute([$attendance['id']]);
                        if (isset($_SESSION['user_id']) && $_SESSION['user_id'] === $user['id']) {
                            session_destroy();
                        }
                        $response = ['status' => 'success', 'action' => 'checkout', 'message' => "Goodbye, " . $user['name'] . "! Checked out."];
                    } else {
                        $pdo->prepare('INSERT INTO attendance(member_id,check_in) VALUES(?,NOW())')->execute([$user['id']]);
                        $_SESSION['user_id'] = $user['id'];
                        $_SESSION['role'] = $user['role'];
                        $_SESSION['name'] = $user['name'];
                        $_SESSION['profile_image'] = $user['profile_image'];
                        $redirect = ($user['role'] === 'Coach') ? 'HTML/coach_dashboard.html' : 'HTML/member_dashboard.html';
                        $response = ['status' => 'success', 'action' => 'checkin', 'message' => "Welcome, " . $user['name'] . "! Opening dashboard...", 'redirect' => $redirect];
                    }
                } else {
                    $response['message'] = 'Incorrect portal for your account type.';
                }
            } else {
                $response['message'] = 'RFID not recognized.';
            }
        }
        break;

    case 'get_staff_data':
        updateExpiries($pdo);
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Staff', 'Admin'])) {
            http_response_code(403); exit;
        }
        $user_id = $_SESSION['user_id'];
        
        // Members with all needed info in one query
        $members = $pdo->query("
            SELECT m.*, 
            (SELECT s2.start_date FROM subscriptions s2 WHERE s2.member_id=m.id ORDER BY s2.id DESC LIMIT 1) as start_date,
            (SELECT s2.expires_on FROM subscriptions s2 WHERE s2.member_id=m.id ORDER BY s2.id DESC LIMIT 1) as expires_on,
            CASE 
                WHEN m.role IN ('Temporary', 'Coach', 'Staff', 'Admin') THEN 'Permanent'
                ELSE GREATEST(0, DATEDIFF((SELECT s2.expires_on FROM subscriptions s2 WHERE s2.member_id=m.id ORDER BY s2.id DESC LIMIT 1), CURDATE()))
            END as duration_days,
            (SELECT m2.name FROM coaching_assignments ca JOIN coaches c ON ca.coach_id = c.id JOIN members m2 ON c.member_id = m2.id WHERE ca.member_id = m.id AND ca.status = 'Active' LIMIT 1) as coach_name 
            FROM members m 
            ORDER BY m.created_at DESC
        ")->fetchAll();

        $attendanceToday = $pdo->query("SELECT a.*, m.name, m.profile_image FROM attendance a JOIN members m ON m.id=a.member_id ORDER BY a.check_in DESC")->fetchAll();
        
        // Daily Attendance Data for Staff Chart
        $monthly_attendance = $pdo->query("
            SELECT 
                DATE_FORMAT(check_in, '%Y-%m-%d') as month, 
                COUNT(*) as count 
            FROM attendance 
            GROUP BY month 
            ORDER BY month ASC 
            LIMIT 30
        ")->fetchAll();
        
        $reports = $pdo->prepare("SELECT r.*, m.name as user_name FROM reports r JOIN members m ON m.id=r.user_id WHERE r.user_id = ? ORDER BY r.created_at DESC");
        $reports->execute([$user_id]);
        
        $response = [
            'status' => 'success',
            'members' => $members,
            'attendance' => $attendanceToday,
            'monthly_attendance' => $monthly_attendance,
            'reports' => $reports->fetchAll(),
            'user' => [
                'name' => $_SESSION['name'] ?? 'Staff', 
                'role' => $_SESSION['role'] ?? 'Staff',
                'profile_image' => $_SESSION['profile_image'] ?? null
            ]
        ];
        break;

    case 'get_all_coaches':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Staff', 'Admin', 'Member'])) {
            http_response_code(403); exit;
        }
        $coaches = $pdo->query("SELECT c.id as coach_id, m.name as coach_name, m.profile_image FROM coaches c JOIN members m ON c.member_id = m.id WHERE m.status = 'Active'")->fetchAll();
        $response = ['status' => 'success', 'coaches' => $coaches];
        break;

    case 'get_coach_availability_public':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Staff', 'Admin', 'Member'])) {
            http_response_code(403); exit;
        }
        $coach_id = $_GET['coach_id'] ?? '';
        $availability = $pdo->prepare("SELECT * FROM coach_availability WHERE coach_id = ?");
        $availability->execute([$coach_id]);
        $response = ['status' => 'success', 'availability' => $availability->fetchAll()];
        break;

    case 'get_admin_data':
        updateExpiries($pdo);
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Admin') {
            http_response_code(403);
            exit;
        }

        // Stats
        $total_members = $pdo->query("SELECT COUNT(*) FROM members WHERE role IN ('Member', 'Temporary')")->fetchColumn();
        $total_staff = $pdo->query("SELECT COUNT(*) FROM members WHERE role = 'Staff'")->fetchColumn();
        $total_coaches = $pdo->query("SELECT COUNT(*) FROM members WHERE role = 'Coach'")->fetchColumn();

        // Monthly Registration Growth
        $monthly_growth = $pdo->query("
            SELECT 
                DATE_FORMAT(created_at, '%Y-%m') as month, 
                COUNT(*) as count 
            FROM members 
            WHERE role IN ('Member', 'Temporary')
            GROUP BY month 
            ORDER BY month DESC 
            LIMIT 12
        ")->fetchAll();

        $trainees_per_coach = $pdo->query("SELECT m.name, m.profile_image, COUNT(ca.member_id) as trainee_count FROM coaches c JOIN members m ON c.member_id = m.id LEFT JOIN coaching_assignments ca ON c.id = ca.coach_id GROUP BY c.id, m.name, m.profile_image ORDER BY trainee_count DESC")->fetchAll();
        $attendance_report = $pdo->query("SELECT DATE(check_in) as date, COUNT(*) as daily_checkins FROM attendance WHERE check_in >= DATE_SUB(CURDATE(), INTERVAL 7 DAY) GROUP BY DATE(check_in) ORDER BY date DESC")->fetchAll();
        $coaching_frequency = $pdo->query("SELECT m_coach.name as coach_name, DAYNAME(a.check_in) as day_of_week, COUNT(DISTINCT a.member_id) as trainee_count FROM attendance a JOIN coaching_assignments ca ON a.member_id = ca.member_id JOIN coaches c ON ca.coach_id = c.id JOIN members m_coach ON c.member_id = m_coach.id WHERE ca.status = 'Active' GROUP BY m_coach.name, day_of_week ORDER BY m_coach.name, FIELD(day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday')")->fetchAll();
        
        $all_users = $pdo->query("
            SELECT m.*, 
            (SELECT s2.start_date FROM subscriptions s2 WHERE s2.member_id=m.id ORDER BY s2.id DESC LIMIT 1) as start_date,
            (SELECT s2.expires_on FROM subscriptions s2 WHERE s2.member_id=m.id ORDER BY s2.id DESC LIMIT 1) as expires_on,
            CASE 
                WHEN m.role IN ('Temporary', 'Coach', 'Staff', 'Admin') THEN 'Permanent'
                ELSE GREATEST(0, DATEDIFF((SELECT s2.expires_on FROM subscriptions s2 WHERE s2.member_id=m.id ORDER BY s2.id DESC LIMIT 1), CURDATE()))
            END as duration_days,
            (SELECT m2.name FROM coaching_assignments ca JOIN coaches c ON ca.coach_id = c.id JOIN members m2 ON c.member_id = m2.id WHERE ca.member_id = m.id AND ca.status = 'Active' LIMIT 1) as coach_name 
            FROM members m 
            ORDER BY m.created_at DESC
        ")->fetchAll();

        $response = [
            'status' => 'success',
            'stats' => [
                'members' => intval($total_members),
                'staff' => intval($total_staff),
                'coaches' => intval($total_coaches)
            ],
            'monthly_growth' => $monthly_growth,
            'trainees_per_coach' => $trainees_per_coach,
            'attendance_report' => $attendance_report,
            'coaching_frequency' => $coaching_frequency,
            'all_users' => $all_users,
            'user' => [
                'name' => $_SESSION['name'], 
                'role' => $_SESSION['role'],
                'profile_image' => $_SESSION['profile_image'] ?? null
            ]
        ];
        break;

    case 'get_member_data':
        updateExpiries($pdo);
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Member') {
            http_response_code(403);
            exit;
        }
        $user_id = $_SESSION['user_id'];
        $today_name = date('l');
        $sub = $pdo->query("SELECT * FROM subscriptions WHERE member_id = ".$pdo->quote($user_id)." ORDER BY expires_on DESC LIMIT 1")->fetch();
        $attendance = $pdo->query("SELECT DATE(check_in) as att_date FROM attendance WHERE member_id = ".$pdo->quote($user_id))->fetchAll(PDO::FETCH_COLUMN);
        $coaches = $pdo->query("
            SELECT
                c.id,
                c.member_id,
                c.credentials,
                c.habits,
                c.max_trainees,
                m.name as coach_name,
                m.profile_image,
                ROUND(AVG(ca_reviews.member_rating), 1) as average_rating,
                COUNT(ca_reviews.member_rating) as review_count
            FROM coaches c
            JOIN members m ON c.member_id = m.id
            LEFT JOIN coaching_assignments ca_reviews ON ca_reviews.coach_id = c.id AND ca_reviews.member_rating IS NOT NULL
            WHERE m.status = 'Active'
            GROUP BY c.id, c.member_id, c.credentials, c.habits, c.max_trainees, m.name, m.profile_image
        ")->fetchAll();
        $myCoachStmt = $pdo->prepare("
            SELECT
                ca.*,
                m.name as coach_name,
                m.profile_image,
                c.credentials,
                c.habits
            FROM coaching_assignments ca
            JOIN coaches c ON ca.coach_id = c.id
            JOIN members m ON c.member_id = m.id
            WHERE ca.member_id = ?
              AND ca.status IN ('Pending', 'Active')
            ORDER BY ca.created_at DESC
            LIMIT 1
        ");
        $myCoachStmt->execute([$user_id]);
        $my_coach = $myCoachStmt->fetch();
        $routineStmt = $pdo->prepare("
            SELECT
                wr.*,
                coach_member.name AS assigned_by_name
            FROM workout_routines wr
            LEFT JOIN coaches assigned_coach ON wr.assigned_by_coach_id = assigned_coach.id
            LEFT JOIN members coach_member ON assigned_coach.member_id = coach_member.id
            WHERE wr.member_id = ?
            ORDER BY
                CASE WHEN wr.day_of_week = ? THEN 0 ELSE 1 END,
                FIELD(wr.day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'),
                wr.created_at DESC
        ");
        $routineStmt->execute([$user_id, $today_name]);
        $routines = $routineStmt->fetchAll();
        $today_workouts = array_values(array_filter($routines, function ($routine) use ($today_name) {
            return ($routine['day_of_week'] ?? null) === $today_name;
        }));
        $reports = $pdo->prepare("SELECT r.*, m.name as user_name FROM reports r JOIN members m ON m.id=r.user_id WHERE r.user_id = ? ORDER BY r.created_at DESC");
        $reports->execute([$user_id]);
        $reports = $reports->fetchAll();

        $response = [
            'status' => 'success',
            'subscription' => $sub,
            'attendance' => $attendance,
            'coaches' => $coaches,
            'my_coach' => $my_coach,
            'routines' => $routines,
            'today_workouts' => $today_workouts,
            'today_name' => $today_name,
            'reports' => $reports,
            'user' => [
                'name' => $_SESSION['name'], 
                'role' => $_SESSION['role'],
                'profile_image' => $_SESSION['profile_image'] ?? null
            ]
        ];
        break;

    case 'submit_report':
        $data = json_decode(file_get_contents('php://input'), true);
        $stmt = $pdo->prepare("INSERT INTO reports (user_id, category, issue) VALUES (?, ?, ?)");
        $stmt->execute([$_SESSION['user_id'], $data['category'], $data['issue']]);
        $response = ['status' => 'success', 'message' => 'Report submitted'];
        break;

    case 'apply_coach':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Member') {
            http_response_code(403);
            exit;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        $coach_id = intval($data['coach_id'] ?? 0);

        $existingStmt = $pdo->prepare("SELECT id, status FROM coaching_assignments WHERE member_id = ? AND status IN ('Active', 'Pending') ORDER BY created_at DESC LIMIT 1");
        $existingStmt->execute([$_SESSION['user_id']]);
        $existing = $existingStmt->fetch();

        if ($existing) {
            if ($existing['status'] === 'Active') {
                $response = ['status' => 'error', 'message' => 'You already have an active coach. Please resign from your current coach before applying for a new one.'];
            } else {
                $response = ['status' => 'error', 'message' => 'You already have a pending coach application. Please wait for it to be approved or cancelled before applying again.'];
            }
            break;
        }

        $stmt = $pdo->prepare("INSERT INTO coaching_assignments (coach_id, member_id, status) VALUES (?, ?, 'Pending')");
        $stmt->execute([$coach_id, $_SESSION['user_id']]);
        $response = ['status' => 'success', 'message' => 'Applied successfully'];
        break;

    case 'get_coach_profile_public':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Member', 'Staff'])) {
            http_response_code(403);
            exit;
        }

        $coach_id = intval($_GET['coach_id'] ?? 0);
        $coachStmt = $pdo->prepare("
            SELECT
                c.id,
                c.member_id,
                c.credentials,
                c.habits,
                c.max_trainees,
                m.name AS coach_name,
                m.profile_image,
                ROUND(AVG(ca_reviews.member_rating), 1) AS average_rating,
                COUNT(ca_reviews.member_rating) AS review_count
            FROM coaches c
            JOIN members m ON c.member_id = m.id
            LEFT JOIN coaching_assignments ca_reviews ON ca_reviews.coach_id = c.id AND ca_reviews.member_rating IS NOT NULL
            WHERE c.id = ?
            GROUP BY c.id, c.member_id, c.credentials, c.habits, c.max_trainees, m.name, m.profile_image
            LIMIT 1
        ");
        $coachStmt->execute([$coach_id]);
        $coach = $coachStmt->fetch();

        if (!$coach) {
            $response = ['status' => 'error', 'message' => 'Coach not found'];
            break;
        }

        $photoStmt = $pdo->prepare("SELECT id, image_path FROM coach_credential_photos WHERE coach_id = ? ORDER BY id ASC");
        $photoStmt->execute([$coach_id]);
        $coach['credential_photos'] = $photoStmt->fetchAll(PDO::FETCH_ASSOC);

        $reviewStmt = $pdo->prepare("
            SELECT
                ca.member_rating,
                ca.member_feedback,
                ca.completed_at,
                trainee.name AS trainee_name,
                trainee.profile_image AS trainee_profile_image
            FROM coaching_assignments ca
            JOIN members trainee ON trainee.id = ca.member_id
            WHERE ca.coach_id = ?
              AND (ca.member_rating IS NOT NULL OR NULLIF(TRIM(ca.member_feedback), '') IS NOT NULL)
            ORDER BY COALESCE(ca.completed_at, ca.created_at) DESC
            LIMIT 8
        ");
        $reviewStmt->execute([$coach_id]);

        $response = [
            'status' => 'success',
            'coach' => $coach,
            'reviews' => $reviewStmt->fetchAll()
        ];
        break;

    case 'member_end_coaching':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Member') {
            http_response_code(403);
            exit;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        $assignment_id = intval($data['assignment_id'] ?? 0);
        $rating = isset($data['rating']) && $data['rating'] !== '' ? max(1, min(5, intval($data['rating']))) : null;
        $feedback = trim($data['feedback'] ?? '');

        $assignmentStmt = $pdo->prepare("SELECT id, status FROM coaching_assignments WHERE id = ? AND member_id = ? LIMIT 1");
        $assignmentStmt->execute([$assignment_id, $_SESSION['user_id']]);
        $assignment = $assignmentStmt->fetch();

        if (!$assignment) {
            http_response_code(403);
            exit;
        }

        if ($assignment['status'] === 'Pending') {
            $stmt = $pdo->prepare("UPDATE coaching_assignments SET status = 'Rejected' WHERE id = ?");
            $stmt->execute([$assignment_id]);
            $response = ['status' => 'success', 'message' => 'Coaching request cancelled'];
            break;
        }

        $stmt = $pdo->prepare("
            UPDATE coaching_assignments
            SET status = 'Completed',
                member_rating = ?,
                member_feedback = ?,
                completed_at = COALESCE(completed_at, NOW())
            WHERE id = ?
        ");
        $stmt->execute([$rating, $feedback ?: null, $assignment_id]);
        $response = ['status' => 'success', 'message' => 'Coaching assignment completed'];
        break;

    case 'save_routine':
        $data = json_decode(file_get_contents('php://input'), true);
        $target_member_id = $_SESSION['user_id'];
        $assigned_by_coach_id = null;
        $allowed_days = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
        $day_of_week = trim($data['day_of_week'] ?? '');

        if (!empty($data['member_id']) && $data['member_id'] !== $_SESSION['user_id']) {
            if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Coach') {
                http_response_code(403);
                exit;
            }

            $coachStmt = $pdo->prepare("SELECT id FROM coaches WHERE member_id = ?");
            $coachStmt->execute([$_SESSION['user_id']]);
            $coach = $coachStmt->fetch();
            $assigned_by_coach_id = $coach['id'] ?? null;

            $assignmentStmt = $pdo->prepare("SELECT id FROM coaching_assignments WHERE coach_id = ? AND member_id = ? AND status = 'Active'");
            $assignmentStmt->execute([$coach['id'] ?? 0, $data['member_id']]);
            if (!$assignmentStmt->fetch()) {
                http_response_code(403);
                exit;
            }

            $target_member_id = $data['member_id'];
        }

        $routineName = trim($data['name'] ?? '');
        $routineExercises = json_encode($data['exercises'] ?? []);
        if (!$routineName || !in_array($day_of_week, $allowed_days, true)) {
            $response = ['status' => 'error', 'message' => 'Routine name and workout day are required'];
            break;
        }

        if (!empty($data['routine_id'])) {
            $stmt = $pdo->prepare("UPDATE workout_routines SET routine_name = ?, day_of_week = ?, routine_data = ?, assigned_by_coach_id = ? WHERE id = ? AND member_id = ?");
            $stmt->execute([$routineName, $day_of_week, $routineExercises, $assigned_by_coach_id, $data['routine_id'], $target_member_id]);
            $response = ['status' => 'success', 'message' => 'Routine updated'];
        } else {
            $stmt = $pdo->prepare("INSERT INTO workout_routines (member_id, routine_name, day_of_week, assigned_by_coach_id, routine_data) VALUES (?, ?, ?, ?, ?)");
            $stmt->execute([$target_member_id, $routineName, $day_of_week, $assigned_by_coach_id, $routineExercises]);
            $response = ['status' => 'success', 'message' => 'Routine saved'];
        }
        break;

    case 'get_coach_data':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Coach') {
            http_response_code(403);
            exit;
        }
        $user_id = $_SESSION['user_id'];
        $coach = $pdo->query("SELECT * FROM coaches WHERE member_id = ".$pdo->quote($user_id))->fetch();
        $coach_id = $coach['id'];

        $credential_photos = $pdo->prepare("SELECT id, image_path FROM coach_credential_photos WHERE coach_id = ? ORDER BY id ASC");
        $credential_photos->execute([$coach_id]);
        $credential_photos = $credential_photos->fetchAll(PDO::FETCH_ASSOC);
        $coach['credential_photos'] = $credential_photos;
        
        $trainees = $pdo->query("SELECT ca.*, m.name as trainee_name, m.id as member_id, m.medical_condition, m.profile_image FROM coaching_assignments ca JOIN members m ON ca.member_id = m.id WHERE ca.coach_id = $coach_id AND ca.status = 'Active'")->fetchAll();
        $pending = $pdo->query("SELECT ca.*, m.name as trainee_name, m.profile_image FROM coaching_assignments ca JOIN members m ON ca.member_id = m.id WHERE ca.coach_id = $coach_id AND ca.status = 'Pending'")->fetchAll();
        $availability = $pdo->query("SELECT * FROM coach_availability WHERE coach_id = $coach_id")->fetchAll();
        
        $trainee_attendance = [];        
        $selected_trainee_info = null;
        $trainee_routines = [];
        $selected_trainee = $_GET['trainee_id'] ?? '';
        if ($selected_trainee) {
            $selectedStmt = $pdo->prepare("
                SELECT
                    ca.id,
                    ca.coach_assessment_rating,
                    ca.coach_assessment_feedback,
                    m.name as trainee_name,
                    m.id as member_id,
                    m.medical_condition,
                    m.profile_image
                FROM coaching_assignments ca
                JOIN members m ON ca.member_id = m.id
                WHERE ca.coach_id = ? AND ca.member_id = ? AND ca.status = 'Active'
                LIMIT 1
            ");
            $selectedStmt->execute([$coach_id, $selected_trainee]);
            $selected_trainee_info = $selectedStmt->fetch();

            if ($selected_trainee_info) {
                $attendanceStmt = $pdo->prepare("SELECT DATE(check_in) as att_date FROM attendance WHERE member_id = ?");
                $attendanceStmt->execute([$selected_trainee]);
                $trainee_attendance = $attendanceStmt->fetchAll(PDO::FETCH_COLUMN);

                $routineStmt = $pdo->prepare("
                    SELECT
                        wr.*,
                        coach_member.name AS assigned_by_name
                    FROM workout_routines wr
                    LEFT JOIN coaches assigned_coach ON wr.assigned_by_coach_id = assigned_coach.id
                    LEFT JOIN members coach_member ON assigned_coach.member_id = coach_member.id
                    WHERE wr.member_id = ?
                    ORDER BY FIELD(wr.day_of_week, 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'), wr.created_at DESC
                ");
                $routineStmt->execute([$selected_trainee]);
                $trainee_routines = $routineStmt->fetchAll();
            }        
        }

        $reports = $pdo->prepare("SELECT r.*, m.name as user_name FROM reports r JOIN members m ON m.id=r.user_id WHERE r.user_id = ? ORDER BY r.created_at DESC");
        $reports->execute([$user_id]);
        $reports = $reports->fetchAll();

        $response = [
            'status' => 'success',
            'coach' => $coach,
            'trainees' => $trainees,
            'pending' => $pending,
            'availability' => $availability,
            'selected_trainee' => $selected_trainee_info,
            'trainee_attendance' => $trainee_attendance,
            'trainee_routines' => $trainee_routines,
            'reports' => $reports,
            'user' => [
                'name' => $_SESSION['name'], 
                'role' => $_SESSION['role'],
                'profile_image' => $_SESSION['profile_image'] ?? null
            ]
        ];
        break;

    case 'update_coach_profile':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Coach') {
            http_response_code(403);
            exit;
        }

        $credentials = trim($_POST['credentials'] ?? '');
        $habits = trim($_POST['habits'] ?? '');
        $max_trainees = isset($_POST['max_trainees']) && $_POST['max_trainees'] !== '' ? max(1, intval($_POST['max_trainees'])) : 10;
        $max_changed = isset($_POST['max_trainees']) && $_POST['max_trainees'] !== '';

        $coachStmt = $pdo->prepare("SELECT id FROM coaches WHERE member_id = ?");
        $coachStmt->execute([$_SESSION['user_id']]);
        $coach_id = $coachStmt->fetchColumn();

        $upload_dir = __DIR__ . '/uploads/credentials/';
        if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
        $allowed = ['jpg', 'jpeg', 'png', 'gif', 'webp'];

        $has_changes = false;
        $error_msg = null;

        // --- Remove specified photos ---
        $remove_ids = $_POST['remove_photos'] ?? [];
        if (!is_array($remove_ids)) $remove_ids = [];
        foreach ($remove_ids as $rid) {
            $rid = intval($rid);
            if ($rid <= 0) continue;
            $sel = $pdo->prepare("SELECT image_path FROM coach_credential_photos WHERE id = ? AND coach_id = ?");
            $sel->execute([$rid, $coach_id]);
            $path = $sel->fetchColumn();
            if ($path && file_exists(__DIR__ . '/' . $path)) {
                unlink(__DIR__ . '/' . $path);
            }
            $del = $pdo->prepare("DELETE FROM coach_credential_photos WHERE id = ? AND coach_id = ?");
            $del->execute([$rid, $coach_id]);
            $has_changes = true;
        }

        // --- Replace existing photos (keys like replace_photo_<id>) ---
        foreach ($_FILES as $key => $file) {
            if (strpos($key, 'replace_photo_') !== 0) continue;
            if (!isset($file['error']) || $file['error'] !== UPLOAD_ERR_OK) continue;
            $photo_id = intval(substr($key, strlen('replace_photo_')));
            if ($photo_id <= 0) continue;
            if ($file['size'] > 2 * 1024 * 1024) {
                $error_msg = 'Image too large. Maximum size is 2MB.';
                break 2;
            }
            $ext = strtolower(pathinfo($file['name'], PATHINFO_EXTENSION));
            if (!in_array($ext, $allowed)) {
                $error_msg = 'Invalid file type. Allowed: JPG, PNG, GIF, WEBP.';
                break 2;
            }
            $sel = $pdo->prepare("SELECT image_path FROM coach_credential_photos WHERE id = ? AND coach_id = ?");
            $sel->execute([$photo_id, $coach_id]);
            $old_path = $sel->fetchColumn();
            $filename = $_SESSION['user_id'] . '_' . time() . '_' . $photo_id . '.' . $ext;
            if (!move_uploaded_file($file['tmp_name'], $upload_dir . $filename)) {
                $error_msg = 'Failed to save the uploaded image. Please try again.';
                break 2;
            }
            $new_path = 'uploads/credentials/' . $filename;
            if ($old_path && file_exists(__DIR__ . '/' . $old_path)) {
                unlink(__DIR__ . '/' . $old_path);
            }
            $upd = $pdo->prepare("UPDATE coach_credential_photos SET image_path = ? WHERE id = ? AND coach_id = ?");
            $upd->execute([$new_path, $photo_id, $coach_id]);
            $has_changes = true;
        }

        if ($error_msg === null) {
            // --- Add new photos ---
            $new_files = $_FILES['new_photos'] ?? null;
            if ($new_files && isset($new_files['name']) && is_array($new_files['name'])) {
                foreach ($new_files['name'] as $idx => $name) {
                    if ($new_files['error'][$idx] !== UPLOAD_ERR_OK) continue;
                    if ($new_files['size'][$idx] > 2 * 1024 * 1024) {
                        $error_msg = 'Image too large. Maximum size is 2MB.';
                        break;
                    }
                    $ext = strtolower(pathinfo($name, PATHINFO_EXTENSION));
                    if (!in_array($ext, $allowed)) {
                        $error_msg = 'Invalid file type. Allowed: JPG, PNG, GIF, WEBP.';
                        break;
                    }
                    $filename = $_SESSION['user_id'] . '_' . time() . '_' . $idx . '.' . $ext;
                    if (!move_uploaded_file($new_files['tmp_name'][$idx], $upload_dir . $filename)) {
                        $error_msg = 'Failed to save the uploaded image. Please try again.';
                        break;
                    }
                    $new_path = 'uploads/credentials/' . $filename;
                    $ins = $pdo->prepare("INSERT INTO coach_credential_photos (coach_id, image_path) VALUES (?, ?)");
                    $ins->execute([$coach_id, $new_path]);
                    $has_changes = true;
                }
            }
        }

        if ($error_msg !== null) {
            $response = ['status' => 'error', 'message' => $error_msg];
            break;
        }

        if (!$credentials && !$habits && !$max_changed && !$has_changes) {
            $response = ['status' => 'error', 'message' => 'Please fill in at least one field before saving.'];
            break;
        }

        $stmt = $pdo->prepare("UPDATE coaches SET credentials = ?, habits = ?, max_trainees = ? WHERE member_id = ?");
        $stmt->execute([$credentials, $habits, $max_trainees, $_SESSION['user_id']]);
        $response = ['status' => 'success', 'message' => 'Profile updated'];
        break;

    case 'save_coach_assessment':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Coach') {
            http_response_code(403);
            exit;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        $rating = isset($data['rating']) && $data['rating'] !== '' ? max(1, min(5, intval($data['rating']))) : null;
        $feedback = trim($data['feedback'] ?? '');

        $coachStmt = $pdo->prepare("SELECT id FROM coaches WHERE member_id = ?");
        $coachStmt->execute([$_SESSION['user_id']]);
        $coach = $coachStmt->fetch();

        $assignmentStmt = $pdo->prepare("SELECT id FROM coaching_assignments WHERE id = ? AND coach_id = ? AND status = 'Active' LIMIT 1");
        $assignmentStmt->execute([$data['assignment_id'] ?? 0, $coach['id'] ?? 0]);
        if (!$assignmentStmt->fetch()) {
            http_response_code(403);
            exit;
        }

        $stmt = $pdo->prepare("UPDATE coaching_assignments SET coach_assessment_rating = ?, coach_assessment_feedback = ? WHERE id = ?");
        $stmt->execute([$rating, $feedback ?: null, $data['assignment_id']]);
        $response = ['status' => 'success', 'message' => 'Assessment saved'];
        break;

    case 'update_availability':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Coach') {
            http_response_code(403);
            exit;
        }
        $data = json_decode(file_get_contents('php://input'), true);
        $dateStr = $data['date'] ?? '';
        $today = (new DateTime('today'))->format('Y-m-d');
        if ($dateStr < $today) {
            $response = ['status' => 'error', 'message' => 'You cannot set availability for past dates.'];
            break;
        }
        $coach = $pdo->query("SELECT id FROM coaches WHERE member_id = ".$pdo->quote($_SESSION['user_id']))->fetch();
        $stmt = $pdo->prepare("INSERT INTO coach_availability (coach_id, available_date, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = ?");
        $stmt->execute([$coach['id'], $dateStr, $data['status'], $data['status']]);
        $response = ['status' => 'success', 'message' => 'Availability updated'];
        break;

    case 'batch_update_availability':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Coach') {
            http_response_code(403);
            exit;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        $coachStmt = $pdo->prepare("SELECT id FROM coaches WHERE member_id = ?");
        $coachStmt->execute([$_SESSION['user_id']]);
        $coach = $coachStmt->fetch();

        $status = ($data['status'] ?? 'Available') === 'Unavailable' ? 'Unavailable' : 'Available';
        $weeks = max(1, min(12, intval($data['weeks'] ?? 8)));
        $weekdays = array_values(array_unique(array_map('intval', $data['weekdays'] ?? [])));
        $weekdays = array_values(array_filter($weekdays, fn($day) => $day >= 0 && $day <= 6));

        if (!$coach || empty($weekdays)) {
            $response = ['status' => 'error', 'message' => 'Select at least one weekday'];
            break;
        }

        $stmt = $pdo->prepare("INSERT INTO coach_availability (coach_id, available_date, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = ?");
        $count = 0;
        $date = new DateTime('today');
        $endDate = (new DateTime('today'))->modify('+' . (($weeks * 7) - 1) . ' days');

        while ($date <= $endDate) {
            if (in_array(intval($date->format('w')), $weekdays, true)) {
                $formattedDate = $date->format('Y-m-d');
                $stmt->execute([$coach['id'], $formattedDate, $status, $status]);
                $count++;
            }
            $date->modify('+1 day');
        }

        $response = ['status' => 'success', 'message' => 'Weekly availability updated', 'count' => $count];
        break;

    case 'manage_assignment':
            if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Coach') {
            http_response_code(403);
            exit;
        }

        $data = json_decode(file_get_contents('php://input'), true);
        $allowedStatuses = ['Active', 'Completed', 'Rejected'];
        if (!in_array($data['status'] ?? '', $allowedStatuses, true)) {
            $response = ['status' => 'error', 'message' => 'Invalid assignment status'];
            break;
        }

        $coachStmt = $pdo->prepare("SELECT id FROM coaches WHERE member_id = ?");
        $coachStmt->execute([$_SESSION['user_id']]);
        $coach = $coachStmt->fetch();

        $assignmentStmt = $pdo->prepare("SELECT id FROM coaching_assignments WHERE id = ? AND coach_id = ?");
        $assignmentStmt->execute([$data['assignment_id'], $coach['id'] ?? 0]);
        if (!$assignmentStmt->fetch()) {
            http_response_code(403);
            exit;
        }

        $stmt = $pdo->prepare("UPDATE coaching_assignments SET status = ?, completed_at = CASE WHEN ? = 'Completed' THEN COALESCE(completed_at, NOW()) ELSE completed_at END WHERE id = ?");
        $stmt->execute([$data['status'], $data['status'], $data['assignment_id']]);
        $response = ['status' => 'success', 'message' => 'Assignment updated'];
        break;

    case 'create_member':
        $data = json_decode(file_get_contents('php://input'), true);
        $name=trim($data['name']??''); $gender=$data['gender']??''; $age=intval($data['age']??0);
        $dur=intval($data['duration_days']??30);
        $role=$data['role']??'Member'; $rfid=strtoupper(trim($data['rfid']??''));
        $username=trim($data['username']??''); $password=$data['password']??'';
        $email = trim($data['email'] ?? '');
        $phone = trim($data['phone'] ?? '');
        $address = trim($data['address'] ?? '');
        $welcomeEmailStatus = [
            'attempted' => false,
            'sent' => false,
            'recipient' => $email ?: null,
            'recipient_valid' => !empty($email) && filter_var($email, FILTER_VALIDATE_EMAIL),
            'log_id' => null,
            'skipped_reason' => null,
            'error' => null
        ];

        if($name&&$gender&&$age>0){
            $id=uuidv4();
            if(!$rfid) $rfid = unique_hex_rfid($pdo, 8);
            $hashed_pass = $password ? password_hash($password, PASSWORD_DEFAULT) : null;
            $stmt=$pdo->prepare('INSERT INTO members(id,rfid,username,password,name,gender,age,role,email,phone,address) VALUES(?,?,?,?,?,?,?,?,?,?,?)');
            $stmt->execute([$id,$rfid,$username?:null,$hashed_pass,$name,$gender,$age,$role,$email?:null,$phone?:null,$address?:null]);

            if($role==='Coach'){
                $pdo->prepare('INSERT INTO coaches(member_id) VALUES(?)')->execute([$id]);
            }

            $start=date('Y-m-d');
            $expires = null;
            if (in_array($role, ['Coach', 'Staff', 'Admin', 'Temporary'])) {
                $pdo->prepare('INSERT INTO subscriptions(member_id,start_date,duration_days,expires_on) VALUES(?,?,?,NULL)')->execute([$id,$start,9999]);
            } else {
                $expires=(new DateTime($start))->modify("+$dur days")->format('Y-m-d');
                $pdo->prepare('INSERT INTO subscriptions(member_id,start_date,duration_days,expires_on) VALUES(?,?,?,?)')->execute([$id,$start,$dur,$expires]);
            }

            $welcomeEmailStatus['attempted'] = true;
            try {
                $newSubId = $pdo->lastInsertId() ?: null;
                // Reliably resolve subscription ID — same hardened lookup as case 'extend'
                try {
                    $subLookup = $pdo->prepare("SELECT id, start_date FROM subscriptions 
                                                 WHERE member_id = ? ORDER BY id DESC LIMIT 1");
                    $subLookup->execute([$id]);
                    $latestSub = $subLookup->fetch();
                    if ($latestSub && empty($newSubId)) {
                        $newSubId = $latestSub['id'];
                    }
                    if ($latestSub && isset($latestSub['start_date'])) {
                        $start = $latestSub['start_date'];
                    }
                } catch (Exception $subEx) {
                    error_log("create_member: sub-id re-lookup failed: " . $subEx->getMessage());
                }

                if (empty($email)) {
                    $welcomeEmailStatus['skipped_reason'] = 'No email provided during registration. Member can add one in Account Settings.';
                } elseif (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
                    $welcomeEmailStatus['skipped_reason'] = 'Invalid email format: ' . htmlspecialchars($email);
                } else {
                    $alreadySent = false;
                    try {
                        if ($newSubId) {
                            $dupCheck = $pdo->prepare("SELECT 1 FROM email_notifications_sent 
                                                        WHERE member_id = ? AND notification_type = 'welcome' 
                                                        AND subscription_id = ? LIMIT 1");
                            $dupCheck->execute([$id, $newSubId]);
                        } else {
                            $dupCheck = $pdo->prepare("SELECT 1 FROM email_notifications_sent 
                                                        WHERE member_id = ? AND notification_type = 'welcome' 
                                                        AND target_date = ? LIMIT 1");
                            $dupCheck->execute([$id, $start]);
                        }
                        $alreadySent = (bool)$dupCheck->fetchColumn();
                    } catch (Exception $dupEx) {
                        $welcomeEmailStatus['error'] = 'Dup-check skipped (table issue): ' . $dupEx->getMessage();
                    }

                    if ($alreadySent) {
                        $welcomeEmailStatus['skipped_reason'] = 'Welcome email already recorded for this member/subscription; duplicate prevented.';
                    } else {
                        $emailBody = fg_build_welcome_email($name, $id, $start, $expires);
                        $emailResult = fg_send_email($email, "Welcome to Fitclub Gym, $name!", $emailBody, true);
                        $welcomeEmailStatus['sent'] = !empty($emailResult['success']);
                        $welcomeEmailStatus['log_id'] = $emailResult['log_id'] ?? null;
                        if (!empty($emailResult['success'])) {
                            try {
                                $pdo->prepare("INSERT INTO email_notifications_sent (member_id, notification_type, subscription_id, target_date) VALUES (?, 'welcome', ?, ?)")
                                    ->execute([$id, $newSubId, $start]);
                            } catch (Exception $markEx) {
                                if (empty($welcomeEmailStatus['error'])) $welcomeEmailStatus['error'] = 'Email sent OK but tracking save failed: ' . $markEx->getMessage();
                            }
                        } else {
                            $welcomeEmailStatus['error'] = $emailResult['error'] ?? 'Unknown SMTP failure';
                        }
                    }
                }
            } catch (Exception $emailEx) {
                $welcomeEmailStatus['error'] = 'Unhandled welcome email error: ' . $emailEx->getMessage();
                error_log("Welcome email full error (member=$id): " . $emailEx->getMessage() . " | " . $emailEx->getTraceAsString());
            }

            $respMsg = 'User created successfully';
            if ($welcomeEmailStatus['sent']) {
                $respMsg .= ' — welcome email sent to ' . $email;
            }
            $response = ['status' => 'success', 'message' => $respMsg, 'welcome_email_status' => $welcomeEmailStatus, 'member_id' => $id];
        }
        break;

    case 'extend':
        $data = json_decode(file_get_contents('php://input'), true);
        $id=$data['member_id']??''; $days=intval($data['days']??0);
        $emailStatus = [
            'attempted' => false,
            'sent' => false,
            'recipient' => null,
            'recipient_valid' => false,
            'log_id' => null,
            'skipped_reason' => null,
            'error' => null
        ];
        if($id&&$days>0){
            // Check if user is Temporary - should not be allowed to extend
            $check = $pdo->prepare("SELECT role FROM members WHERE id = ?");
            $check->execute([$id]);
            if ($check->fetchColumn() === 'Temporary') {
                $response = ['status' => 'error', 'message' => 'Temporary members cannot be extended.'];
                break;
            }

            $row=$pdo->query("SELECT s.* FROM subscriptions s WHERE s.member_id=".$pdo->quote($id)." ORDER BY s.id DESC LIMIT 1")->fetch();
            $today = date('Y-m-d');
            $newSubId = null;
            
            if($row){
                $current_expires = $row['expires_on'];
                $is_expired = $current_expires <= $today;
                
                if ($is_expired) {
                    // Start fresh from today
                    $new_start = $today;
                    $new_expires = (new DateTime($today))->modify("+$days days")->format('Y-m-d');
                    $new_dur = $days;
                } else {
                    // Extend from existing date
                    // User requested: "start date also change to the date where the renew subcription began"
                    // If they are not expired, the new period starts from today, effectively resetting the start date.
                    $new_start = $today;
                    $new_expires = (new DateTime($current_expires))->modify("+$days days")->format('Y-m-d');
                    // Recalculate duration based on new expiry vs new start
                    $new_dur = (new DateTime($new_start))->diff(new DateTime($new_expires))->days;
                }
                
                $insStmt = $pdo->prepare('INSERT INTO subscriptions(member_id,start_date,duration_days,expires_on) VALUES(?,?,?,?)');
                $insStmt->execute([$id,$new_start,$new_dur,$new_expires]);
                $newSubId = $pdo->lastInsertId() ?: null;
            } else {
                // No existing subscription, create first one
                $new_expires = (new DateTime($today))->modify("+$days days")->format('Y-m-d');
                $new_start = $today;
                $new_dur = $days;
                $insStmt = $pdo->prepare('INSERT INTO subscriptions(member_id,start_date,duration_days,expires_on) VALUES(?,?,?,?)');
                $insStmt->execute([$id,$today,$days,$new_expires]);
                $newSubId = $pdo->lastInsertId() ?: null;
            }
            
            // Set member status back to Active if it was Expired or just created
            $pdo->prepare("UPDATE members SET status = 'Active' WHERE id = ? AND status = 'Expired'")->execute([$id]);

            // ── RELIABLY RESOLVE THE NEW SUBSCRIPTION ID ──
            // lastInsertId() can return empty/null under some PDO/MySQL configs;
            // so re-query the LATEST subscription for this member (just inserted).
            try {
                $subLookup = $pdo->prepare("SELECT id, start_date FROM subscriptions 
                                             WHERE member_id = ? ORDER BY id DESC LIMIT 1");
                $subLookup->execute([$id]);
                $latestSub = $subLookup->fetch();
                if ($latestSub && empty($newSubId)) {
                    $newSubId = $latestSub['id'];
                }
                // Always use the database-fetched start_date as canonical
                if ($latestSub && isset($latestSub['start_date'])) {
                    $new_start = $latestSub['start_date'];
                }
            } catch (Exception $subEx) {
                // Non-fatal: continue with whatever we have
                error_log("extend: sub-id re-lookup failed: " . $subEx->getMessage());
            }

            // Send renewal confirmation email (detailed diagnostics, non-fatal duplicate check)
            $emailStatus['attempted'] = true;
            try {
                $memberStmt = $pdo->prepare("SELECT name, email, role FROM members WHERE id = ? LIMIT 1");
                $memberStmt->execute([$id]);
                $member = $memberStmt->fetch();

                // Expiry notifications & renewal confirmations: skip Coach/Staff/Admin/Temporary roles
                $skipRoles = ['Coach', 'Staff', 'Admin', 'Temporary'];
                if ($member && in_array($member['role'], $skipRoles, true)) {
                    $emailStatus['skipped_reason'] = 'Renewal email not required for ' . $member['role'] . ' role.';
                } elseif (!$member || empty(trim($member['email']))) {
                    $emailStatus['skipped_reason'] = 'Member has no email on file. Ask the member to save their email in Account Settings first.';
                } elseif (!filter_var(trim($member['email']), FILTER_VALIDATE_EMAIL)) {
                    $emailStatus['skipped_reason'] = 'Invalid email format on file: ' . htmlspecialchars($member['email']);
                    $emailStatus['recipient'] = $member['email'];
                } else {
                    $cleanEmail = trim($member['email']);
                    $emailStatus['recipient'] = $cleanEmail;
                    $emailStatus['recipient_valid'] = true;
                    $targetDate = is_string($new_expires) ? $new_expires : date('Y-m-d', strtotime($new_expires));
                    $startDate = is_string($new_start ?? null) ? ($new_start ?? date('Y-m-d')) : date('Y-m-d', strtotime($new_start ?? 'today'));

                    $alreadySent = false;
                    try {
                        if ($newSubId) {
                            // Preferred: unique by subscription PK — never false-positive
                            $dupCheck = $pdo->prepare("SELECT 1 FROM email_notifications_sent 
                                                        WHERE member_id = ? AND notification_type = 'renewal' 
                                                        AND subscription_id = ? LIMIT 1");
                            $dupCheck->execute([$id, $newSubId]);
                        } else {
                            // Fallback: unique by (member + start_date + target_date + renewal).
                            // This prevents collisions when lastInsertId() is unavailable,
                            // while still allowing same target_date across different renewals.
                            $dupCheck = $pdo->prepare("SELECT 1 FROM email_notifications_sent 
                                                        WHERE member_id = ? AND notification_type = 'renewal' 
                                                        AND target_date = ? AND (start_date = ? OR start_date IS NULL) LIMIT 1");
                            $dupCheck->execute([$id, $targetDate, $startDate]);
                        }
                        $alreadySent = (bool)$dupCheck->fetchColumn();
                    } catch (Exception $dupEx) {
                        $alreadySent = false;
                        $emailStatus['error'] = 'Dup-check skipped (table issue): ' . $dupEx->getMessage();
                    }

                    if ($alreadySent) {
                        $emailStatus['skipped_reason'] = 'Renewal email already sent for this subscription batch; duplicate prevented.';
                    } else {
                        $emailBody = fg_build_renewal_email($member['name'], $new_expires, $days);
                        $emailResult = fg_send_email($cleanEmail, "Your Fitclub Gym Membership Has Been Renewed!", $emailBody, true);
                        $emailStatus['sent'] = !empty($emailResult['success']);
                        $emailStatus['log_id'] = $emailResult['log_id'] ?? null;
                        if (!empty($emailResult['success'])) {
                            try {
                                // Ensure the notifications table has a start_date column first
                                static $notifSchemaChecked = false;
                                if (!$notifSchemaChecked) {
                                    $col = $pdo->query("SHOW COLUMNS FROM email_notifications_sent LIKE 'start_date'")->fetch();
                                    $notifSchemaChecked = true;
                                    if (!$col) {
                                        $pdo->exec("ALTER TABLE email_notifications_sent ADD COLUMN start_date DATE NULL AFTER target_date");
                                    }
                                }
                                $markStmt = $pdo->prepare("INSERT INTO email_notifications_sent 
                                    (member_id, notification_type, subscription_id, target_date, start_date) 
                                    VALUES (?, 'renewal', ?, ?, ?)
                                    ON DUPLICATE KEY UPDATE sent_at = CURRENT_TIMESTAMP");
                                @$markStmt->execute([$id, $newSubId, $targetDate, $startDate]);
                            } catch (Exception $markEx) {
                                // If schema alteration fails (permissions, etc.), try original insert without start_date
                                try {
                                    $markStmtFallback = $pdo->prepare("INSERT INTO email_notifications_sent 
                                        (member_id, notification_type, subscription_id, target_date) 
                                        VALUES (?, 'renewal', ?, ?)");
                                    @$markStmtFallback->execute([$id, $newSubId, $targetDate]);
                                } catch (Exception $markEx2) {
                                    if (empty($emailStatus['error'])) {
                                        $emailStatus['error'] = 'Email sent OK but duplicate-tracking save failed: ' . $markEx->getMessage();
                                    }
                                }
                            }
                        } else {
                            $emailStatus['error'] = $emailResult['error'] ?? 'Unknown SMTP failure';
                        }
                    }
                }
            } catch (Exception $emailEx) {
                $emailStatus['error'] = 'Unhandled email error: ' . $emailEx->getMessage();
                error_log("Renewal email full error (member=$id): " . $emailEx->getMessage() . " | " . $emailEx->getTraceAsString());
            }

            $response = [
                'status' => 'success',
                'message' => 'Subscription updated' . ($emailStatus['sent'] ? ' — renewal email sent to ' . $emailStatus['recipient'] : ''),
                'email_status' => $emailStatus,
                'new_expires_on' => $new_expires ?? null,
                'new_start_on' => $new_start ?? null
            ];
        }
        break;

    case 'toggle_status':
        $data = json_decode(file_get_contents('php://input'), true);
        $id=$data['member_id']??''; $new_status=$data['new_status']??'Active';
        if($id){
            if ($new_status === 'Active') {
                // When activating, check if membership is actually expired
                // Exclude roles that don't expire
                $check = $pdo->prepare("SELECT role FROM members WHERE id = ?");
                $check->execute([$id]);
                $role = $check->fetchColumn();

                if (!in_array($role, ['Coach', 'Staff', 'Admin', 'Temporary'])) {
                    $stmt = $pdo->prepare("SELECT MAX(expires_on) as max_expires FROM subscriptions WHERE member_id = ?");
                    $stmt->execute([$id]);
                    $max_expires = $stmt->fetchColumn();
                    
                    if ($max_expires && $max_expires <= date('Y-m-d')) {
                        $new_status = 'Expired';
                    }
                }
            }
            $pdo->prepare('UPDATE members SET status=? WHERE id=?')->execute([$new_status,$id]); 
            $response = ['status' => 'success', 'message' => 'Status updated'];
        }
        break;

    case 'update_rfid':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'] ?? '', ['Admin', 'Staff'])) {
            $response = ['status' => 'error', 'message' => 'Access denied. Please log in as Admin or Staff.'];
            break;
        }
        $data = json_decode(file_get_contents('php://input'), true);
        $member_id = trim($data['member_id'] ?? '');
        $new_rfid = strtoupper(trim($data['new_rfid'] ?? ''));
        if ($member_id && $new_rfid) {
            $check = $pdo->prepare('SELECT id FROM members WHERE rfid = ? AND id != ?');
            $check->execute([$new_rfid, $member_id]);
            if ($check->fetch()) {
                $response = ['status' => 'error', 'message' => 'RFID is already assigned to another member.'];
            } else {
                $stmt = $pdo->prepare('UPDATE members SET rfid = ? WHERE id = ?');
                $stmt->execute([$new_rfid, $member_id]);
                if ($stmt->rowCount() > 0) {
                    $response = ['status' => 'success', 'message' => 'RFID updated successfully!'];
                } else {
                    $verify = $pdo->prepare('SELECT rfid FROM members WHERE id = ?');
                    $verify->execute([$member_id]);
                    $current = $verify->fetchColumn();
                    if ($current === $new_rfid) {
                        $response = ['status' => 'success', 'message' => 'RFID updated successfully! (no change, value already set)'];
                    } else {
                        $response = ['status' => 'error', 'message' => 'Member not found. Please check the Member ID.'];
                    }
                }
            }
        } else {
            $response = ['status' => 'error', 'message' => 'Member ID and new RFID are required.'];
        }
        break;

    case 'unified_scan':
        updateExpiries($pdo);
        $data = json_decode(file_get_contents('php://input'), true);
        $code = trim($data['code'] ?? '');
        if($code){
            $stmt=$pdo->prepare('SELECT id, name, status, role FROM members WHERE id=? OR rfid=?'); 
            $stmt->execute([$code,$code]); 
            $m=$stmt->fetch();
            if($m){
                if ($m['status'] === 'Expired') {
                    $response = ['status' => 'error', 'message' => 'Membership expired.'];
                } elseif ($m['status'] === 'Deactivated') {
                    $response = ['status' => 'error', 'message' => 'Account deactivated.'];
                } else {
                    $open=$pdo->prepare('SELECT id FROM attendance WHERE member_id=? AND check_out IS NULL ORDER BY id DESC LIMIT 1'); 
                    $open->execute([$m['id']]); 
                    $open=$open->fetch();
                    
                    if($open){
                        // Check out
                        $pdo->prepare('UPDATE attendance SET check_out=NOW(), duration_minutes=TIMESTAMPDIFF(MINUTE,check_in,NOW()) WHERE id=?')->execute([$open['id']]);
                        $response = ['status' => 'success', 'message' => 'Goodbye, ' . $m['name'] . '! Checked out'];
                    } else {
                        // Check in
                        $pdo->prepare('INSERT INTO attendance(member_id,check_in) VALUES(?,NOW())')->execute([$m['id']]);
                        $response = ['status' => 'success', 'message' => 'Welcome, ' . $m['name'] . '! Checked in'];
                    }
                }
            } else {
                $response = ['status' => 'error', 'message' => 'RFID or ID not recognized.'];
            }
        }
        break;

    case 'hardware_scan':
        // Lightweight endpoint for Arduino/ESP32 hardware
        $rfid = strtoupper(trim($_REQUEST['rfid'] ?? ''));
        if (!$rfid) {
            echo "ERROR: NO_RFID";
            exit;
        }

        // Avoid repeated scans if card is left on the reader
        // Use separate cooldown keys that are NOT cleared by the UI
        $stmt = $pdo->query("SELECT settings_key, settings_value FROM system_settings WHERE settings_key IN ('cooldown_rfid', 'cooldown_time')");
        $settings = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
        $last_rfid = $settings['cooldown_rfid'] ?? '';
        $last_time = intval($settings['cooldown_time'] ?? 0);
        $now = time();

        if ($rfid === $last_rfid && ($now - $last_time) < 1.5) {
            echo "SUCCESS: IGNORED_REPEAT";
            exit;
        }

        // Store for UI polling
        $pdo->prepare("INSERT INTO system_settings (settings_key, settings_value) VALUES ('last_rfid_scan', ?) ON DUPLICATE KEY UPDATE settings_value = ?")
            ->execute([$rfid, $rfid]);
        $pdo->prepare("INSERT INTO system_settings (settings_key, settings_value) VALUES ('last_scan_time', ?) ON DUPLICATE KEY UPDATE settings_value = ?")
            ->execute([$now, $now]);
        
        // Store for persistent cooldown
        $pdo->prepare("INSERT INTO system_settings (settings_key, settings_value) VALUES ('cooldown_rfid', ?) ON DUPLICATE KEY UPDATE settings_value = ?")
            ->execute([$rfid, $rfid]);
        $pdo->prepare("INSERT INTO system_settings (settings_key, settings_value) VALUES ('cooldown_time', ?) ON DUPLICATE KEY UPDATE settings_value = ?")
            ->execute([$now, $now]);

        updateExpiries($pdo);
        $stmt = $pdo->prepare("SELECT id, name, status, role FROM members WHERE rfid = ?");
        $stmt->execute([$rfid]);
        $user = $stmt->fetch();

        if (!$user) {
            echo "SUCCESS: REGISTER_READY|" . $rfid;
            exit;
        }

        if ($user['status'] !== 'Active') {
            echo "ERROR: " . strtoupper($user['status']);
            exit;
        }

        // Check for open attendance
        $open = $pdo->prepare('SELECT id FROM attendance WHERE member_id=? AND check_out IS NULL ORDER BY id DESC LIMIT 1');
        $open->execute([$user['id']]);
        $attendance = $open->fetch();

        if ($attendance) {
            // Check out
            $pdo->prepare('UPDATE attendance SET check_out=NOW(), duration_minutes=TIMESTAMPDIFF(MINUTE,check_in,NOW()) WHERE id=?')
                ->execute([$attendance['id']]);
            echo "SUCCESS: CHECKOUT|" . $user['name'];
        } else {
            // Check in
            $pdo->prepare('INSERT INTO attendance(member_id,check_in) VALUES(?,NOW())')->execute([$user['id']]);
            echo "SUCCESS: CHECKIN|" . $user['name'];
        }
        exit;

    case 'get_last_scan':
        $stmt = $pdo->query("SELECT settings_key, settings_value FROM system_settings WHERE settings_key IN ('last_rfid_scan', 'last_scan_time')");
        $settings = $stmt->fetchAll(PDO::FETCH_KEY_PAIR);
        $rfid = $settings['last_rfid_scan'] ?? '';
        
        $response = [
            'status' => 'success', 
            'rfid' => $rfid,
            'time' => intval($settings['last_scan_time'] ?? 0)
        ];
        break;

    case 'consume_last_scan':
        $pdo->query("DELETE FROM system_settings WHERE settings_key IN ('last_rfid_scan', 'last_scan_time')");
        $response = ['status' => 'success'];
        break;

    case 'logout':
        session_destroy();
        $response = ['status' => 'success'];
        break;

    case 'get_staff_list':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Admin') {
            http_response_code(403); exit;
        }
        $staff = $pdo->query("SELECT id, username, password, name, role, status, profile_image, created_at, gender, age FROM members WHERE role IN ('Staff', 'Admin') ORDER BY role ASC, name ASC")->fetchAll();
        $response = ['status' => 'success', 'staff' => $staff];
        break;

    case 'manage_staff':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Admin') {
            http_response_code(403); exit;
        }
        $data = json_decode(file_get_contents('php://input'), true);
        $id = $data['id'] ?? '';
        $username = trim($data['username'] ?? '');
        $password = $data['password'] ?? '';
        $name = trim($data['name'] ?? '');
        $role = $data['role'] ?? 'Staff';
        $status = $data['status'] ?? 'Active';
        $gender = $data['gender'] ?? 'Other';
        $age = intval($data['age'] ?? 30);

        if ($password) {
            $pass_err = validate_password($password);
            if ($pass_err !== true) {
                $response = ['status' => 'error', 'message' => $pass_err];
                break;
            }
        }

        if ($id) {
            // Update
            $sql = "UPDATE members SET username=?, name=?, role=?, status=?, gender=?, age=? " . ($password ? ", password=?" : "") . " WHERE id=?";
            $params = [$username, $name, $role, $status, $gender, $age];
            if ($password) {
                $hashed = password_hash($password, PASSWORD_DEFAULT);
                if ($hashed === false) {
                    $response = ['status' => 'error', 'message' => 'Password hashing failed'];
                    break;
                }
                $params[] = $hashed;
            }
            $params[] = $id;
            $pdo->prepare($sql)->execute($params);
            $response = ['status' => 'success', 'message' => 'Staff updated'];
        } else {
            // Create
            $new_id = uuidv4();
            $hashed_pass = password_hash($password ?: 'staff123', PASSWORD_DEFAULT);
            $pdo->prepare("INSERT INTO members (id, username, password, name, role, status, gender, age) VALUES (?,?,?,?,?,?,?,?)")
                ->execute([$new_id, $username, $hashed_pass, $name, $role, $status, $gender, $age]);
            
            // Add subscription for staff (no expiry)
            $start = date('Y-m-d');
            $pdo->prepare('INSERT INTO subscriptions(member_id,start_date,duration_days,expires_on) VALUES(?,?,?,NULL)')
                ->execute([$new_id, $start, 9999]);

            $response = ['status' => 'success', 'message' => 'Staff created'];
        }
        break;

    case 'get_all_reports':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Admin') {
            http_response_code(403); exit;
        }
        $reports = $pdo->query("SELECT r.*, m.name as user_name, m.role as user_role, m.profile_image FROM reports r JOIN members m ON r.user_id = m.id ORDER BY r.created_at DESC")->fetchAll();
        $response = ['status' => 'success', 'reports' => $reports];
        break;

    case 'update_report_status':
        if (!isset($_SESSION['user_id']) || $_SESSION['role'] !== 'Admin') {
            http_response_code(403); exit;
        }
        $data = json_decode(file_get_contents('php://input'), true);
        $id = $data['id'] ?? '';
        $status = $data['status'] ?? '';
        $resolution = $data['resolution'] ?? null;

        if ($id && $status) {
            // Validation: Resolved status requires resolution text
            if ($status === 'Resolved' && empty(trim($resolution))) {
                $response = ['status' => 'error', 'message' => 'Resolution text is required to mark as Resolved'];
            } else {
                $stmt = $pdo->prepare("UPDATE reports SET status = ?, resolution = ? WHERE id = ?");
                $stmt->execute([$status, $resolution, $id]);
                $response = ['status' => 'success', 'message' => 'Report updated'];
            }
        }
        break;

    case 'assign_coach':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Staff', 'Admin'])) {
            http_response_code(403); exit;
        }
        $data = json_decode(file_get_contents('php://input'), true);
        $member_id = $data['member_id'] ?? '';
        $coach_id = $data['coach_id'] ?? '';
        if ($member_id && $coach_id) {
            // Deactivate existing assignments
            $pdo->prepare("UPDATE coaching_assignments SET status = 'Completed' WHERE member_id = ? AND status = 'Active'")->execute([$member_id]);
            // Create new
            $pdo->prepare("INSERT INTO coaching_assignments (coach_id, member_id, status) VALUES (?, ?, 'Active')")->execute([$coach_id, $member_id]);
            $response = ['status' => 'success', 'message' => 'Coach assigned'];
        }
        break;

    case 'get_attendance_history':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Staff', 'Admin'])) {
            http_response_code(403); exit;
        }
        $history = $pdo->query("SELECT a.*, m.name, m.role, m.profile_image FROM attendance a JOIN members m ON a.member_id = m.id ORDER BY a.check_in DESC")->fetchAll();
        $response = ['status' => 'success', 'history' => $history];
        break;

    case 'get_notifications':
        if (!isset($_SESSION['user_id'])) { http_response_code(403); exit; }
        $user_id = $_SESSION['user_id'];
        
        // Auto-generate notifications based on logic
        if ($_SESSION['role'] === 'Admin' || $_SESSION['role'] === 'Staff') {
            // On-site users notification
            $onsite = $pdo->query("SELECT COUNT(*) FROM attendance WHERE check_out IS NULL")->fetchColumn();
            if ($onsite > 0) {
                $stmt = $pdo->prepare("INSERT INTO notifications (user_id, title, message, type) SELECT ?, 'Users On-site', ?, 'onsite' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = ? AND title = 'Users On-site' AND created_at > DATE_SUB(NOW(), INTERVAL 1 HOUR))");
                $stmt->execute([$user_id, "$onsite user(s) are currently in the gym.", $user_id]);
            }

            // Membership expiring in 3 days
            $expiring = $pdo->query("SELECT m.name, s.expires_on FROM subscriptions s JOIN members m ON s.member_id = m.id WHERE s.expires_on = DATE_ADD(CURDATE(), INTERVAL 3 DAY)")->fetchAll();
            foreach ($expiring as $e) {
                $title = "Membership Expiring: " . $e['name'];
                $msg = "Member " . $e['name'] . "'s plan expires on " . $e['expires_on'] . " (3 days left).";
                $stmt = $pdo->prepare("INSERT INTO notifications (user_id, title, message, type) SELECT ?, ?, ?, 'expiry' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = ? AND title = ? AND created_at > CURDATE())");
                $stmt->execute([$user_id, $title, $msg, $user_id, $title]);
            }

            // Membership expired today
            $expired = $pdo->query("SELECT m.name FROM subscriptions s JOIN members m ON s.member_id = m.id WHERE s.expires_on = CURDATE()")->fetchAll();
            foreach ($expired as $e) {
                $title = "Membership Expired: " . $e['name'];
                $msg = "Member " . $e['name'] . "'s plan has expired today.";
                $stmt = $pdo->prepare("INSERT INTO notifications (user_id, title, message, type) SELECT ?, ?, ?, 'expiry' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = ? AND title = ? AND created_at > CURDATE())");
                $stmt->execute([$user_id, $title, $msg, $user_id, $title]);
            }
        }

        // Report status change notifications for the reporter
        $report_updates = $pdo->prepare("SELECT id, status, category FROM reports WHERE user_id = ? AND status != 'Pending' AND created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)");
        $report_updates->execute([$user_id]);
        foreach ($report_updates->fetchAll() as $r) {
            $title = "Report Updated: " . $r['category'];
            $msg = "Your report status has been updated to " . $r['status'] . ".";
            $stmt = $pdo->prepare("INSERT INTO notifications (user_id, title, message, type) SELECT ?, ?, ?, 'report' FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM notifications WHERE user_id = ? AND title = ? AND created_at > DATE_SUB(NOW(), INTERVAL 12 HOUR))");
            $stmt->execute([$user_id, $title, $msg, $user_id, $title]);
        }

        $notifs = $pdo->prepare("SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 20");
        $notifs->execute([$user_id]);
        $response = ['status' => 'success', 'notifications' => $notifs->fetchAll()];
        break;

    case 'mark_notif_read':
        if (!isset($_SESSION['user_id'])) { http_response_code(403); exit; }
        $data = json_decode(file_get_contents('php://input'), true);
        if (isset($data['id'])) {
            $stmt = $pdo->prepare("UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?");
            $stmt->execute([$data['id'], $_SESSION['user_id']]);
        } else {
            $stmt = $pdo->prepare("UPDATE notifications SET is_read = 1 WHERE user_id = ?");
            $stmt->execute([$_SESSION['user_id']]);
        }
        $response = ['status' => 'success'];
        break;

    case 'update_profile':
        if (!isset($_SESSION['user_id'])) { http_response_code(403); exit; }
        $user_id = $_SESSION['user_id'];
        
        $name = $_POST['name'] ?? '';
        $medical = $_POST['medical_condition'] ?? null;
        $gender = $_POST['gender'] ?? null;
        $email = $_POST['email'] ?? null;
        $phone = $_POST['phone'] ?? null;
        $address = $_POST['address'] ?? null;
        $profile_image = null;

        if (isset($_FILES['profile_image']) && $_FILES['profile_image']['error'] === UPLOAD_ERR_OK) {
            $upload_dir = __DIR__ . '/uploads/profiles/';
            if (!is_dir($upload_dir)) mkdir($upload_dir, 0777, true);
            
            // Delete old profile image if it exists
            $stmt = $pdo->prepare("SELECT profile_image FROM members WHERE id = ?");
            $stmt->execute([$user_id]);
            $old_image = $stmt->fetchColumn();
            if ($old_image && file_exists(__DIR__ . '/' . $old_image)) {
                unlink(__DIR__ . '/' . $old_image);
            }

            $ext = pathinfo($_FILES['profile_image']['name'], PATHINFO_EXTENSION);
            $filename = $user_id . '_' . time() . '.' . $ext;
            if (move_uploaded_file($_FILES['profile_image']['tmp_name'], $upload_dir . $filename)) {
                $profile_image = 'uploads/profiles/' . $filename;
                $_SESSION['profile_image'] = $profile_image;
            }
        }

        $sql = "UPDATE members SET name = ?, medical_condition = ?, gender = ?, email = ?, phone = ?, address = ?" . ($profile_image ? ", profile_image = ?" : "") . " WHERE id = ?";
        $params = [$name, $medical, $gender, $email, $phone, $address];
        if ($profile_image) $params[] = $profile_image;
        $params[] = $user_id;
        
        $pdo->prepare($sql)->execute($params);
        $_SESSION['name'] = $name;

        $response = ['status' => 'success', 'message' => 'Profile updated', 'profile_image' => $_SESSION['profile_image'] ?? null];
        break;

    case 'forgot_password':
        $data = json_decode(file_get_contents('php://input'), true);
        $identifier = trim($data['username'] ?? $data['username_or_email'] ?? '');
        if (!$identifier) {
            $response = ['status' => 'error', 'message' => 'Please enter your username'];
            break;
        }
        // Look up by username or email
        $stmt = $pdo->prepare("SELECT * FROM members WHERE username = ? OR email = ? LIMIT 1");
        $stmt->execute([$identifier, $identifier]);
        $user = $stmt->fetch();
        if (!$user) {
            $response = ['status' => 'error', 'message' => 'No user found with that username'];
            break;
        }
        $hasSecurity = !empty($user['security_answer']);
        if (!$hasSecurity) {
            $hasLegacy = !empty($user['security_answer_1']);
            if (!$hasLegacy) {
                $response = ['status' => 'error', 'message' => 'This account does not have a security question set up. Please contact an administrator.'];
                break;
            }
            $question = $user['security_question_1'] ?? 'What is the name of your first pet/dog?';
            $storedAnswer = $user['security_answer_1'];
        } else {
            $question = $user['security_question'];
            $storedAnswer = $user['security_answer'];
        }
        $response = [
            'status' => 'success',
            'message' => 'Account verified. Answer your security question to continue.',
            'user_id' => $user['id'],
            'name' => $user['name'],
            'question' => $question
        ];
        break;

    case 'reset_password':
        $data = json_decode(file_get_contents('php://input'), true);
        $userId = trim($data['user_id'] ?? '');
        $answer = trim($data['answer'] ?? '');
        $newPassword = $data['new_password'] ?? '';
        $confirmPassword = $data['confirm_password'] ?? '';

        if (!$userId || !$answer || !$newPassword || !$confirmPassword) {
            $response = ['status' => 'error', 'message' => 'All fields are required'];
            break;
        }
        if ($newPassword !== $confirmPassword) {
            $response = ['status' => 'error', 'message' => 'Passwords do not match'];
            break;
        }
        $pass_err = validate_password($newPassword);
        if ($pass_err !== true) {
            $response = ['status' => 'error', 'message' => $pass_err];
            break;
        }
        $stmt = $pdo->prepare("SELECT * FROM members WHERE id = ?");
        $stmt->execute([$userId]);
        $user = $stmt->fetch();
        if (!$user) {
            $response = ['status' => 'error', 'message' => 'User not found'];
            break;
        }
        $hasSecurity = !empty($user['security_answer']);
        if (!$hasSecurity) {
            $storedAnswer = $user['security_answer_1'] ?? '';
        } else {
            $storedAnswer = $user['security_answer'];
        }
        $isCorrect = (strcasecmp($answer, $storedAnswer) === 0);

        if (!$isCorrect) {
            $response = ['status' => 'error', 'message' => 'Answer does not match your security question.'];
            break;
        }
        $hashedPassword = password_hash($newPassword, PASSWORD_DEFAULT);
        $pdo->prepare("UPDATE members SET password = ? WHERE id = ?")->execute([$hashedPassword, $userId]);
        $response = [
            'status' => 'success',
            'message' => 'Password reset successful! You can now log in with your new password.'
        ];
        break;

    case 'staff_update_coach_availability':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Staff', 'Admin'])) {
            http_response_code(403); exit;
        }
        $data = json_decode(file_get_contents('php://input'), true);
        $coachId = $data['coach_id'] ?? '';
        $date = $data['date'] ?? '';
        $status = $data['status'] ?? 'Available';
        if (!$coachId || !$date) {
            $response = ['status' => 'error', 'message' => 'Coach ID and date required'];
            break;
        }
        // Insert or update coach availability
        $stmt = $pdo->prepare("INSERT INTO coach_availability (coach_id, available_date, status) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE status = ?");
        $stmt->execute([$coachId, $date, $status, $status]);
        $response = ['status' => 'success', 'message' => 'Availability updated'];
        break;

    case 'change_password':
        if (!isset($_SESSION['user_id'])) { http_response_code(403); exit; }
        $data = json_decode(file_get_contents('php://input'), true);
        $newPassword = $data['new_password'] ?? '';
        $confirmPassword = $data['confirm_password'] ?? '';

        if (!$newPassword || !$confirmPassword) {
            $response = ['status' => 'error', 'message' => 'All fields are required'];
            break;
        }
        if ($newPassword !== $confirmPassword) {
            $response = ['status' => 'error', 'message' => 'Passwords do not match'];
            break;
        }
        $pass_err = validate_password($newPassword);
        if ($pass_err !== true) {
            $response = ['status' => 'error', 'message' => $pass_err];
            break;
        }
        $stmt = $pdo->prepare("SELECT * FROM members WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        $user = $stmt->fetch();
        if (!$user) {
            $response = ['status' => 'error', 'message' => 'User not found'];
            break;
        }
        $hashedPassword = password_hash($newPassword, PASSWORD_DEFAULT);
        $stmt = $pdo->prepare("UPDATE members SET password = ? WHERE id = ?");
        $stmt->execute([$hashedPassword, $_SESSION['user_id']]);
        $response = ['status' => 'success', 'message' => 'Password updated successfully'];
        break;

    case 'save_security_questions':
        if (!isset($_SESSION['user_id'])) { http_response_code(403); exit; }
        $data = json_decode(file_get_contents('php://input'), true);
        $question = trim($data['question'] ?? '');
        $answer = trim($data['answer'] ?? '');

        if (!$question || !$answer) {
            $response = ['status' => 'error', 'message' => 'Both security question and answer are required'];
            break;
        }
        $stmt = $pdo->prepare("UPDATE members SET 
            security_question = ?, security_answer = ?
            WHERE id = ?");
        $stmt->execute([$question, $answer, $_SESSION['user_id']]);
        $response = ['status' => 'success', 'message' => 'Security question saved successfully'];
        break;

    case 'get_security_questions':
        if (!isset($_SESSION['user_id'])) { http_response_code(403); exit; }
        $stmt = $pdo->prepare("SELECT 
            security_question, security_answer,
            security_question_1, security_answer_1
            FROM members WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        $row = $stmt->fetch();
        $hasNew = !empty($row['security_answer']);
        if (!$hasNew && !empty($row['security_answer_1'])) {
            $question = $row['security_question_1'] ?? 'What is the name of your first pet/dog?';
            $answer = $row['security_answer_1'];
            $isSetup = true;
        } else {
            $question = $row['security_question'] ?? '';
            $answer = $row['security_answer'] ?? '';
            $isSetup = $hasNew;
        }
        $response = [
            'status' => 'success',
            'security' => [
                'question' => $question,
                'answer' => $answer
            ],
            'is_setup' => $isSetup
        ];
        break;

    case 'get_profile':
        if (!isset($_SESSION['user_id'])) { http_response_code(403); exit; }
        $stmt = $pdo->prepare("SELECT name, username, medical_condition, profile_image, role, gender, email, phone, address,
            security_question, security_answer
            FROM members WHERE id = ?");
        $stmt->execute([$_SESSION['user_id']]);
        $response = ['status' => 'success', 'profile' => $stmt->fetch()];
        break;

    case 'run_email_cron':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Admin', 'Staff'])) {
            http_response_code(403); exit;
        }
        updateExpiries($pdo);
        $cronResults = fg_run_expiry_email_cron($pdo);
        $response = ['status' => 'success', 'results' => $cronResults];
        break;

    case 'send_test_email':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Admin', 'Staff'])) {
            http_response_code(403); exit;
        }
        $data = json_decode(file_get_contents('php://input'), true);
        $to = trim($data['to'] ?? '');
        if (!$to || !filter_var($to, FILTER_VALIDATE_EMAIL)) {
            $response = ['status' => 'error', 'message' => 'Valid recipient email is required'];
            break;
        }
        $subject = trim($data['subject'] ?? 'Fitclub Gym - Test Email');
        $mode = $data['mode'] ?? 'test';
        $today = date('Y-m-d');
        $sampleExpiry = date('Y-m-d', strtotime('+3 days'));
        if ($mode === 'renewal') {
            $body = fg_build_renewal_email('Test Member', $sampleExpiry, 30);
            $subject = 'Test: Membership Renewal Confirmation';
        } elseif ($mode === 'expiry') {
            $body = fg_build_expiry_warning_email('Test Member', $sampleExpiry, 3);
            $subject = 'Test: Membership Expiry Warning (3 days left)';
        } elseif ($mode === 'welcome') {
            $body = fg_build_welcome_email('Test Member', '00000000-0000-0000-0000-000000000000', $today, $sampleExpiry);
            $subject = 'Test: Welcome to Fitclub Gym';
        } else {
            $appName = SMTP_FROM_NAME;
            $year = date('Y');
            $body = <<<HTML
<!DOCTYPE html><html><head><meta charset="UTF-8"></head>
<body style="font-family:Arial,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:#fff;border-radius:8px;overflow:hidden;box-shadow:0 2px 10px rgba(0,0,0,0.1);">
<div style="background:linear-gradient(135deg,#1a1a1a 0%,#3a3a3a 100%);color:#d4af37;padding:30px;text-align:center;border-bottom:3px solid #d4af37;">
<h1 style="margin:0;font-size:28px;letter-spacing:1px;">FITCLUB GYM</h1>
<div style="font-size:14px;opacity:0.9;margin-top:5px;">Test Email Successful</div>
</div>
<div style="padding:35px 30px;color:#333;">
<div style="font-size:20px;font-weight:bold;margin-bottom:20px;color:#1a1a1a;">Hello! 👋</div>
<div style="line-height:1.7;font-size:15px;margin-bottom:25px;">
This is a <strong style="color:#d4af37;">test email</strong> from Fitclub Gym. If you are reading this, your SMTP email configuration is working correctly.
</div>
<div style="background:#fafafa;border:1px solid #e0e0e0;border-left:4px solid #d4af37;border-radius:6px;padding:20px;">
<div style="font-size:12px;text-transform:uppercase;letter-spacing:0.5px;color:#888;margin-bottom:5px;">Test Timestamp</div>
<div style="font-size:18px;font-weight:bold;color:#1a1a1a;">{$today} @ {$appName}</div>
</div>
<div style="border-top:1px solid #eee;margin:20px 0;"></div>
<div style="font-size:14px;color:#666;">
You can now receive automated notifications about membership renewals, expirations, and other important updates.
</div>
</div>
<div style="background:#1a1a1a;color:#aaa;text-align:center;padding:20px;font-size:12px;line-height:1.6;">
&copy; {$year} <strong style="color:#d4af37;">{$appName}</strong>. All rights reserved.
</div></div></body></html>
HTML;
        }
        $result = fg_send_email($to, $subject, $body, true);
        $response = ['status' => $result['success'] ? 'success' : 'error', 'message' => $result['success'] ? 'Test email sent successfully' : ($result['error'] ?? 'Failed to send'), 'log_id' => $result['log_id'] ?? null];
        break;

    case 'get_email_logs':
        if (!isset($_SESSION['user_id']) || !in_array($_SESSION['role'], ['Admin', 'Staff'])) {
            http_response_code(403); exit;
        }
        $limit = max(1, min(200, intval($_GET['limit'] ?? 100)));
        $statusFilter = $_GET['status'] ?? '';
        $sql = "SELECT id, recipient_email, subject, status, error_message, sent_at FROM email_logs ";
        $params = [];
        if ($statusFilter && in_array($statusFilter, ['pending', 'sent', 'failed'])) {
            $sql .= "WHERE status = ? ";
            $params[] = $statusFilter;
        }
        $sql .= "ORDER BY COALESCE(sent_at, created_at) DESC LIMIT " . intval($limit);
        $logsStmt = $pdo->prepare($sql);
        $logsStmt->execute($params);
        $logs = $logsStmt->fetchAll();
        $stats = $pdo->query("SELECT status, COUNT(*) as cnt FROM email_logs GROUP BY status")->fetchAll(PDO::FETCH_KEY_PAIR);
        $response = ['status' => 'success', 'logs' => $logs, 'stats' => [
            'total' => array_sum($stats),
            'sent' => intval($stats['sent'] ?? 0),
            'failed' => intval($stats['failed'] ?? 0),
            'pending' => intval($stats['pending'] ?? 0)
        ]];
        break;

    case 'cron_endpoint':
        $authKey = $_GET['key'] ?? $_SERVER['HTTP_X_CRON_KEY'] ?? '';
        $expectedKey = '';
        try {
            $keyStmt = $pdo->prepare("SELECT settings_value FROM system_settings WHERE settings_key = 'cron_secret_key' LIMIT 1");
            $keyStmt->execute();
            $expectedKey = $keyStmt->fetchColumn() ?: '';
        } catch (Exception $e) {}
        if ($expectedKey && $authKey !== $expectedKey) {
            http_response_code(403);
            echo json_encode(['status' => 'error', 'message' => 'Invalid cron key']);
            exit;
        }
        updateExpiries($pdo);
        $cronResults = fg_run_expiry_email_cron($pdo);
        echo json_encode(['status' => 'success', 'results' => $cronResults, 'run_at' => date('c')]);
        exit;
    }
} catch (Exception $e) {
    $response = ['status' => 'error', 'message' => 'Server Error: ' . $e->getMessage()];
}

echo json_encode($response);
