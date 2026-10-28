<?php

declare(strict_types=1);

namespace {
    // Minimal WordPress stand-ins; real behaviour is covered by the WordPress browser fixture.
    if (! function_exists('wp_get_abilities')) {
        function wp_get_abilities(): array
        {
            return \PageSquire\Tests\WordPress\AbilityRegistry::$abilities;
        }

        function wp_get_ability(string $name): ?object
        {
            return \PageSquire\Tests\WordPress\AbilityRegistry::$abilities[$name] ?? null;
        }

        function sanitize_text_field(string $text): string
        {
            return trim(strip_tags($text));
        }

        function is_wp_error(mixed $value): bool
        {
            return $value instanceof \PageSquire\Tests\WordPress\FakeWpError;
        }

        function wp_json_encode(mixed $value): string|false
        {
            return json_encode($value);
        }
    }
}

namespace PageSquire\Tests\WordPress {
    use PageSquire\WordPress\Abilities;
    use PageSquireWPVendor\PageSquire\Server\AssistantException;
    use PHPUnit\Framework\TestCase;

    require_once __DIR__.'/../../../packages/wordpress/dist/pagesquire/autoload.php';

    final class AbilityRegistry
    {
        /** @var array<string, FakeAbility> */
        public static array $abilities = [];
    }

    final class FakeWpError {}

    final class FakeAbility
    {
        public array $inputs = [];

        public function __construct(private string $name, private array $meta, private mixed $output = ['ok' => true], private bool $allowed = true) {}

        public function get_name(): string
        {
            return $this->name;
        }

        public function get_label(): string
        {
            return '<b>'.$this->name.'</b>';
        }

        public function get_description(): string
        {
            return 'Describes '.$this->name;
        }

        public function get_input_schema(): ?array
        {
            return ['type' => 'object', 'properties' => ['slug' => ['type' => 'string']]];
        }

        public function get_meta(): array
        {
            return $this->meta;
        }

        public function execute(mixed $input = null): mixed
        {
            $this->inputs[] = $input;

            return $this->allowed ? $this->output : new FakeWpError;
        }
    }

    final class AbilitiesTest extends TestCase
    {
        protected function setUp(): void
        {
            $readonly = ['annotations' => ['readonly' => true, 'destructive' => false]];
            AbilityRegistry::$abilities = [
                'site/info' => new FakeAbility('site/info', $readonly, ['name' => 'Example']),
                'site/delete-post' => new FakeAbility('site/delete-post', ['annotations' => ['readonly' => false]]),
                'site/unannotated' => new FakeAbility('site/unannotated', []),
                'Bad Name' => new FakeAbility('Bad Name', $readonly),
                'site/private' => new FakeAbility('site/private', $readonly, ['secret' => true], false),
                'site/large' => new FakeAbility('site/large', $readonly, ['text' => str_repeat('x', 20000)]),
            ];
        }

        private function settings(array $abilities, bool $enabled = true): array
        {
            return ['abilities' => $abilities, 'mapping' => ['capabilityIds' => $enabled ? ['page.read', Abilities::CAPABILITY] : ['page.read']]];
        }

        public function test_only_read_only_abilities_with_safe_names_are_offered(): void
        {
            self::assertSame(['site/info', 'site/large', 'site/private'], array_column(Abilities::available(), 'name'));
            self::assertSame('site/info', Abilities::available()[0]['label']);
            self::assertSame(['site/info'], Abilities::validateSelection(['site/info']));
            foreach ([['site/delete-post'], ['site/unannotated'], ['site/info', 'site/info'], 'site/info', array_fill(0, 21, 'site/info')] as $invalid) {
                try {
                    Abilities::validateSelection($invalid);
                    self::fail('An unsafe ability selection was accepted.');
                } catch (AssistantException $error) {
                    self::assertSame('INVALID_SETTINGS', $error->errorCode);
                }
            }
        }

        public function test_run_requires_approval_mapping_and_current_read_only_annotation(): void
        {
            self::assertEquals((object) ['name' => 'Example'], Abilities::run($this->settings(['site/info']), 'site/info', []));
            self::assertSame([null], AbilityRegistry::$abilities['site/info']->inputs);
            Abilities::run($this->settings(['site/info']), 'site/info', ['slug' => 'hello']);
            self::assertSame(['slug' => 'hello'], AbilityRegistry::$abilities['site/info']->inputs[1]);
            self::assertSame([], Abilities::approved($this->settings(['site/info'], false)));
            $denied = [
                [$this->settings(['site/info'], false), 'site/info'],
                [$this->settings(['site/info']), 'site/delete-post'],
                [$this->settings([]), 'site/info'],
            ];
            foreach ($denied as [$settings, $name]) {
                try {
                    Abilities::run($settings, $name, []);
                    self::fail('An unapproved ability ran.');
                } catch (AssistantException $error) {
                    self::assertSame('ABILITY_DENIED', $error->errorCode);
                }
            }
            AbilityRegistry::$abilities['site/info'] = new FakeAbility('site/info', ['annotations' => ['readonly' => false]]);
            try {
                Abilities::run($this->settings(['site/info']), 'site/info', []);
                self::fail('An ability that stopped being read-only ran.');
            } catch (AssistantException $error) {
                self::assertSame('ABILITY_DENIED', $error->errorCode);
            }
        }

        public function test_permission_failures_and_oversized_output_are_not_returned(): void
        {
            foreach ([['site/private', 'ABILITY_FAILED'], ['site/large', 'ABILITY_OUTPUT_TOO_LARGE']] as [$name, $code]) {
                try {
                    Abilities::run($this->settings([$name]), $name, []);
                    self::fail('A failed ability returned output.');
                } catch (AssistantException $error) {
                    self::assertSame($code, $error->errorCode);
                    self::assertStringNotContainsString('secret', $error->getMessage());
                }
            }
        }
    }
}
