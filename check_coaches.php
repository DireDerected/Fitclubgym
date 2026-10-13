<?php
require __DIR__ . '/HTML/config.php';
echo "SQL mode: " . $pdo->query("SELECT @@sql_mode")->fetchColumn() . PHP_EOL;
echo "PHP upload_max_filesize: " . ini_get('upload_max_filesize') . PHP_EOL;
echo "PHP post_max_size: " . ini_get('post_max_size') . PHP_EOL;
