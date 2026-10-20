<?php

namespace PageSquire\Tests\Laravel;

use GuzzleHttp\Psr7\Response;
use Illuminate\Http\Client\Factory;
use Illuminate\Http\Client\Request;
use Illuminate\Support\Facades\Http;
use Orchestra\Testbench\TestCase;
use PageSquire\Laravel\OpenAiCompatibleProvider;
use PageSquire\Laravel\PageSquireServiceProvider;
use PageSquire\Server\AssistantException;
use PageSquire\Server\ProtocolValidator;
use PageSquire\Server\Provider;

final class ProviderTest extends TestCase
{
    protected function setUp(): void
    {
        parent::setUp();
        Http::preventStrayRequests();
    }

    public function test_provider_uses_only_server_credentials_and_bounded_http_options(): void
    {
        $captured = null;
        Http::fake(function (Request $request, array $options) use (&$captured) {
            $captured = $options;

            return Http::response(['choices' => [['message' => ['content' => '{"text":"Hello.","emotion":"unknown","finished":true,"toolCalls":[]}']]]]);
        });
        $reply = $this->provider()->complete([['role' => 'system', 'content' => 'Respond with JSON.']], [], 500);
        $this->assertSame('idle', $reply['emotion']);
        Http::assertSent(fn (Request $request): bool => $request->url() === 'https://provider.test/v1/chat/completions'
            && $request->hasHeader('Authorization', 'Bearer synthetic-secret-key')
            && $request->hasHeader('Accept-Encoding', 'identity')
            && $request['model'] === 'fixture-model' && $request['max_tokens'] === 500
            && $request['response_format']['type'] === 'json_object');
        $this->assertSame(20, $captured['timeout']);
        $this->assertSame(5, $captured['connect_timeout']);
        $this->assertFalse($captured['allow_redirects']);
        $this->assertFalse($captured['decode_content']);
        Http::assertSentCount(1);
    }

    public function test_non_https_configuration_never_contacts_the_provider(): void
    {
        $this->expectException(AssistantException::class);
        try {
            $this->provider('http://provider.test/')->complete([], [], 100);
        } finally {
            Http::assertNothingSent();
        }
    }

    public function test_provider_http_errors_are_sanitized_without_retries(): void
    {
        Http::fake(['provider.test/*' => Http::response('synthetic-secret-key upstream debug', 500)]);

        try {
            $this->provider()->complete([], [], 100);
            $this->fail('A provider error must fail.');
        } catch (AssistantException $exception) {
            $this->assertSame('PROVIDER_UNAVAILABLE', $exception->errorCode);
            $this->assertSame(502, $exception->httpStatus);
            $this->assertStringNotContainsString('synthetic-secret-key', $exception->getMessage());
        }

        Http::assertSentCount(1);
    }

    public function test_provider_refuses_array_parameters_before_php_object_normalization(): void
    {
        Http::fake(['provider.test/*' => Http::response(['choices' => [['message' => ['content' => '{"text":"","emotion":"thinking","finished":false,"toolCalls":[{"capabilityId":"browser.navigate","parameters":[]}]}']]]])]);
        $this->expectException(AssistantException::class);
        $this->expectExceptionMessage('The assistant provider returned an invalid response.');
        $this->provider()->complete([], [], 100);
    }

    public function test_malformed_provider_json_is_sanitized(): void
    {
        Http::fake(['provider.test/*' => Http::response(['choices' => [['message' => ['content' => 'not JSON synthetic-secret-key']]]])]);
        $this->expectException(AssistantException::class);
        $this->expectExceptionMessage('The assistant provider returned an invalid response.');
        $this->provider()->complete([], [], 100);
    }

    public function test_connection_failures_are_sanitized(): void
    {
        Http::fake(['provider.test/*' => Http::failedConnection('synthetic-secret-key connection details')]);
        $this->expectException(AssistantException::class);
        $this->expectExceptionMessage('The assistant provider is unavailable.');
        $this->provider()->complete([], [], 100);
    }

    public function test_redirect_responses_are_not_followed(): void
    {
        Http::fake(['provider.test/*' => Http::response('', 302, ['Location' => 'https://foreign.test/'])]);

        try {
            $this->provider()->complete([], [], 100);
            $this->fail('Provider redirects must fail.');
        } catch (AssistantException $exception) {
            $this->assertSame('PROVIDER_UNAVAILABLE', $exception->errorCode);
        }

        Http::assertSentCount(1);
    }

    public function test_oversized_provider_download_is_aborted_by_progress_callback(): void
    {
        Http::fake(function (Request $request, array $options) {
            $options['progress'](0, 262145, 100, 100);

            return Http::response([]);
        });
        $this->expectException(AssistantException::class);
        $this->expectExceptionMessage('The assistant provider is unavailable.');
        $this->provider()->complete([], [], 100);
    }

    public function test_oversized_declared_provider_body_is_rejected_before_download(): void
    {
        Http::fake(function (Request $request, array $options) {
            $options['on_headers'](new Response(200, ['Content-Length' => '262145']));

            return Http::response([]);
        });
        $this->expectException(AssistantException::class);
        $this->expectExceptionMessage('The assistant provider is unavailable.');
        $this->provider()->complete([], [], 100);
    }

    public function test_compressed_provider_bodies_cannot_bypass_the_download_limit(): void
    {
        Http::fake(function (Request $request, array $options) {
            $options['on_headers'](new Response(200, ['Content-Encoding' => 'gzip', 'Content-Length' => '100']));

            return Http::response([]);
        });
        $this->expectException(AssistantException::class);
        $this->expectExceptionMessage('The assistant provider is unavailable.');
        $this->provider()->complete([], [], 100);
    }

    public function test_service_binding_resolves_a_preset_without_a_manual_endpoint_and_preserves_explicit_dialect_controls(): void
    {
        $this->app->register(PageSquireServiceProvider::class);
        config()->set('pagesquire.provider', ['name' => 'groq', 'endpoint' => null, 'key' => 'synthetic-key', 'model' => 'owner-model', 'timeout_seconds' => 20, 'connect_timeout_seconds' => 5, 'response_mode' => 'prompt', 'token_parameter' => 'max_completion_tokens', 'system_role' => 'developer']);
        Http::fake(['api.groq.com/*' => Http::response(['choices' => [['finish_reason' => 'stop', 'message' => ['content' => "```json\n{\"text\":\"Hello\",\"emotion\":\"happy\",\"finished\":true,\"toolCalls\":[]}\n```"]]]])]);
        $reply = $this->app->make(Provider::class)->complete([['role' => 'system', 'content' => 'JSON only']], [], 500);
        $this->assertSame('Hello', $reply['text']);
        Http::assertSent(fn (Request $request): bool => $request->url() === 'https://api.groq.com/openai/v1/chat/completions' && $request['model'] === 'owner-model' && $request['max_completion_tokens'] === 500 && ! isset($request['max_tokens']) && ! isset($request['response_format']) && $request['messages'][0]['role'] === 'developer');
        Http::assertSentCount(1);
    }

    private function provider(string $endpoint = 'https://provider.test/v1/chat/completions'): OpenAiCompatibleProvider
    {
        return new OpenAiCompatibleProvider($this->app->make(Factory::class), new ProtocolValidator, $endpoint, 'synthetic-secret-key', 'fixture-model');
    }
}
