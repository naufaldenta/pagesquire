<?php

namespace PageSquire\Tests\Laravel;

use Illuminate\Support\Facades\Artisan;
use Orchestra\Testbench\TestCase;
use PageSquire\Laravel\CapabilityCatalog;
use PageSquire\Laravel\PageSquireServiceProvider;
use PageSquire\Server\ActionSigner;
use PageSquire\Server\AssistantException;
use PageSquire\Server\Link\LinkEndpoint;
use PageSquire\Server\Link\LinkManager;
use PageSquire\Server\Link\LinkStore;
use PageSquire\Server\Link\LinkTransport;
use PageSquire\Server\Link\MemoryLinkStore;

final class LinkTest extends TestCase
{
    private const FIND_ROOM = [
        'id' => 'find_room', 'name' => 'Find a room', 'description' => 'Show rooms for some dates.', 'tags' => ['hotel'],
        'fields' => ['checkIn' => ['type' => 'string', 'format' => 'date']], 'startPath' => '/rooms',
    ];

    private const BOOK_TABLE = [
        'id' => 'book_table', 'name' => 'Book a table', 'description' => 'Reserve a table.', 'tags' => ['restaurant'],
        'fields' => ['people' => ['type' => 'integer', 'minimum' => 1, 'maximum' => 20]], 'startPath' => '/reservations',
    ];

    private ActionSigner $partnerSigner;

    private LinkManager $partner;

    protected function getPackageProviders($app): array
    {
        return [PageSquireServiceProvider::class];
    }

    protected function defineEnvironment($app): void
    {
        $app['config']->set('app.key', str_repeat('a', 32));
        $app['config']->set('app.url', 'https://hotel.example/');
        $app['config']->set('cache.default', 'array');
        $app['config']->set('pagesquire.companion.signing_key', json_decode((string) file_get_contents(__DIR__.'/../../fixtures/signing.json'), true)['signingKey']);
        $app['config']->set('pagesquire.enabled', true);
        $app['config']->set('pagesquire.link.enabled', true);
        $app['config']->set('pagesquire.link.name', 'Hotel Example');
        $app['config']->set('pagesquire.link.skills', [self::FIND_ROOM]);
        $app['config']->set('pagesquire.manifest', ['schemaVersion' => '0.1', 'capabilities' => [[
            'id' => 'accessibility.set_heading_color', 'description' => 'Set the heading color.', 'execution' => 'browser', 'handler' => 'setHeadingColor',
            'inputSchema' => ['type' => 'object', 'properties' => ['color' => ['type' => 'string']], 'required' => ['color'], 'additionalProperties' => false],
            'risk' => 'reversible', 'verification' => ['handler' => 'verifyHeadingColor'],
        ]]]);
    }

    protected function setUp(): void
    {
        parent::setUp();
        $this->app->instance(LinkStore::class, new MemoryLinkStore);
        $this->app->instance(LinkTransport::class, $this->transport());
        $this->partnerSigner = new ActionSigner(ActionSigner::generate()['signingKey'], 'https://resto.example');
        $this->partner = new LinkManager($this->partnerSigner, new MemoryLinkStore, ['endpoint' => '/pagesquire/link', 'name' => 'Resto', 'skills' => [self::BOOK_TABLE]], $this->transport());
    }

    public function test_the_declaration_lists_the_link_section_only_when_enabled(): void
    {
        $this->getJson('/.well-known/pagesquire.json')
            ->assertOk()
            ->assertJsonPath('features', ['trustedInput', 'link'])
            ->assertJsonPath('link.endpoint', '/pagesquire/link')
            ->assertJsonPath('link.name', 'Hotel Example')
            ->assertJsonPath('link.skills.0.id', 'find_room');
        config(['pagesquire.link.enabled' => false]);
        $this->getJson('/.well-known/pagesquire.json')->assertJsonPath('features', ['trustedInput'])->assertJsonMissingPath('link');
    }

    public function test_owners_pair_from_artisan_and_the_route_answers_the_partner(): void
    {
        $this->artisan('pagesquire:link-list')->expectsOutputToContain('No partners yet')->assertSuccessful();
        $this->assertSame(0, Artisan::call('pagesquire:link-invite', ['--hours' => 2]));
        $this->assertSame(1, preg_match('/psq1\.\S+/', Artisan::output(), $match));
        $code = $match[0];

        $link = $this->partner->acceptInvitation($code);
        $this->assertSame('Hotel Example', $link['partner']['name']);
        $this->assertSame('find_room', $link['partner']['skills'][0]['id']);
        $this->artisan('pagesquire:link-list')->expectsOutputToContain('Resto (https://resto.example)')->assertSuccessful();

        $this->artisan('pagesquire:link-approve', ['link' => $link['id'], '--offer' => ['book_table:people'], '--accept' => ['find_room']])
            ->expectsOutputToContain('Status: pending')
            ->assertSuccessful();
        $this->assertSame(['find_room'], $this->partner->get($link['id'])['theirs']['accept']);
        $this->assertTrue($this->partner->approve($link['id'], ['offer' => ['find_room' => ['checkIn']], 'accept' => ['book_table']])['notified']);
        $ours = app(LinkManager::class)->get($link['id']);
        $this->assertSame('active', $ours['status']);
        $this->assertSame(['book_table' => ['people']], $ours['ours']['offer']);

        $this->artisan('pagesquire:link-revoke', ['link' => $link['id']])->expectsOutputToContain('Revoked.')->assertSuccessful();
        $this->assertSame('revoked', $this->partner->get($link['id'])['status']);
        $this->artisan('pagesquire:link-approve', ['link' => $link['id']])->expectsOutputToContain('LINK_REVOKED')->assertFailed();
    }

    public function test_artisan_accepts_an_invitation_from_the_partner(): void
    {
        $code = $this->partner->createInvitation()['code'];
        $this->artisan('pagesquire:link-accept', ['invitation' => $code])
            ->expectsOutputToContain('Paired with Resto (https://resto.example).')
            ->expectsOutputToContain('Partner skills: book_table')
            ->assertSuccessful();
        $this->assertCount(1, $this->partner->list());
        $this->artisan('pagesquire:link-accept', ['invitation' => $code])->expectsOutputToContain('INVITATION_INVALID')->assertFailed();
        $this->artisan('pagesquire:link-accept', ['invitation' => 'nonsense'])->expectsOutputToContain('INVITATION_INVALID')->assertFailed();
        $this->artisan('pagesquire:link-invite', ['--hours' => 500])->assertFailed();
    }

    public function test_the_route_refuses_bad_requests_with_json_errors(): void
    {
        $this->get('/pagesquire/link')->assertStatus(405);
        $this->call('POST', '/pagesquire/link', [], [], [], ['CONTENT_TYPE' => 'text/plain'], '{}')->assertStatus(415);
        $this->call('POST', '/pagesquire/link', [], [], [], ['CONTENT_TYPE' => 'application/json'], '{"claims":1}')
            ->assertStatus(400)
            ->assertHeader('Cache-Control', 'no-store, private')
            ->assertHeader('X-Content-Type-Options', 'nosniff')
            ->assertJsonPath('error.code', 'LINK_INVALID');
    }

    public function test_the_catalog_lists_link_handoff_only_while_link_is_on(): void
    {
        $ids = static fn (): array => array_column(app(CapabilityCatalog::class)->manifest()['capabilities'], 'id');
        $this->assertSame(['accessibility.set_heading_color', 'link.handoff'], $ids());
        config(['pagesquire.link.enabled' => false]);
        $this->assertSame(['accessibility.set_heading_color'], $ids());
    }

    /** The fake network: the Laravel app serves hotel.example, the in-process partner serves resto.example. */
    private function transport(): LinkTransport
    {
        $test = $this;

        return new class($test) implements LinkTransport
        {
            public function __construct(private readonly LinkTest $test) {}

            public function request(string $method, string $url, ?string $body): string
            {
                return $this->test->route($method, $url, $body);
            }
        };
    }

    public function route(string $method, string $url, ?string $body): string
    {
        $origin = ActionSigner::origin($url);
        $path = (string) parse_url($url, PHP_URL_PATH);
        if ($origin === 'https://hotel.example') {
            return $method === 'GET'
                ? $this->get($path)->getContent()
                : $this->call($method, $path, [], [], [], ['CONTENT_TYPE' => 'application/json'], (string) $body)->getContent();
        }
        if ($origin !== 'https://resto.example') {
            throw new AssistantException('PARTNER_UNREACHABLE', 'The partner site could not be reached.', 502);
        }
        if ($path === '/.well-known/pagesquire.json') {
            return json_encode($this->partnerSigner->declaration('/pagesquire/chat', false, $this->partner->declaration()), JSON_UNESCAPED_SLASHES);
        }

        return json_encode((new LinkEndpoint($this->partner))->handle($method, 'application/json', (string) $body)['body'], JSON_UNESCAPED_SLASHES);
    }
}
