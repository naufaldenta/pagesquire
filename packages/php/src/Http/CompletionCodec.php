<?php

declare(strict_types=1);

namespace PageSquire\Server\Http;

use PageSquire\Server\AssistantException;
use PageSquire\Server\ProtocolValidator;
use stdClass;
use Throwable;

final class CompletionCodec
{
    private const TOOL_INSTRUCTION = 'Tool mode: to act, call exactly one of the provided functions with its arguments and do not describe the call in text. When no action is needed, reply with ONLY a JSON object {"text": string, "emotion": idle|happy|sad|thinking|confused|hover, "finished": true, "toolCalls": []}.';

    /**
     * Function names allow only [A-Za-z0-9_-]{1,64}; capability IDs may contain dots.
     *
     * @param  list<array<string, mixed>>  $capabilities
     * @return array<string, string> function name => capability ID, in catalog order
     */
    public static function toolNames(array $capabilities): array
    {
        $names = [];
        foreach (array_values($capabilities) as $index => $capability) {
            $name = substr((string) preg_replace('/[^A-Za-z0-9_-]/', '_', $capability['id']), 0, 64);
            if (isset($names[$name])) {
                $name = substr($name, 0, 56).'_'.$index;
            }
            $names[$name] = $capability['id'];
        }

        return $names;
    }

    /** @param array<string, mixed> $config @param list<array<string, mixed>> $messages @param list<array<string, mixed>> $capabilities @return array<string, mixed> */
    public static function request(array $config, array $messages, int $maximum, array $capabilities = []): array
    {
        if ($maximum < 1 || $maximum > 4096) {
            throw new AssistantException('INVALID_PROVIDER_CONFIG', 'Configure a bounded output-token limit.', 500);
        }
        $tools = $config['responseMode'] === 'tools';
        $instructions = array_column(array_filter($messages, static fn (array $message): bool => $message['role'] === 'system'), 'content');
        if ($tools) {
            $instructions[] = self::TOOL_INSTRUCTION;
        }
        $system = implode("\n\n", $instructions);
        $body = ['model' => $config['model'], 'messages' => array_merge($system !== '' ? [['role' => $config['systemRole'], 'content' => $system]] : [], array_values(array_filter($messages, static fn (array $message): bool => $message['role'] !== 'system'))), 'stream' => false, $config['tokenParameter'] => $maximum];
        if ($config['responseMode'] === 'json_object') {
            $body['response_format'] = ['type' => 'json_object'];
        }
        if ($tools && $capabilities !== []) {
            $names = array_keys(self::toolNames($capabilities));
            $body['tools'] = array_map(static fn (array $capability, string $name): array => ['type' => 'function', 'function' => ['name' => $name, 'description' => $capability['description'], 'parameters' => ProtocolValidator::jsonValue($capability['inputSchema'])]], array_values($capabilities), $names);
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

    /**
     * Token counts reported by the provider, or null. Never includes content.
     *
     * @return array{inputTokens?: int, outputTokens?: int, totalTokens?: int}|null
     */
    public static function usage(string $body): ?array
    {
        try {
            $data = strlen($body) > 262144 ? null : json_decode($body, false, 64, JSON_THROW_ON_ERROR);
        } catch (Throwable) {
            return null;
        }
        $usage = $data instanceof stdClass ? ($data->usage ?? null) : null;
        if (! $usage instanceof stdClass) {
            return null;
        }
        $counts = [];
        foreach (['inputTokens' => 'prompt_tokens', 'outputTokens' => 'completion_tokens', 'totalTokens' => 'total_tokens'] as $name => $field) {
            if (is_int($usage->{$field} ?? null) && $usage->{$field} >= 0) {
                $counts[$name] = $usage->{$field};
            }
        }

        return $counts === [] ? null : $counts;
    }

    /**
     * @param  array<string, mixed>  $config
     * @param  list<array<string, mixed>>  $capabilities
     * @return array<string, mixed>
     */
    public static function decode(string $body, ProtocolValidator $validator, array $config = [], array $capabilities = []): array
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
            $tools = ($config['responseMode'] ?? null) === 'tools';
            if ($tools && $choice instanceof stdClass && $message instanceof stdClass && is_array($message->tool_calls ?? null) && $message->tool_calls !== []) {
                return self::toolCall($choice, $message, $validator, $capabilities);
            }
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
            $text = $content;
            if (preg_match('/^```(?:json)?\s*\n([\s\S]*?)\n```$/i', $content, $match)) {
                $content = $match[1];
            }
            try {
                $raw = json_decode($content, false, 32, JSON_THROW_ON_ERROR);
            } catch (\JsonException $error) {
                if (! $tools || $text === '') {
                    throw $error;
                }
                // Text alone can never act: it becomes a finished, tool-free reply.
                $raw = (object) ['text' => mb_substr($text, 0, 8000), 'emotion' => 'idle', 'finished' => true, 'toolCalls' => []];
            }
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

    /**
     * One action at a time: only the first tool call is read; later calls are never executed or reported.
     *
     * @param  list<array<string, mixed>>  $capabilities
     * @return array<string, mixed>
     */
    private static function toolCall(stdClass $choice, stdClass $message, ProtocolValidator $validator, array $capabilities): array
    {
        $call = $message->tool_calls[0];
        $names = self::toolNames($capabilities);
        $function = $call instanceof stdClass ? ($call->function ?? null) : null;
        $name = $function instanceof stdClass ? ($function->name ?? null) : null;
        $arguments = $function instanceof stdClass ? ($function->arguments ?? null) : null;
        if (isset($choice->finish_reason) && ! in_array($choice->finish_reason, ['tool_calls', 'stop'], true) || isset($message->refusal) && $message->refusal !== '' || isset($message->function_call) || isset($call->type) && $call->type !== 'function' || ! is_string($name) || ! isset($names[$name]) || ! is_string($arguments) || strlen($arguments) > 65536) {
            throw new \RuntimeException;
        }
        $parameters = json_decode(trim($arguments) === '' ? '{}' : $arguments, false, 32, JSON_THROW_ON_ERROR);
        if (! $parameters instanceof stdClass) {
            throw new \RuntimeException;
        }
        $draft = (object) ['text' => 'Checking the requested action…', 'emotion' => 'thinking', 'finished' => false, 'toolCalls' => [(object) ['capabilityId' => $names[$name], 'parameters' => $parameters]]];
        $validator->validate('providerResponse', $draft);

        return ['text' => $draft->text, 'emotion' => $draft->emotion, 'finished' => false, 'toolCalls' => [['capabilityId' => $names[$name], 'parameters' => $parameters]]];
    }
}
