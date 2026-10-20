<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli-server' || ! in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
    http_response_code(403);
    exit;
}
$site = realpath(__DIR__.'/../../.cache/pagesquire-wordpress/fixture-7.1.3/site');
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
$file = realpath($site.$path);
if (str_contains($path, '..') || str_contains($path, '\\') || preg_match('~/(?:wp-config\.php|\.ht|debug\.log|readme\.html|license\.txt|runtime|source)(?:/|$)~i', $path)) {
    http_response_code(403);
    exit;
}
if ($file !== false && str_starts_with($file, $site.DIRECTORY_SEPARATOR) && is_file($file)) {
    return false;
}
if ($file !== false && is_dir($file) && is_file($file.'/index.php')) {
    require $file.'/index.php';
} else {
    require $site.'/index.php';
}
