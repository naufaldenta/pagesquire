<?php

declare(strict_types=1);

namespace PageSquire\Example;

use PageSquire\Server\Provider;

/** Deterministic fixture, not an AI model. No external inference or service calls. */
final class DemoProvider implements Provider
{
    public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
    {
        $message = '';
        $results = [];
        foreach ($messages as $entry) {
            if ($entry['role'] !== 'user') {
                continue;
            }
            $data = json_decode($entry['content'], true);
            if (! is_array($data)) {
                $message = strtolower($entry['content']);
                $results = [];
            } elseif (isset($data['browserResult'])) {
                $results[] = $data['browserResult'];
            }
        }
        $queue = [];
        if (str_contains($message, 'navigate')) {
            $queue[] = ['capabilityId' => 'browser.navigate', 'parameters' => ['url' => '/next.html']];
        }
        if (str_contains($message, 'heading')) {
            $queue[] = ['capabilityId' => 'accessibility.set_heading_color', 'parameters' => ['color' => '#ff0000']];
        }
        if (str_contains($message, 'link')) {
            $queue[] = ['capabilityId' => 'accessibility.set_link_highlight', 'parameters' => ['enabled' => true]];
        }
        if (str_contains($message, 'bold')) {
            $queue[] = ['capabilityId' => 'accessibility.set_font_weight', 'parameters' => ['weight' => 700]];
        }
        if (str_contains($message, 'unverified')) {
            $queue[] = ['capabilityId' => 'testing.unverified', 'parameters' => (object) []];
        }
        if (str_contains($message, 'wait')) {
            $queue[] = ['capabilityId' => 'testing.wait', 'parameters' => ['milliseconds' => 10000]];
        }
        if (isset($queue[count($results)])) {
            return ['text' => 'Do not display this premature success claim.', 'emotion' => 'happy', 'finished' => false, 'toolCalls' => [$queue[count($results)]]];
        }

        return ['text' => count($results) ? 'The requested changes were verified on this page.' : 'Demo commands: Make headings red; Highlight links and use bold text. This is a deterministic provider, not a live AI.', 'emotion' => count($results) ? 'happy' : 'idle', 'finished' => true, 'toolCalls' => []];
    }
}
