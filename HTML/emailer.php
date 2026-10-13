<?php
class FitclubGymEmailer {
    private $host;
    private $port;
    private $user;
    private $pass;
    private $fromEmail;
    private $fromName;
    private $timeout = 45;
    private $debug = false;
    private $socket;
    private $lastReply;
    private $sslUpgraded = false;

    public function __construct($host, $port, $user, $pass, $fromEmail, $fromName) {
        $this->host = $host;
        $this->port = $port;
        $this->user = trim($user);
        $this->pass = preg_replace('/\s+/', '', trim($pass));
        $this->fromEmail = trim($fromEmail);
        $this->fromName = $fromName;
    }

    public function enableDebug($enable = true) {
        $this->debug = $enable;
    }

    private function log($msg) {
        if ($this->debug) {
            error_log("[EMAILER] " . $msg);
        }
    }

    private function connect() {
        $this->sslUpgraded = false;
        $this->log("Connecting to {$this->host}:{$this->port}...");
        $context = stream_context_create([
            'ssl' => [
                'verify_peer' => true,
                'verify_peer_name' => true,
                'allow_self_signed' => false,
                'SNI_enabled' => true,
                'SNI_server_name' => $this->host,
                'peer_name' => $this->host,
                'disable_compression' => true,
                'ciphers' => 'ECDHE+AESGCM:DHE+AESGCM:HIGH:!aNULL:!MD5:!RC4:!DSS:!SHA1'
            ],
            'socket' => [
                'tcp_nodelay' => true
            ]
        ]);

        $errno = 0;
        $errstr = '';
        $connectRetries = 2;
        while ($connectRetries-- > 0 && !$this->socket) {
            $this->socket = @stream_socket_client(
                "tcp://{$this->host}:{$this->port}",
                $errno,
                $errstr,
                $this->timeout,
                STREAM_CLIENT_CONNECT,
                $context
            );
            if (!$this->socket && $connectRetries > 0) {
                usleep(300000);
            }
        }

        if (!$this->socket) {
            $this->log("TCP connect failed: $errstr ($errno); attempting ssl:// fallback...");
            $sslRetries = 2;
            while ($sslRetries-- > 0 && !$this->socket) {
                $this->socket = @stream_socket_client(
                    "ssl://{$this->host}:465",
                    $errno,
                    $errstr,
                    $this->timeout,
                    STREAM_CLIENT_CONNECT,
                    $context
                );
                if (!$this->socket && $sslRetries > 0) {
                    usleep(300000);
                }
            }
            if (!$this->socket) {
                throw new Exception("Failed to connect to SMTP server (tcp:{$this->port} or ssl:465). Last error: $errstr ($errno)");
            }
            $this->log("Connected via ssl://465 fallback");
            $this->sslUpgraded = true;
        }

        stream_set_timeout($this->socket, $this->timeout);
        $this->readReply();
        if (strpos($this->lastReply, '220') !== 0) {
            throw new Exception("Unexpected SMTP greeting: {$this->lastReply}");
        }
        $this->log("Connected successfully");
        return true;
    }

    private function readReply() {
        $this->lastReply = '';
        $started = microtime(true);
        while (microtime(true) - $started < $this->timeout) {
            $str = @fgets($this->socket, 1024);
            if ($str === false) {
                if (feof($this->socket)) break;
                usleep(100000);
                continue;
            }
            $this->lastReply .= $str;
            if (isset($str[3]) && $str[3] == ' ') {
                break;
            }
        }
        $this->log("SERVER: " . trim($this->lastReply));
        return $this->lastReply;
    }

    private function sendCommand($cmd, $expectCode = '250') {
        $this->log("CLIENT: $cmd");
        $toSend = $cmd . "\r\n";
        $total = strlen($toSend);
        $written = 0;
        while ($written < $total) {
            $n = @fwrite($this->socket, substr($toSend, $written));
            if ($n === false || $n === 0) {
                throw new Exception("Socket write failed during command: $cmd");
            }
            $written += $n;
        }
        $this->readReply();
        if (strpos($this->lastReply, $expectCode) !== 0) {
            throw new Exception("SMTP command [$cmd] failed. Expected '$expectCode', got: {$this->lastReply}");
        }
        return true;
    }

    private function ehlo() {
        // Gmail (and most SMTP servers) REQUIRE a syntactically valid EHLO identity.
        // Random Windows hostnames can include spaces / Unicode / underscores — any of
        // those cause 501 Syntax errors or Gmail silently deferring delivery.
        $hostname = 'fitclubgym.local';
        if (!empty($_SERVER['HTTP_HOST'])) {
            $h = explode(':', $_SERVER['HTTP_HOST'])[0];
            if ($h && preg_match('/^[a-zA-Z0-9.\-]+$/', $h) && strpos($h, '.') !== false) {
                $hostname = $h;
            }
        }
        $this->sendCommand("EHLO $hostname", '250');
    }

    private function startTLS() {
        if (!empty($this->sslUpgraded)) {
            $this->log("Skipping STARTTLS (already connected via ssl://)");
            return;
        }
        $this->sendCommand("STARTTLS", '220');
        $cryptoMethod = 0;
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT')) {
            $cryptoMethod |= STREAM_CRYPTO_METHOD_TLSv1_3_CLIENT;
        }
        if (defined('STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT')) {
            $cryptoMethod |= STREAM_CRYPTO_METHOD_TLSv1_2_CLIENT;
        }
        if (!$cryptoMethod) {
            $cryptoMethod = STREAM_CRYPTO_METHOD_TLS_CLIENT;
        }
        $retries = 0;
        $cryptoEnabled = false;
        while ($retries < 3) {
            $cryptoEnabled = @stream_socket_enable_crypto($this->socket, true, $cryptoMethod);
            if ($cryptoEnabled === true) break;
            if ($cryptoEnabled === false) {
                $retries++;
                usleep(200000);
                continue;
            }
            $retries++;
            usleep(100000);
        }
        if (!$cryptoEnabled) {
            $sslError = @openssl_error_string();
            throw new Exception("Failed to enable TLS encryption after 3 attempts" . ($sslError ? ": $sslError" : ""));
        }
        $this->log("TLS enabled successfully");
        $this->ehlo();
    }

    private function authenticate() {
        $this->sendCommand("AUTH LOGIN", '334');
        $this->sendCommand(base64_encode($this->user), '334');
        $this->sendCommand(base64_encode($this->pass), '235');
        $this->log("Authenticated as {$this->user}");
    }

    private function encodeHeader($str) {
        if ($str === null || $str === '') return '';
        if (preg_match('/[\x80-\xFF]/', $str)) {
            return '=?UTF-8?B?' . base64_encode($str) . '?=';
        }
        return $str;
    }

    private function buildMessage($to, $subject, $body, $isHtml = true, $attachments = []) {
        $boundaryMixed  = 'Mix_' . md5(uniqid((string)mt_rand(), true));
        $boundaryAlt    = 'Alt_' . md5(uniqid((string)mt_rand(), true));
        $fromEncoded    = $this->encodeHeader($this->fromName);
        $subjectEncoded = $this->encodeHeader($subject);
        $host           = 'fitclubgym.local';
        if (!empty($_SERVER['HTTP_HOST'])) {
            $h = explode(':', $_SERVER['HTTP_HOST'])[0];
            if ($h && preg_match('/^[a-zA-Z0-9.\-]+$/', $h)) $host = $h;
        }
        $msgId = '<' . md5(uniqid((string)mt_rand(), true)) . '.' . time() . "@{$host}>";

        // Plain-text fallback for spam-filter friendliness (strips HTML).
        $plainBody = $body;
        if ($isHtml) {
            $plainBody = preg_replace('/<br\s*\/?>/i', "\n", $body);
            $plainBody = preg_replace('/<\/p>/i', "\n\n", $plainBody);
            $plainBody = html_entity_decode(strip_tags($plainBody), ENT_QUOTES | ENT_HTML5, 'UTF-8');
            $plainBody = preg_replace('/^[ \t]+/m', '', $plainBody);
            $plainBody = preg_replace('/\n{3,}/', "\n\n", $plainBody);
            $plainBody = trim($plainBody);
        }

        $headers = [];
        $headers[] = "Date: " . date('r');
        $headers[] = "Message-ID: $msgId";
        $headers[] = "Return-Path: <{$this->fromEmail}>";
        $headers[] = "Sender: $fromEncoded <{$this->fromEmail}>";
        $headers[] = "From: $fromEncoded <{$this->fromEmail}>";
        $headers[] = "Reply-To: $fromEncoded <{$this->fromEmail}>";
        $headers[] = "To: <{$to}>";
        $headers[] = "Subject: $subjectEncoded";
        $headers[] = "MIME-Version: 1.0";
        $headers[] = "X-Mailer: FitclubGym/1.0 (PHP SMTP Client)";
        $headers[] = "X-Priority: 3 (Normal)";
        $headers[] = "X-MS-Exchange-Organization-AuthAs: Internal";
        $headers[] = "Disposition-Notification-To: <{$this->fromEmail}>";
        $headers[] = "List-Unsubscribe: <mailto:{$this->fromEmail}?subject=unsubscribe>, <https://{$host}/unsubscribe>";
        $headers[] = "Precedence: bulk";
        $headers[] = "Auto-Submitted: auto-generated";

        $message = '';
        $useAttachments = !empty($attachments);

        if ($useAttachments) {
            $headers[] = "Content-Type: multipart/mixed; boundary=\"$boundaryMixed\"";
            $message .= "--$boundaryMixed\r\n";
            $message .= "Content-Type: multipart/alternative; boundary=\"$boundaryAlt\"\r\n\r\n";
        } else {
            $headers[] = "Content-Type: multipart/alternative; boundary=\"$boundaryAlt\"";
        }

        // Plain text part
        $message .= "--$boundaryAlt\r\n";
        $message .= "Content-Type: text/plain; charset=UTF-8\r\n";
        $message .= "Content-Transfer-Encoding: quoted-printable\r\n\r\n";
        $message .= quoted_printable_encode($plainBody) . "\r\n";

        // HTML part
        $message .= "--$boundaryAlt\r\n";
        $message .= "Content-Type: text/html; charset=UTF-8\r\n";
        $message .= "Content-Transfer-Encoding: quoted-printable\r\n\r\n";
        $message .= quoted_printable_encode($body) . "\r\n";

        $message .= "--$boundaryAlt--\r\n";

        if ($useAttachments) {
            foreach ($attachments as $att) {
                $message .= "\r\n--$boundaryMixed\r\n";
                $filename = $this->encodeHeader(basename($att['name']));
                $message .= "Content-Type: application/octet-stream; name=\"$filename\"\r\n";
                $message .= "Content-Disposition: attachment; filename=\"$filename\"\r\n";
                $message .= "Content-Transfer-Encoding: base64\r\n\r\n";
                $message .= chunk_split(base64_encode($att['data']));
            }
            $message .= "\r\n--$boundaryMixed--\r\n";
        }

        return [implode("\r\n", $headers), $message];
    }

    public function send($to, $subject, $body, $isHtml = true, $attachments = []) {
        $to = trim((string)$to);
        if (empty($to)) {
            throw new Exception("Recipient email is required");
        }
        if (!filter_var($to, FILTER_VALIDATE_EMAIL)) {
            throw new Exception("Invalid recipient email address: [$to]");
        }

        try {
            $this->connect();
            $this->ehlo();
            $this->startTLS();

            // CRITICAL: After stream_socket_enable_crypto, on some PHP/Windows builds
            // the stream timeout is LOST and fread/fwrite hang forever. Reset it.
            if ($this->socket && is_resource($this->socket)) {
                stream_set_timeout($this->socket, $this->timeout);
                stream_set_blocking($this->socket, true);
            }

            $this->authenticate();

            // Reset SMTP state before MAIL FROM (defensive)
            try { $this->sendCommand("RSET", '250'); } catch (Exception $rsetEx) { /* ignore */ }

            $this->sendCommand("MAIL FROM:<{$this->fromEmail}>", '250');
            $this->sendCommand("RCPT TO:<{$to}>", '250');
            $this->sendCommand("DATA", '354');

            list($headers, $message) = $this->buildMessage($to, $subject, $body, $isHtml, $attachments);
            $fullData = $headers . "\r\n\r\n" . $message . "\r\n.\r\n";

            $total = strlen($fullData);
            $written = 0;
            while ($written < $total) {
                $n = @fwrite($this->socket, substr($fullData, $written));
                if ($n === false || $n === 0) {
                    $meta = stream_get_meta_data($this->socket);
                    if (!empty($meta['timed_out'])) {
                        throw new Exception("Socket write timed out at byte $written/$total");
                    }
                    throw new Exception("Socket write failed while transmitting message body at byte $written/$total");
                }
                $written += $n;
            }
            $this->readReply();
            // Gmail 421 / 45x = temporary rate-limit — retry once silently
            if (strpos($this->lastReply, '250') !== 0 && (strpos($this->lastReply, '421') === 0 || strpos($this->lastReply, '45') === 0)) {
                $this->log("Temporary SMTP reject, retrying once: {$this->lastReply}");
                usleep(500000);
                try { $this->sendCommand("RSET", '250'); } catch (Exception $rsetEx) {}
                $this->sendCommand("MAIL FROM:<{$this->fromEmail}>", '250');
                $this->sendCommand("RCPT TO:<{$to}>", '250');
                $this->sendCommand("DATA", '354');
                $written2 = 0;
                while ($written2 < $total) {
                    $n2 = @fwrite($this->socket, substr($fullData, $written2));
                    if ($n2 === false || $n2 === 0) break;
                    $written2 += $n2;
                }
                $this->readReply();
            }
            if (strpos($this->lastReply, '250') !== 0) {
                throw new Exception("Gmail rejected message: {$this->lastReply}");
            }

            try { $this->sendCommand("QUIT", '221'); } catch (Exception $quitEx) { /* ignore QUIT errors */ }
            if ($this->socket && is_resource($this->socket)) {
                @fclose($this->socket);
            }
            $this->socket = null;
            $this->log("Email sent successfully to $to ($total bytes transmitted)");
            return true;
        } catch (Exception $e) {
            if ($this->debug) {
                error_log("[EMAILER-FAIL] to=$to subj=" . substr($subject,0,40) . " err=" . $e->getMessage());
            }
            if ($this->socket && is_resource($this->socket)) {
                @fclose($this->socket);
            }
            $this->socket = null;
            $this->log("Error: " . $e->getMessage());
            throw $e;
        }
    }
}

function fg_get_emailer() {
    if (!defined('SMTP_HOST') || !SMTP_HOST) {
        return null;
    }
    try {
        return new FitclubGymEmailer(
            SMTP_HOST,
            SMTP_PORT,
            SMTP_USER,
            SMTP_PASS,
            SMTP_FROM,
            SMTP_FROM_NAME
        );
    } catch (Exception $e) {
        error_log("Emailer init failed: " . $e->getMessage());
        return null;
    }
}

function fg_send_email($to, $subject, $body, $isHtml = true) {
    global $pdo;
    $emailer = fg_get_emailer();
    $logId = null;
    $sent = false;
    $errorMsg = null;

    try {
        $logStmt = $pdo->prepare("INSERT INTO email_logs (recipient_email, subject, body, status, error_message, sent_at) VALUES (?, ?, ?, 'pending', ?, NOW())");
        $logStmt->execute([
            $to,
            $subject,
            $isHtml ? $body : (strip_tags($body) ?: $body),
            null
        ]);
        $logId = $pdo->lastInsertId();
        if (!$logId) {
            // MySQL multi-insert edge case: re-query the row we just created
            $backfill = $pdo->prepare("SELECT id FROM email_logs WHERE recipient_email = ? AND subject = ? ORDER BY id DESC LIMIT 1");
            $backfill->execute([$to, $subject]);
            $logId = $backfill->fetchColumn() ?: null;
        }
    } catch (Exception $e) {
        $errorMsg = "Log init failed: " . $e->getMessage() . " | class=" . get_class($e);
        if ($this ?? false) {}
        error_log("[FG_EMAIL] log insert failed: " . $e->getMessage());
    }

    if (!$emailer) {
        $errorMsg = $errorMsg ?? "Email not configured (SMTP constants missing or empty). Check config.php SMTP_* values and $use_email=true.";
        if ($logId) {
            try {
                $pdo->prepare("UPDATE email_logs SET status = 'failed', error_message = ? WHERE id = ?")
                    ->execute([$errorMsg, $logId]);
            } catch (Exception $e) { error_log("[FG_EMAIL] status update failed: ".$e->getMessage()); }
        }
        return ['success' => false, 'error' => $errorMsg, 'log_id' => $logId];
    }

    try {
        $sent = $emailer->send($to, $subject, $body, $isHtml);
    } catch (Exception $e) {
        $errorMsg = $e->getMessage();
        error_log("[FG_EMAIL] send failed to=$to: " . $errorMsg);
    }

    if ($logId) {
        try {
            $updateStmt = $pdo->prepare("UPDATE email_logs SET status = ?, error_message = ?, sent_at = NOW() WHERE id = ?");
            $updateStmt->execute([
                $sent ? 'sent' : 'failed',
                $errorMsg,
                $logId
            ]);
        } catch (Exception $e) {
            error_log("[FG_EMAIL] final status update failed: ".$e->getMessage());
        }
    } else {
        // We weren't able to capture a log id earlier. Try inserting a final status row now.
        try {
            $fallbackStmt = $pdo->prepare("INSERT INTO email_logs (recipient_email, subject, body, status, error_message, sent_at) VALUES (?, ?, ?, ?, ?, NOW())");
            $fallbackStmt->execute([
                $to,
                $subject,
                $isHtml ? substr($body,0,65535) : substr(strip_tags($body)?:$body,0,65535),
                $sent ? 'sent' : 'failed',
                $errorMsg
            ]);
            $logId = $pdo->lastInsertId();
        } catch (Exception $e) { /* nothing more we can do */ }
    }

    return ['success' => (bool)$sent, 'error' => $errorMsg, 'log_id' => $logId];
}

function fg_build_renewal_email($memberName, $expiresOn, $durationDays) {
    $formattedExpiry = date('F j, Y', strtotime($expiresOn));
    $appName = SMTP_FROM_NAME;
    $year = date('Y');
    return <<<HTML
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Membership Renewed - $appName</title>
<style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%); color: #d4af37; padding: 30px; text-align: center; border-bottom: 3px solid #d4af37; }
    .header h1 { margin: 0; font-size: 28px; letter-spacing: 1px; }
    .header .brand { font-size: 14px; opacity: 0.9; margin-top: 5px; }
    .content { padding: 35px 30px; color: #333; }
    .greeting { font-size: 20px; font-weight: bold; margin-bottom: 20px; color: #1a1a1a; }
    .message { line-height: 1.7; font-size: 15px; margin-bottom: 25px; }
    .card { background: #fafafa; border: 1px solid #e0e0e0; border-left: 4px solid #d4af37; border-radius: 6px; padding: 20px; margin: 20px 0; }
    .card-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 5px; }
    .card-value { font-size: 18px; font-weight: bold; color: #1a1a1a; }
    .badge { display: inline-block; background: #d4af37; color: #1a1a1a; padding: 6px 16px; border-radius: 20px; font-weight: bold; font-size: 13px; margin-top: 10px; }
    .footer { background: #1a1a1a; color: #aaa; text-align: center; padding: 20px; font-size: 12px; line-height: 1.6; }
    .footer strong { color: #d4af37; }
    .divider { border-top: 1px solid #eee; margin: 20px 0; }
    .highlight { color: #d4af37; font-weight: bold; }
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>FITCLUB GYM</h1>
        <div class="brand">Your Fitness Journey Continues</div>
    </div>
    <div class="content">
        <div class="greeting">Hi, $memberName! 🎉</div>
        <div class="message">
            Great news! Your gym membership has been <span class="highlight">successfully renewed</span>. Thank you for your continued trust in <strong>$appName</strong>. Keep pushing your limits and crushing those goals!
        </div>
        <div class="card">
            <div class="card-label">New Expiration Date</div>
            <div class="card-value">$formattedExpiry</div>
            <div class="badge">$durationDays Day(s) Added</div>
        </div>
        <div class="divider"></div>
        <div class="message" style="font-size: 14px; color: #666;">
            If you have any questions about your membership, feel free to visit us at the gym or contact our staff. We're here to support you!
        </div>
    </div>
    <div class="footer">
        &copy; $year <strong>$appName</strong>. All rights reserved.<br>
        This email was sent because of a membership renewal action on your account.
    </div>
</div>
</body>
</html>
HTML;
}

function fg_build_expiry_warning_email($memberName, $expiresOn, $daysLeft) {
    $formattedExpiry = date('F j, Y', strtotime($expiresOn));
    $appName = SMTP_FROM_NAME;
    $year = date('Y');
    return <<<HTML
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Membership Expiring Soon - $appName</title>
<style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1a1a1a 0%, #8b0000 100%); color: #ffd700; padding: 30px; text-align: center; border-bottom: 3px solid #d4af37; }
    .header h1 { margin: 0; font-size: 28px; letter-spacing: 1px; }
    .header .brand { font-size: 14px; opacity: 0.9; margin-top: 5px; }
    .content { padding: 35px 30px; color: #333; }
    .greeting { font-size: 20px; font-weight: bold; margin-bottom: 20px; color: #1a1a1a; }
    .message { line-height: 1.7; font-size: 15px; margin-bottom: 25px; }
    .warning-box { background: #fff8e1; border: 1px solid #ffe082; border-left: 4px solid #d4af37; border-radius: 6px; padding: 20px; margin: 20px 0; }
    .days-badge { display: inline-block; background: #d4af37; color: #1a1a1a; padding: 10px 24px; border-radius: 30px; font-weight: bold; font-size: 22px; margin: 10px 0; }
    .expiry-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 5px; }
    .expiry-value { font-size: 18px; font-weight: bold; color: #8b0000; }
    .divider { border-top: 1px solid #eee; margin: 20px 0; }
    .cta-box { background: #1a1a1a; color: #fff; border-radius: 6px; padding: 25px; text-align: center; margin: 20px 0; }
    .cta-title { font-size: 18px; font-weight: bold; color: #d4af37; margin-bottom: 10px; }
    .cta-text { font-size: 14px; opacity: 0.9; line-height: 1.6; }
    .footer { background: #1a1a1a; color: #aaa; text-align: center; padding: 20px; font-size: 12px; line-height: 1.6; }
    .footer strong { color: #d4af37; }
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>FITCLUB GYM</h1>
        <div class="brand">Membership Renewal Reminder</div>
    </div>
    <div class="content">
        <div class="greeting">Hi, $memberName! ⚠️</div>
        <div class="message">
            This is a friendly reminder that your gym membership with <strong>$appName</strong> will expire soon. Renew now to continue your fitness journey without interruption!
        </div>
        <div class="warning-box" style="text-align: center;">
            <div style="font-size: 14px; color: #888; text-transform: uppercase; letter-spacing: 1px;">Time Remaining</div>
            <div class="days-badge">$daysLeft DAY(S) LEFT</div>
            <div class="expiry-label">Expires On</div>
            <div class="expiry-value">$formattedExpiry</div>
        </div>
        <div class="cta-box">
            <div class="cta-title">Don't Lose Your Gains! 💪</div>
            <div class="cta-text">
                Visit <strong>$appName</strong> today to renew your membership before it expires.<br>
                Our staff is ready to assist you with a new plan that fits your goals.
            </div>
        </div>
        <div class="divider"></div>
        <div class="message" style="font-size: 14px; color: #666;">
            If you have already renewed, thank you! Please disregard this message. Otherwise, we look forward to helping you continue your fitness journey.
        </div>
    </div>
    <div class="footer">
        &copy; $year <strong>$appName</strong>. All rights reserved.<br>
        This is an automated membership reminder. If you believe you received this email in error, please contact our staff.
    </div>
</div>
</body>
</html>
HTML;
}

function fg_build_welcome_email($memberName, $memberId, $startDate, $expiresOn) {
    $formattedStart = date('F j, Y', strtotime($startDate));
    $formattedExpiry = $expiresOn ? date('F j, Y', strtotime($expiresOn)) : 'Permanent';
    $appName = SMTP_FROM_NAME;
    $year = date('Y');
    return <<<HTML
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Welcome to $appName</title>
<style>
    body { font-family: Arial, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
    .container { max-width: 600px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 10px rgba(0,0,0,0.1); }
    .header { background: linear-gradient(135deg, #1a1a1a 0%, #3a3a3a 100%); color: #d4af37; padding: 30px; text-align: center; border-bottom: 3px solid #d4af37; }
    .header h1 { margin: 0; font-size: 28px; letter-spacing: 1px; }
    .header .brand { font-size: 14px; opacity: 0.9; margin-top: 5px; }
    .content { padding: 35px 30px; color: #333; }
    .greeting { font-size: 20px; font-weight: bold; margin-bottom: 20px; color: #1a1a1a; }
    .message { line-height: 1.7; font-size: 15px; margin-bottom: 25px; }
    .card { background: #fafafa; border: 1px solid #e0e0e0; border-left: 4px solid #d4af37; border-radius: 6px; padding: 20px; margin: 15px 0; }
    .card-label { font-size: 12px; text-transform: uppercase; letter-spacing: 0.5px; color: #888; margin-bottom: 5px; }
    .card-value { font-size: 16px; font-weight: bold; color: #1a1a1a; word-break: break-all; }
    .divider { border-top: 1px solid #eee; margin: 20px 0; }
    .benefits { background: #1a1a1a; color: #fff; border-radius: 6px; padding: 25px; margin: 20px 0; }
    .benefits h3 { color: #d4af37; margin-top: 0; font-size: 18px; }
    .benefits ul { padding-left: 20px; line-height: 2; font-size: 14px; }
    .footer { background: #1a1a1a; color: #aaa; text-align: center; padding: 20px; font-size: 12px; line-height: 1.6; }
    .footer strong { color: #d4af37; }
    .highlight { color: #d4af37; font-weight: bold; }
</style>
</head>
<body>
<div class="container">
    <div class="header">
        <h1>FITCLUB GYM</h1>
        <div class="brand">Welcome to Our Fitness Family!</div>
    </div>
    <div class="content">
        <div class="greeting">Hi, $memberName! 🏋️</div>
        <div class="message">
            <strong>Welcome to $appName!</strong> We're thrilled to have you join our fitness community. Get ready to transform your body, push your limits, and achieve your fitness goals with us.
        </div>
        <div class="card">
            <div class="card-label">Member ID</div>
            <div class="card-value">$memberId</div>
        </div>
        <div class="card">
            <div class="card-label">Membership Start Date</div>
            <div class="card-value">$formattedStart</div>
        </div>
        <div class="card">
            <div class="card-label">Expiration Date</div>
            <div class="card-value">$formattedExpiry</div>
        </div>
        <div class="benefits">
            <h3>What You Get As A Member 🎁</h3>
            <ul>
                <li>Full access to all gym equipment &amp; facilities</li>
                <li>Professional coaching consultations available</li>
                <li>Personalized workout routines</li>
                <li>Attendance tracking &amp; progress monitoring</li>
                <li>Friendly &amp; motivating gym environment</li>
            </ul>
        </div>
        <div class="divider"></div>
        <div class="message" style="font-size: 14px; color: #666;">
            Need help getting started? Just ask any of our staff or coaches! We're here to help you every step of the way. Let's make this your best fitness chapter yet!
        </div>
    </div>
    <div class="footer">
        &copy; $year <strong>$appName</strong>. All rights reserved.<br>
        This email confirms your new membership registration with us.
    </div>
</div>
</body>
</html>
HTML;
}
?>