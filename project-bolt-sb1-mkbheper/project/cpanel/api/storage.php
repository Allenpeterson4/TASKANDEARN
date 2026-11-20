<?php
declare(strict_types=1);

function storage_buckets(): array
{
    return [
        'site-media' => ['public' => true, 'admin_upload' => true],
        'dashboard-ads' => ['public' => true, 'admin_upload' => true],
        'member-avatars' => ['public' => true, 'member_upload' => true],
        'task-proofs' => ['public' => false, 'member_upload' => true],
        'funding-proofs' => ['public' => false, 'member_upload' => true],
    ];
}

function storage_safe_path(string $path): string
{
    $path = str_replace('\\', '/', trim($path, '/'));
    $segments = explode('/', $path);
    if ($path === '' || strlen($path) > 1024) throw new InvalidArgumentException('Invalid storage path.');
    foreach ($segments as $segment) {
        if ($segment === '' || $segment === '.' || $segment === '..' || !preg_match('/^[A-Za-z0-9_.-]+$/', $segment)) {
            throw new InvalidArgumentException('Invalid storage path.');
        }
    }
    return implode('/', $segments);
}

function storage_safe_prefix(string $path): string
{
    $path = trim(str_replace('\\', '/', $path), '/');
    if ($path === '') return '';
    return storage_safe_path($path) . '/';
}

function storage_file_path(array $config, string $bucket, string $path, bool $createDirectory = false): string
{
    $root = rtrim((string)($config['storage']['path'] ?? ''), DIRECTORY_SEPARATOR);
    if ($root === '') throw new RuntimeException('Storage directory is not configured.');
    if (!is_dir($root) && !mkdir($root, 0750, true) && !is_dir($root)) throw new RuntimeException('Could not create storage directory.');
    $rootReal = realpath($root);
    if ($rootReal === false) throw new RuntimeException('Storage directory is unavailable.');
    $target = $rootReal . DIRECTORY_SEPARATOR . $bucket . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $path);
    $parent = dirname($target);
    if ($createDirectory && !is_dir($parent) && !mkdir($parent, 0750, true) && !is_dir($parent)) {
        throw new RuntimeException('Could not create storage subdirectory.');
    }
    if (is_dir($parent)) {
        $parentReal = realpath($parent);
        if ($parentReal === false || !str_starts_with($parentReal . DIRECTORY_SEPARATOR, $rootReal . DIRECTORY_SEPARATOR)) {
            throw new RuntimeException('Storage path is outside the configured directory.');
        }
    }
    return $target;
}

function storage_user(PDO $pdo, array $config, string $bucket, string $path, bool $write = false): array
{
    $buckets = storage_buckets();
    if (!isset($buckets[$bucket])) respond(['error' => 'Unknown storage bucket.'], 404);
    $user = request_user($pdo, $config);
    $admin = $user && ($user['app_metadata']['role'] ?? '') === 'admin';
    if ($admin) {
        require_admin($pdo, $config);
        return [$user, $buckets[$bucket]];
    }
    if (!$user) respond(['error' => 'Sign in to access this file.'], 401);
    if ($write && empty($buckets[$bucket]['member_upload'])) respond(['error' => 'Uploads to this bucket are not allowed.'], 403);
    if (empty($buckets[$bucket]['member_upload']) && empty($buckets[$bucket]['public'])) {
        respond(['error' => 'Administrator access is required.'], 403);
    }
    if (!str_starts_with($path, $user['id'] . '/')) respond(['error' => 'You do not have access to this file.'], 403);
    return [$user, $buckets[$bucket]];
}

function execute_storage_request(PDO $pdo, array $config, string $action, array $body): array
{
    $bucket = (string)($body['bucket'] ?? '');
    $policy = storage_buckets()[$bucket] ?? null;
    if (!$policy) throw new InvalidArgumentException('Unknown storage bucket.');
    if ($action === 'list') {
        require_admin($pdo, $config);
        $prefix = storage_safe_prefix((string)($body['path'] ?? ''));
        $limit = max(1, min(500, (int)($body['limit'] ?? 100)));
        $sortColumn = (string)($body['sortBy']['column'] ?? 'created_at');
        if (!in_array($sortColumn, ['created_at', 'object_path'], true)) $sortColumn = 'created_at';
        $sortOrder = strtolower((string)($body['sortBy']['order'] ?? 'desc')) === 'asc' ? 'ASC' : 'DESC';
        $statement = $pdo->prepare('SELECT object_path, created_at FROM storage_files WHERE bucket = ? AND object_path LIKE ? ORDER BY `' . $sortColumn . '` ' . $sortOrder . ' LIMIT ' . $limit);
        $statement->execute([$bucket, $prefix . '%']);
        return ['data' => array_map(static function (array $file): array {
            $file['name'] = basename($file['object_path']);
            return $file;
        }, $statement->fetchAll())];
    }

    $rawPath = $action === 'remove' ? (string)($body['paths'][0] ?? '') : (string)($body['path'] ?? '');
    $path = storage_safe_path($rawPath);
    [$user] = storage_user($pdo, $config, $bucket, $path, in_array($action, ['upload', 'remove'], true));

    if ($action === 'signed-url') {
        $statement = $pdo->prepare('SELECT owner_id, is_public FROM storage_files WHERE bucket = ? AND object_path = ? LIMIT 1');
        $statement->execute([$bucket, $path]);
        $file = $statement->fetch();
        if (!$file || ($user['app_metadata']['role'] !== 'admin' && $file['owner_id'] !== $user['id'])) {
            respond(['error' => 'File not found or access denied.'], 404);
        }
        $expires = time() + max(30, min(300, (int)($body['expiresIn'] ?? 120)));
        $signature = hash_hmac('sha256', $bucket . "\n" . $path . "\n" . $expires, application_key($config));
        $query = http_build_query(['bucket' => $bucket, 'path' => $path, 'expires' => $expires, 'signature' => $signature]);
        return ['signedUrl' => '/api/storage/signed?' . $query];
    }

    if ($action === 'remove') {
        $paths = $body['paths'] ?? [];
        if (!is_array($paths) || $paths === [] || count($paths) > 100) throw new InvalidArgumentException('Provide up to 100 file paths to remove.');
        $removed = 0;
        foreach ($paths as $rawPath) {
            $itemPath = storage_safe_path((string)$rawPath);
            [$itemUser] = storage_user($pdo, $config, $bucket, $itemPath, true);
            $filePath = storage_file_path($config, $bucket, $itemPath);
            if (is_file($filePath) && !unlink($filePath)) throw new RuntimeException('Could not remove a stored file.');
            $statement = $pdo->prepare('DELETE FROM storage_files WHERE bucket = ? AND object_path = ? AND (owner_id = ? OR ? = 1)');
            $isAdmin = $itemUser['app_metadata']['role'] === 'admin' ? 1 : 0;
            $statement->execute([$bucket, $itemPath, $itemUser['id'], $isAdmin]);
            $removed += $statement->rowCount();
        }
        return ['removed' => $removed];
    }

    throw new InvalidArgumentException('Unsupported storage operation.');
}

function storage_upload(PDO $pdo, array $config): array
{
    $bucket = (string)($_POST['bucket'] ?? '');
    $path = storage_safe_path((string)($_POST['path'] ?? ''));
    [$user, $policy] = storage_user($pdo, $config, $bucket, $path, true);
    $isAdmin = $user['app_metadata']['role'] === 'admin';
    if (!$isAdmin && !str_starts_with($path, $user['id'] . '/')) respond(['error' => 'Upload path must belong to your account.'], 403);
    if (!isset($_FILES['file']) || !is_array($_FILES['file'])) respond(['error' => 'Choose a file to upload.'], 422);
    $file = $_FILES['file'];
    if (($file['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK || !is_uploaded_file((string)$file['tmp_name'])) {
        respond(['error' => 'The file upload did not complete.'], 422);
    }
    $maxBytes = max(1024, (int)($config['storage']['max_upload_bytes'] ?? 10485760));
    if ((int)$file['size'] < 1 || (int)$file['size'] > $maxBytes) respond(['error' => 'File size is outside the allowed limit.'], 413);
    $finfo = new finfo(FILEINFO_MIME_TYPE);
    $mime = $finfo->file((string)$file['tmp_name']);
    $allowedMimeTypes = ['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/svg+xml', 'application/pdf', 'text/plain'];
    if (!is_string($mime) || !in_array($mime, $allowedMimeTypes, true)) respond(['error' => 'This file type is not allowed.'], 415);
    if ($bucket === 'member-avatars' || $bucket === 'dashboard-ads' || $bucket === 'site-media') {
        if (!str_starts_with($mime, 'image/')) respond(['error' => 'Only image files are allowed in this bucket.'], 415);
    }
    $target = storage_file_path($config, $bucket, $path, true);
    $exists = is_file($target);
    if ($exists && ($_POST['upsert'] ?? '0') !== '1') respond(['error' => 'A file already exists at this path.'], 409);
    if (!move_uploaded_file((string)$file['tmp_name'], $target)) throw new RuntimeException('Could not store the uploaded file.');
    chmod($target, 0640);

    $public = (bool)$policy['public'];
    $statement = $pdo->prepare(
        'INSERT INTO storage_files (id, bucket, object_path, owner_id, mime_type, byte_size, is_public)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE owner_id = VALUES(owner_id), mime_type = VALUES(mime_type), byte_size = VALUES(byte_size), is_public = VALUES(is_public)'
    );
    $statement->execute([uuid_v4(), $bucket, $path, $user['id'], $mime, (int)$file['size'], $public ? 1 : 0]);
    return ['path' => $path];
}

function serve_storage_file(PDO $pdo, array $config, bool $signed): never
{
    $bucket = (string)($_GET['bucket'] ?? '');
    $path = storage_safe_path((string)($_GET['path'] ?? ''));
    $buckets = storage_buckets();
    if (!isset($buckets[$bucket])) respond(['error' => 'File not found.'], 404);
    $statement = $pdo->prepare('SELECT mime_type, byte_size, is_public FROM storage_files WHERE bucket = ? AND object_path = ? LIMIT 1');
    $statement->execute([$bucket, $path]);
    $file = $statement->fetch();
    if (!$file) respond(['error' => 'File not found.'], 404);
    if ($signed) {
        $expires = (int)($_GET['expires'] ?? 0);
        $signature = (string)($_GET['signature'] ?? '');
        if ($expires < time() || $expires > time() + 300) respond(['error' => 'File link expired.'], 403);
        $expected = hash_hmac('sha256', $bucket . "\n" . $path . "\n" . $expires, application_key($config));
        if (!hash_equals($expected, $signature)) respond(['error' => 'File link is invalid.'], 403);
    } elseif (!$buckets[$bucket]['public'] || !(bool)$file['is_public']) {
        respond(['error' => 'File not found.'], 404);
    }
    $localPath = storage_file_path($config, $bucket, $path);
    if (!is_file($localPath) || is_link($localPath)) respond(['error' => 'File not found.'], 404);
    header('Content-Type: ' . $file['mime_type']);
    header('Content-Length: ' . (int)$file['byte_size']);
    header('Content-Disposition: inline; filename="' . addcslashes(basename($path), '"\\') . '"');
    header('Cache-Control: private, max-age=60');
    header('Content-Security-Policy: sandbox; default-src \'none\'');
    readfile($localPath);
    exit;
}
