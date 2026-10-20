<?php

declare(strict_types=1);

namespace PageSquire\Server;

interface Provider
{
    /**
     * @param  list<array{role: string, content: string}>  $messages
     * @param  list<array<string, mixed>>  $capabilities
     * @return array{text: string, emotion: string, finished: bool, toolCalls: list<array{capabilityId: string, parameters: mixed}>}
     */
    public function complete(array $messages, array $capabilities, int $maxOutputTokens): array;
}
