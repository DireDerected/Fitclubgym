<?php
require __DIR__ . '/HTML/config.php';
$coach_id = $pdo->query("SELECT id FROM coaches WHERE member_id='cc562001-0549-4425-8b4c-5eb98008da55'")->fetchColumn();
// Add a test photo
$ins = $pdo->prepare("INSERT INTO coach_credential_photos (coach_id, image_path) VALUES (?, ?)");
$ins->execute([$coach_id, 'uploads/test_credential.png']);
echo "Added test photo for coach $coach_id\n";
$photos = $pdo->query("SELECT * FROM coach_credential_photos WHERE coach_id=$coach_id")->fetchAll(PDO::FETCH_ASSOC);
foreach ($photos as $p) echo "  id={$p['id']} path={$p['image_path']}\n";
