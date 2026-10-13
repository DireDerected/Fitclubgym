<?php
$img = imagecreatetruecolor(400, 300);
$bg = imagecolorallocate($img, 70, 130, 180);
imagefill($img, 0, 0, $bg);
$white = imagecolorallocate($img, 255, 255, 255);
imagestring($img, 5, 100, 130, "Credential Photo", $white);
imagepng($img, __DIR__ . '/uploads/test_credential.png');
imagedestroy($img);
echo "Created test image at uploads/test_credential.png\n";
