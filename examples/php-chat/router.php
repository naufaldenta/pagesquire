<?php

declare(strict_types=1);

use PageSquire\Example\DemoProvider;
use PageSquire\Server\ConversationEngine;
use PageSquire\Server\Http\ChatEndpoint;
use PageSquire\Server\Http\FileConversationStore;
use PageSquire\Server\ProtocolValidator;

require __DIR__.'/../../vendor/autoload.php';
require __DIR__.'/DemoProvider.php';
if (PHP_SAPI !== 'cli-server' || ! in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
    http_response_code(403);
    exit;
}
header('Cache-Control: no-store');
header('X-Content-Type-Options: nosniff');
header("Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; frame-ancestors 'none'; form-action 'none'");
session_name('pagesquire_demo');
session_start(['use_strict_mode' => true, 'cookie_httponly' => true, 'cookie_samesite' => 'Strict']);
$_SESSION['csrf'] ??= bin2hex(random_bytes(24));
$path = parse_url($_SERVER['REQUEST_URI'], PHP_URL_PATH);
$method = $_SERVER['REQUEST_METHOD'];
if ($method === 'POST' && $path === '/chat') {
    $session = ['key' => session_id(), 'principal' => 'demo-guest', 'csrfToken' => $_SESSION['csrf'], 'capabilityIds' => ['browser.navigate', 'accessibility.set_heading_color', 'accessibility.set_link_highlight', 'accessibility.set_font_weight', 'testing.unverified', 'testing.wait']];
    session_write_close();
    $directory = sys_get_temp_dir().'/pagesquire-php-demo-'.getmypid();
    if (! is_dir($directory)) {
        mkdir($directory, 0700);
    }
    $validator = new ProtocolValidator;
    $manifest = json_decode(file_get_contents(__DIR__.'/../../tests/fixtures/dist/manifest.json'), true, 64, JSON_THROW_ON_ERROR);
    $endpoint = new ChatEndpoint(new ConversationEngine(new DemoProvider, $validator, $manifest), $validator, new FileConversationStore($directory), 'http://127.0.0.1:4174', 30);
    $endpoint->serve($session);
    exit;
}
if ($method !== 'GET') {
    http_response_code(405);
    exit;
}
if (isset($_SERVER['HTTP_X_INERTIA']) && $path === '/next.html') {
    header('Content-Type: application/json');
    header('X-Inertia: true');
    header('Vary: X-Inertia');
    echo json_encode(['component' => 'Next', 'props' => ['errors' => (object) []], 'url' => '/next.html', 'version' => null, 'clearHistory' => false, 'encryptHistory' => false]);
    exit;
}
$files = [
    '/' => ['index.html', 'text/html'], '/index.html' => ['index.html', 'text/html'], '/next.html' => ['index.html', 'text/html'],
    '/demo.css' => ['demo.css', 'text/css'], '/dist/demo.js' => ['dist/demo.js', 'text/javascript'],
    '/dist/widget.css' => ['dist/widget.css', 'text/css'], '/dist/react-demo.js' => ['dist/react-demo.js', 'text/javascript'],
];
if (! isset($files[$path])) {
    http_response_code(404);
    exit;
}
[$file, $mime] = $files[$path];
header('Content-Type: '.$mime.'; charset=utf-8');
$contents = file_get_contents(__DIR__.'/../plain-html/'.$file);
if ($mime === 'text/html') {
    $meta = '<meta name="pagesquire-endpoint" content="/chat"><meta name="csrf-token" content="'.htmlspecialchars($_SESSION['csrf'], ENT_QUOTES).'">';
    $contents = str_replace('</head>', $meta.'</head>', $contents);
}
echo $contents;
