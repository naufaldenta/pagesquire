<?php

declare(strict_types=1);

namespace PageSquire\Server;

final class ProviderConfiguration
{
    /** @return list<array<string, mixed>> */
    public static function presets(): array
    {
        return json_decode(file_get_contents(__DIR__.'/../resources/providers.json'), true, 32, JSON_THROW_ON_ERROR)['providers'];
    }

    /** @param array<string, mixed> $input @return array<string, mixed> */
    public static function resolve(array $input): array
    {
        $invalid = static fn (): never => throw new AssistantException('INVALID_PROVIDER_CONFIG', 'Configure a known provider, model, API key and secure chat endpoint.', 500);
        $id = $input['provider'] ?? 'custom';
        $presets = array_column(self::presets(), null, 'id');
        if (! is_string($id) || ! isset($presets[$id])) {
            $invalid();
        }
        $preset = $presets[$id];
        $endpoint = $input['endpoint'] ?? '';
        if (! is_string($endpoint)) {
            $invalid();
        }
        $endpoint = trim($endpoint) !== '' ? trim($endpoint) : $preset['endpoint'];
        $key = $input['apiKey'] ?? '';
        $model = $input['model'] ?? '';
        $url = is_string($endpoint) ? parse_url($endpoint) : false;
        if (! is_array($url) || ($url['scheme'] ?? '') !== 'https' || empty($url['host']) || isset($url['user']) || isset($url['pass']) || isset($url['fragment']) || isset($url['query']) || strlen($endpoint) > 2048 || preg_match('/[\s{}]/', $endpoint) || ! is_string($key) || trim($key) === '' || strlen($key) > 4096 || preg_match('/[\r\n]/', $key) || ! is_string($model) || trim($model) === '' || strlen($model) > 200 || preg_match('/[\r\n]/', $model)) {
            $invalid();
        }
        $mode = $input['responseMode'] ?? $preset['responseMode'];
        $tokens = $input['tokenParameter'] ?? $preset['tokenParameter'];
        $role = $input['systemRole'] ?? 'system';
        $thinking = $input['thinking'] ?? 'default';
        if (! in_array($mode, ['json_object', 'prompt', 'tools'], true) || ! in_array($tokens, ['max_tokens', 'max_completion_tokens'], true) || ! in_array($role, ['system', 'developer'], true) || ! in_array($thinking, ['default', 'disabled'], true) || $thinking === 'disabled' && ! in_array($id, ['qwen', 'zai', 'glm', 'deepseek'], true)) {
            $invalid();
        }

        return ['provider' => $id, 'endpoint' => $endpoint, 'apiKey' => $key, 'model' => $model, 'responseMode' => $mode, 'tokenParameter' => $tokens, 'systemRole' => $role, 'thinking' => $thinking];
    }

    /** @param array<string, mixed> $env @return array<string, mixed> */
    public static function fromEnvironment(array $env): array
    {
        $setting = static function (string ...$keys) use ($env): ?string {
            $values = [];
            foreach ($keys as $key) {
                if (is_string($env[$key] ?? null) && trim($env[$key]) !== '') {
                    $values[] = $env[$key];
                }
            }
            if (count(array_unique($values)) > 1) {
                throw new AssistantException('INVALID_PROVIDER_CONFIG', 'Conflicting provider settings must be resolved on the server.', 500);
            }

            return $values[0] ?? null;
        };

        return self::resolve([
            'provider' => $setting('PAGESQUIRE_PROVIDER') ?? 'custom',
            'endpoint' => $setting('PAGESQUIRE_PROVIDER_URL', 'PAGESQUIRE_PROVIDER_ENDPOINT') ?? '',
            'apiKey' => $setting('PAGESQUIRE_API_KEY', 'PAGESQUIRE_PROVIDER_KEY') ?? '',
            'model' => $setting('PAGESQUIRE_MODEL', 'PAGESQUIRE_PROVIDER_MODEL') ?? '',
            'responseMode' => $setting('PAGESQUIRE_RESPONSE_MODE'),
            'tokenParameter' => $setting('PAGESQUIRE_TOKEN_PARAMETER'),
            'systemRole' => $setting('PAGESQUIRE_SYSTEM_ROLE'),
            'thinking' => $setting('PAGESQUIRE_THINKING'),
        ]);
    }
}
