<?php
// Standalone cron runner for Fitclub Gym membership email notifications
// Usage (CLI - Windows Task Scheduler):
//   "C:\Path\To\php.exe" -f "C:\laragon\www\FitclubGym\cron_email.php"
// Usage (HTTP - protected by key):
//   http://localhost/FitclubGym/cron_email.php?key=YOUR_CRON_SECRET_KEY

define('CRON_RUNNER', true);
require_once __DIR__ . '/HTML/config.php';

date_default_timezone_set('Asia/Manila');

header('Content-Type: application/json');

$isCli = (php_sapi_name() === 'cli');

if (!$isCli) {
    $authKey = $_GET['key'] ?? $_SERVER['HTTP_X_CRON_KEY'] ?? '';
    $expectedKey = '';
    try {
        $keyStmt = $pdo->prepare("SELECT settings_value FROM system_settings WHERE settings_key = 'cron_secret_key' LIMIT 1");
        $keyStmt->execute();
        $expectedKey = $keyStmt->fetchColumn() ?: '';
    } catch (Exception $e) {}
    if (!$expectedKey) {
        http_response_code(500);
        echo json_encode(['status' => 'error', 'message' => 'Cron key not initialized. Run the system once via browser first.']);
        exit;
    }
    if ($authKey !== $expectedKey) {
        http_response_code(403);
        echo json_encode(['status' => 'error', 'message' => 'Invalid cron key']);
        exit;
    }
}

try {
    $cronKeyOutput = '';
    try {
        $keyStmt = $pdo->prepare("SELECT settings_value FROM system_settings WHERE settings_key = 'cron_secret_key' LIMIT 1");
        $keyStmt->execute();
        $cronKeyOutput = $keyStmt->fetchColumn() ?: '';
    } catch (Exception $e) {}

    updateExpiries($pdo);
    $results = fg_run_expiry_email_cron($pdo);

    $totalSent = $results['expiry_3d']['sent'] + $results['expiry_1d']['sent'] + $results['expired']['sent'];
    $totalFailed = $results['expiry_3d']['failed'] + $results['expiry_1d']['failed'] + $results['expired']['failed'];
    $totalChecked = $results['expiry_3d']['checked'] + $results['expiry_1d']['checked'] + $results['expired']['checked'];

    $output = [
        'status' => 'success',
        'run_at' => date('c'),
        'summary' => [
            'total_checked' => $totalChecked,
            'total_sent' => $totalSent,
            'total_failed' => $totalFailed,
            'total_skipped' => ($results['expiry_3d']['skipped'] + $results['expiry_1d']['skipped'] + $results['expired']['skipped'])
        ],
        'details' => $results,
        'cron_endpoint_url' => $isCli ? '' : (isset($_SERVER['HTTP_HOST']) ? 'http' . (isset($_SERVER['HTTPS']) && $_SERVER['HTTPS'] ? 's' : '') . '://' . $_SERVER['HTTP_HOST'] . str_replace('\\', '/', dirname($_SERVER['PHP_SELF'] ?? '')) . '/cron_email.php?key=' . $cronKeyOutput : ''),
        'cron_secret_key' => $isCli ? $cronKeyOutput : '(use key parameter)',
        'cli_usage' => 'php.exe -f "' . __FILE__ . '"',
        'task_scheduler_hint' => 'Set Windows Task Scheduler to run daily at 8:00 AM using the CLI command above.'
    ];

    if ($isCli) {
        echo "\n";
        echo "=================================================================\n";
        echo " FITCLUB GYM - Membership Email Cron Runner\n";
        echo " Run Time: " . date('Y-m-d H:i:s') . "\n";
        echo "=================================================================\n";
        echo " Checked: $totalChecked member(s)\n";
        echo " Sent:    $totalSent email(s)\n";
        echo " Failed:  $totalFailed email(s)\n";
        echo " Skipped: " . $output['summary']['total_skipped'] . " (duplicates/no email)\n";
        echo "-----------------------------------------------------------------\n";
        echo " 3-day warnings:  sent={$results['expiry_3d']['sent']} failed={$results['expiry_3d']['failed']}\n";
        echo " 1-day warnings:  sent={$results['expiry_1d']['sent']} failed={$results['expiry_1d']['failed']}\n";
        echo " Expired today:   sent={$results['expired']['sent']} failed={$results['expired']['failed']}\n";
        echo "-----------------------------------------------------------------\n";
        if ($cronKeyOutput) {
            echo " Cron Secret Key: $cronKeyOutput\n";
            echo " HTTP URL: " . (isset($_SERVER['HTTP_HOST']) ? '' : 'http://localhost/') . basename(str_replace('\\', '/', __DIR__)) . "/cron_email.php?key=$cronKeyOutput\n";
        }
        echo " CLI Command: php.exe -f \"" . __FILE__ . "\"\n";
        if (!empty($results['errors'])) {
            echo "-----------------------------------------------------------------\n";
            echo " ERRORS:\n";
            foreach ($results['errors'] as $err) {
                echo "  - $err\n";
            }
        }
        echo "=================================================================\n\n";
    } else {
        echo json_encode($output, JSON_PRETTY_PRINT);
    }
} catch (Exception $e) {
    $errorOutput = ['status' => 'error', 'message' => $e->getMessage()];
    if ($isCli) {
        echo "\n[ERROR] " . $e->getMessage() . "\n";
        echo $e->getTraceAsString() . "\n\n";
    } else {
        http_response_code(500);
        echo json_encode($errorOutput);
    }
    exit(1);
}
?>