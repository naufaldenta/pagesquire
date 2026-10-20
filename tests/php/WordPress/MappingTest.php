<?php

declare(strict_types=1);

namespace PageSquire\Tests\WordPress;

use Opis\JsonSchema\CompliantValidator;
use PageSquire\WordPress\Context;
use PageSquire\WordPress\Mapping;
use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PageSquireWPVendor\PageSquire\Server\ProtocolValidator;
use PHPUnit\Framework\Attributes\DataProvider;
use PHPUnit\Framework\TestCase;

require_once __DIR__.'/../../../packages/wordpress/dist/pagesquire/autoload.php';

final class MappingTest extends TestCase
{
    public function test_defaults_and_manifest_expose_only_approved_built_ins(): void
    {
        $mapping = Mapping::defaults('https://example.test');
        self::assertSame($mapping, Mapping::validate((object) $mapping, 'https://example.test'));
        self::assertSame($mapping['capabilityIds'], array_column(Mapping::manifest($mapping)['capabilities'], 'id'));
    }

    #[DataProvider('unsafeMappings')]
    public function test_mapping_import_is_configuration_only(mixed $change): void
    {
        $mapping = (object) array_replace(Mapping::defaults('https://example.test'), $change);
        $this->expectException(AssistantException::class);
        Mapping::validate($mapping, 'https://example.test');
    }

    public static function unsafeMappings(): iterable
    {
        yield 'code' => [['handler' => 'shell_exec("bad")']];
        yield 'foreign origin' => [['siteOrigin' => 'https://evil.test']];
        yield 'arbitrary selector' => [['contentRoot' => 'body, [type=password]']];
        yield 'no capabilities' => [['capabilityIds' => []]];
        yield 'consequential' => [['capabilityIds' => ['wordpress.delete_posts']]];
        yield 'duplicate' => [['capabilityIds' => ['browser.navigate', 'browser.navigate']]];
        yield 'nested code' => [['capabilityIds' => [(object) ['eval' => 'bad']]]];
        yield 'version' => [['schemaVersion' => '100']];
        yield 'permissions' => [['permissions' => ['administrator']]];
    }

    public function test_block_export_omits_attributes_bodies_and_unbounded_depth(): void
    {
        $count = 0;
        $blocks = [['blockName' => 'core/group', 'attrs' => ['secret' => 'not-exported'], 'innerHTML' => '<input value="secret">', 'innerBlocks' => [['blockName' => 'core/paragraph', 'innerHTML' => 'body-secret']]], ['blockName' => null, 'innerHTML' => 'raw-body-secret']];
        self::assertSame([['name' => 'core/group', 'children' => [['name' => 'core/paragraph', 'children' => []]]]], Context::blocks($blocks, $count));
        self::assertSame(2, $count);
        $count = 0;
        self::assertCount(100, Context::blocks(array_fill(0, 500, ['blockName' => 'core/paragraph']), $count));
        self::assertSame([], Context::blocks($blocks, $count));
        $count = 0;
        self::assertSame([], Context::blocks($blocks, $count, 5));
    }

    public function test_scoped_validator_coexists_with_unscoped_dependencies(): void
    {
        self::assertTrue(class_exists(CompliantValidator::class));
        $validator = new ProtocolValidator;
        $validator->validate('providerResponse', json_decode('{"text":"Hello","emotion":"idle","finished":true,"toolCalls":[]}'));
        self::assertTrue(class_exists(\PageSquireWPVendor\Opis\JsonSchema\CompliantValidator::class));
        $this->expectException(AssistantException::class);
        $validator->validate('providerResponse', json_decode('{"text":"Bad","emotion":"idle","finished":true,"toolCalls":[],"eval":"bad"}'));
    }
}
