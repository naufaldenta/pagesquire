<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

use PageSquire\Server\AssistantException;
use PageSquire\Server\ProtocolValidator;
use stdClass;
use Throwable;

final class CompletionCodec
{
    /** @param array<string, mixed> $config @param list<array<string, mixed>> $messages @return array<string, mixed> */
    public static function request(array $config, array $messages, int $maximum): array
    {
        if ($maximum < 1 || $maximum > 4096) {
            throw new AssistantException('INVALID_PROVIDER_CONFIG', 'Configure a bounded output-token limit.', 500);
        }
        $system = implode("\n\n", array_column(array_filter($messages, static fn (array $message): bool => $message['role'] === 'system'), 'content'));
        $body = ['model' => $config['model'], 'messages' => array_merge($system !== '' ? [['role' => $config['systemRole'], 'content' => $system]] : [], array_values(array_filter($messages, static fn (array $message): bool => $message['role'] !== 'system'))), 'stream' => false, $config['tokenParameter'] => $maximum];
        if ($config['responseMode'] === 'json_object') {
            $body['response_format'] = ['type' => 'json_object'];
        }
        if ($config['thinking'] === 'disabled') {
            if ($config['provider'] === 'qwen') {
                $body['enable_thinking'] = false;
            } else {
                $body['thinking'] = ['type' => 'disabled'];
            }
        }

        return $body;
    }

    /** @return array<string, mixed> */
    public static function decode(string $body, ProtocolValidator $validator): array
    {
        try {
            if (strlen($body) > 262144) {
                throw new \RuntimeException;
            }
            $data = json_decode($body, false, 64, JSON_THROW_ON_ERROR);
            if (! $data instanceof stdClass || isset($data->error) || ! is_array($data->choices ?? null) || count($data->choices) !== 1) {
                throw new \RuntimeException;
            }
            $choice = $data->choices[0];
            $message = $choice->message ?? null;
            if (! $choice instanceof stdClass || ! $message instanceof stdClass || isset($choice->finish_reason) && $choice->finish_reason !== 'stop' || isset($message->refusal) && $message->refusal !== '' || isset($message->function_call) || isset($message->tool_calls) && $message->tool_calls !== []) {
                throw new \RuntimeException;
            }
            $content = $message->content ?? null;
            if (is_array($content)) {
                if ($content === [] || ! array_is_list($content)) {
                    throw new \RuntimeException;
                }
                foreach ($content as $part) {
                    if (! $part instanceof stdClass || ($part->type ?? null) !== 'text' || ! is_string($part->text ?? null)) {
                        throw new \RuntimeException;
                    }
                }
                $content = implode('', array_map(static fn (stdClass $part): string => $part->text, $content));
            }
            if (! is_string($content) || strlen($content) > 65536) {
                throw new \RuntimeException;
            }
            $content = trim($content);
            if (preg_match('/^```(?:json)?\s*\n([\s\S]*?)\n```$/i', $content, $match)) {
                $content = $match[1];
            }
            $raw = json_decode($content, false, 32, JSON_THROW_ON_ERROR);
            if (! $raw instanceof stdClass) {
                throw new \RuntimeException;
            }
            if (! in_array($raw->emotion ?? null, ['idle', 'happy', 'sad', 'thinking', 'confused', 'hover'], true)) {
                $raw->emotion = 'idle';
            }
            $validator->validate('providerResponse', $raw);
            $draft = (array) $raw;
            $draft['toolCalls'] = array_map(static fn (stdClass $call): array => (array) $call, $raw->toolCalls);

            return $draft;
        } catch (Throwable) {
            throw new AssistantException('INVALID_PROVIDER_RESPONSE', 'The assistant provider returned an invalid response.', 502);
        }
    }
}
