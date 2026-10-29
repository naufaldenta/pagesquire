<?php

namespace PageSquire\Tests\Laravel;

use Illuminate\Contracts\Auth\Authenticatable;
use Illuminate\Support\Facades\Gate;
use Orchestra\Testbench\TestCase;
use PageSquire\Laravel\PageSquireServiceProvider;
use PageSquire\Server\Provider;

final class CompanionTest extends TestCase
{
    protected function getPackageProviders($app): array
    {
        return [PageSquireServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $app['config']->set('app.key', str_repeat('a', 32));
        $app['config']->set('app.url', 'https://shop.example/');
        $app['config']->set('cache.default', 'array');
        $app['config']->set('session.driver', 'array');
        $app['config']->set('session.serialization', 'json');
        $app['config']->set('pagesquire.enabled', true);
        $app['config']->set('pagesquire.companion.signing_key', $this->vector()['signingKey']);
        $app['config']->set('pagesquire.manifest', ['schemaVersion' => '0.1', 'capabilities' => [[
            'id' => 'accessibility.set_heading_color', 'description' => 'Set the heading color.', 'execution' => 'browser', 'handler' => 'setHeadingColor',
            'inputSchema' => ['type' => 'object', 'properties' => ['color' => ['type' => 'string', 'pattern' => '^#[0-9a-fA-F]{6}$']], 'required' => ['color'], 'additionalProperties' => false],
            'risk' => 'reversible', 'verification' => ['handler' => 'verifyHeadingColor'],
        ]]]);
    }

    public function test_the_site_declaration_publishes_the_public_key(): void
    {
        $this->getJson('/.well-known/pagesquire.json')
            ->assertOk()
            ->assertHeader('Cache-Control', 'max-age=300, public')
            ->assertExactJson(['version' => 1, 'endpoint' => '/pagesquire/chat', 'publicKey' => $this->vector()['publicKey'], 'features' => ['trustedInput']]);
        // Screenshots are declared only when the owner turns them on.
        config(['pagesquire.companion.screenshots' => true]);
        $this->getJson('/.well-known/pagesquire.json')->assertJsonPath('features', ['trustedInput', 'screenshots']);
        // Link stays off, and its route absent, until the owner turns it on.
        $this->postJson('/pagesquire/link', [])->assertNotFound();
    }

    public function test_chat_replies_carry_calls_signed_for_the_app_origin(): void
    {
        Gate::define('pagesquire.use', fn (?Authenticatable $user): bool => true);
        Gate::define('pagesquire.capability', fn (?Authenticatable $user, string $id): bool => true);
        $this->app->instance(Provider::class, new class implements Provider
        {
            public function complete(array $messages, array $capabilities, int $maxOutputTokens): array
            {
                return ['text' => 'Red.', 'emotion' => 'happy', 'finished' => false, 'toolCalls' => [['capabilityId' => 'accessibility.set_heading_color', 'parameters' => ['color' => '#ff0000']]]];
            }
        });
        $this->withCredentials();
        $call = $this->postJson(route('pagesquire.chat'), [
            'protocolVersion' => '0.1', 'requestId' => 'first', 'message' => 'Make the heading red.', 'capabilityIds' => ['accessibility.set_heading_color'],
            'snapshot' => ['protocolVersion' => '0.1', 'id' => 'snapshot', 'url' => 'https://shop.example/', 'title' => 'Shop', 'text' => 'Heading', 'targets' => [], 'truncated' => ['text' => false, 'targets' => false]],
        ])->assertOk()->json('response.toolCalls.0');
        $claims = json_decode($call['signature']['claims'], true);
        $this->assertSame('https://shop.example', $claims['origin']);
        $this->assertSame($call['callId'], $claims['callId']);
        $this->assertTrue(sodium_crypto_sign_verify_detached(
            base64_decode($call['signature']['value'], true),
            'pagesquire-call-v1.'.$call['signature']['claims'],
            base64_decode(substr($this->vector()['publicKey'], 8), true),
        ));
    }

    /** @return array{signingKey: string, publicKey: string} */
    private function vector(): array
    {
        return json_decode((string) file_get_contents(__DIR__.'/../../fixtures/signing.json'), true, flags: JSON_THROW_ON_ERROR);
    }
}
