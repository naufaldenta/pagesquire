<?php

declare(strict_types=1);

/**
 * A minimal native PHP site for the cross-stack PageSquire Link test.
 * Under `php -S` it serves the declaration and the link endpoint; from the
 * command line it runs owner operations against the same file store.
 * Configuration comes from PSQ_ORIGIN, PSQ_KEY, PSQ_NAME and PSQ_STORE.
 */

require __DIR__.'/../../vendor/autoload.php';

use PageSquire\Server\ActionSigner;
use PageSquire\Server\AssistantException;
use PageSquire\Server\Link\FileLinkStore;
use PageSquire\Server\Link\LinkEndpoint;
use PageSquire\Server\Link\LinkManager;

$signer = new ActionSigner((string) getenv('PSQ_KEY'), (string) getenv('PSQ_ORIGIN'));
$manager = new LinkManager($signer, new FileLinkStore((string) getenv('PSQ_STORE')), [
    'endpoint' => '/pagesquire/link',
    'name' => (string) getenv('PSQ_NAME'),
    'skills' => [[
        'id' => 'book_table',
        'name' => 'Book a table',
        'description' => 'Reserve a table for a date and party size.',
        'tags' => ['restaurant'],
        'fields' => ['date' => ['type' => 'string', 'format' => 'date'], 'people' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 20]],
        'startPath' => '/reservations',
    ]],
]);

if (PHP_SAPI === 'cli') {
    $command = $argv[1] ?? '';
    try {
        $result = match ($command) {
            'invite' => $manager->createInvitation(),
            'accept' => $manager->acceptInvitation((string) ($argv[2] ?? '')),
            'approve' => $manager->approve((string) ($argv[2] ?? ''), json_decode((string) ($argv[3] ?? '{}'), true, 8, JSON_THROW_ON_ERROR)),
            'revoke' => $manager->revoke((string) ($argv[2] ?? '')),
            'list' => $manager->list(),
            'handoff' => $manager->handoff((string) ($argv[2] ?? ''), json_decode((string) ($argv[3] ?? '{}'), true, 8, JSON_THROW_ON_ERROR)),
            'redeem' => ['ticket' => $manager->redeem((string) ($argv[2] ?? ''))],
            'sendback' => $manager->sendBack((string) ($argv[2] ?? ''), json_decode((string) ($argv[3] ?? '{}'), true, 8, JSON_THROW_ON_ERROR)),
            default => throw new AssistantException('UNKNOWN_COMMAND', 'Use invite, accept, approve, revoke, list, handoff, redeem or sendback.', 400),
        };
        echo json_encode($result, JSON_UNESCAPED_SLASHES);
    } catch (AssistantException $exception) {
        echo json_encode(['error' => ['code' => $exception->errorCode, 'message' => $exception->getMessage()]]);
    }

    return;
}

$path = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH);
header('Content-Type: application/json');
if ($path === '/.well-known/pagesquire.json') {
    echo json_encode($signer->declaration('/pagesquire/chat', false, $manager->declaration()), JSON_UNESCAPED_SLASHES);

    return;
}
if ($path === '/pagesquire/link') {
    $response = (new LinkEndpoint($manager))->handle($_SERVER['REQUEST_METHOD'] ?? 'GET', $_SERVER['CONTENT_TYPE'] ?? '', (string) file_get_contents('php://input'));
    http_response_code($response['status']);
    echo json_encode($response['body'], JSON_UNESCAPED_SLASHES);

    return;
}
http_response_code(404);
echo '{}';
