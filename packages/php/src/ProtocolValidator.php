<?php

declare(strict_types=1);

namespace PageSquire\Server;

use Opis\JsonSchema\CompliantValidator;
use stdClass;
use Throwable;

final class ProtocolValidator
{
    private CompliantValidator $validator;

    /** @var array<string, stdClass> */
    private array $schemas = [];

    public function __construct(?string $directory = null)
    {
        $this->validator = new CompliantValidator;
        foreach (glob(($directory ?? __DIR__.'/../resources/schemas').'/*.json') ?: [] as $file) {
            $schema = json_decode(file_get_contents($file), false, 64, JSON_THROW_ON_ERROR);
            $this->schemas[pathinfo($file, PATHINFO_FILENAME)] = $schema;
            $this->validator->resolver()->registerRaw($schema);
        }
        if (! isset($this->schemas['chatRequest'])) {
            throw new AssistantException('MISSING_SCHEMAS', 'Build the PageSquire protocol before using the server.', 500);
        }
    }

    public function validate(string $schemaName, mixed $value): void
    {
        $schema = $this->schemas[$schemaName] ?? throw new AssistantException('UNKNOWN_SCHEMA', 'Unknown protocol schema.', 500);
        $json = self::jsonValue($value);
        $this->against($schema, $json);
        $context = $schemaName === 'appContext' ? $json : ($schemaName === 'chatRequest' ? ($json->appContext ?? null) : null);
        if ($context instanceof stdClass) {
            $names = array_map(static fn (stdClass $field): string => $field->name, $context->fields);
            $ids = array_map(static fn (stdClass $entry): string => $entry->capabilityId, $context->availability);
            $encoded = json_encode($context, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_LINE_TERMINATORS);
            if (strlen($encoded) > 16384 || count(array_unique($names)) !== count($names) || count(array_unique($ids)) !== count($ids)) {
                throw new AssistantException('INVALID_PAYLOAD', 'The public app context exceeds its limits or contains duplicate identities.');
            }
        }
    }

    /** @param array<string, mixed> $schema */
    public function parameter(array $schema, mixed $parameters): void
    {
        $this->against(self::jsonValue($schema), is_array($parameters) && $parameters === [] ? new stdClass : self::jsonValue($parameters));
    }

    private function against(stdClass $schema, mixed $value): void
    {
        try {
            if ($this->validator->validate($value, $schema)->isValid()) {
                return;
            }
        } catch (Throwable) {
            throw new AssistantException('INVALID_SCHEMA', 'A trusted schema could not be validated.', 500);
        }
        throw new AssistantException('INVALID_PAYLOAD', 'The payload does not match the PageSquire contract.');
    }

    public static function jsonValue(mixed $value, ?string $key = null): mixed
    {
        if (! is_array($value)) {
            return $value;
        }
        $objectFields = ['parameters', 'evidence', 'properties'];
        if (array_is_list($value) && ! ($value === [] && in_array($key, $objectFields, true))) {
            return array_map(fn (mixed $item): mixed => self::jsonValue($item), $value);
        }
        $object = new stdClass;
        foreach ($value as $name => $item) {
            $object->{(string) $name} = self::jsonValue($item, (string) $name);
        }

        return $object;
    }
}
