<?php

declare(strict_types=1);

if (PHP_SAPI !== 'cli-server' || ! in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
    http_response_code(403);
    exit;
}
$site = realpath(__DIR__.'/../../.cache/pagesquire-wordpress/fixture-7.1.3/site');
$path = rawurldecode(parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH));
// Logged before and after handling, so the fixture server can name a request
// that crashes or hangs PHP. Query strings are left out.
file_put_contents('php://stderr', 'pagesquire-request '.$_SERVER['REQUEST_METHOD'].' '.$path."\n");
register_shutdown_function(static function (): void {
    file_put_contents('php://stderr', "pagesquire-request-done\n");
});
// The fixture server sends SIGUSR1 when a request hangs; print where PHP is.
// Only interrupts PHP code, not a call stuck inside an extension.
if (function_exists('pcntl_signal')) {
    pcntl_async_signals(true);
    pcntl_signal(SIGUSR1, static function (): void {
        $frames = array_map(static fn (array $frame): string => ($frame['file'] ?? '[internal]').':'.($frame['line'] ?? 0).' '.(isset($frame['class']) ? $frame['class'].'::' : '').$frame['function'], debug_backtrace(DEBUG_BACKTRACE_IGNORE_ARGS));
        file_put_contents('php://stderr', "PHP stack of the hanging request:\n  ".implode("\n  ", $frames)."\n");
    });
}
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
