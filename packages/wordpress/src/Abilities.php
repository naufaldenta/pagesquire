<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;

/**
 * Bridges administrator-approved, read-only WordPress Abilities (WordPress 6.9+)
 * into the assistant. Abilities run server-side through WP_Ability::execute(),
 * so their own input schema and permission_callback apply to the current
 * visitor. Writable abilities are never offered or run.
 */
final class Abilities
{
    public const CAPABILITY = 'wordpress.run_ability';

    public const MAX_SELECTED = 20;

    public const MAX_OUTPUT_BYTES = 16384;

    /** @return list<array{name: string, label: string, description: string, inputSchema: mixed}> */
    public static function available(): array
    {
        if (! function_exists('wp_get_abilities')) {
            return [];
        }
        $abilities = [];
        foreach (wp_get_abilities() as $ability) {
            if (is_object($ability) && self::readOnly($ability) && self::validName($ability->get_name())) {
                $abilities[] = self::describe($ability);
            }
        }
        usort($abilities, static fn (array $a, array $b): int => strcmp($a['name'], $b['name']));

        return $abilities;
    }

    /** @return list<string> */
    public static function validateSelection(mixed $names): array
    {
        if (! is_array($names) || ! array_is_list($names) || count($names) > self::MAX_SELECTED) {
            throw new AssistantException('INVALID_SETTINGS', 'Select at most '.self::MAX_SELECTED.' read-only abilities.');
        }
        $available = array_column(self::available(), 'name');
        foreach ($names as $name) {
            if (! is_string($name) || ! in_array($name, $available, true)) {
                throw new AssistantException('INVALID_SETTINGS', 'Only registered read-only abilities can be selected.');
            }
        }
        if (count(array_unique($names)) !== count($names)) {
            throw new AssistantException('INVALID_SETTINGS', 'Choose each ability only once.');
        }

        return $names;
    }

    /**
     * Selected abilities that are still registered and still read-only.
     *
     * @param  array<string, mixed>  $settings
     * @return list<array{name: string, label: string, description: string, inputSchema: mixed}>
     */
    public static function approved(array $settings): array
    {
        if (! in_array(self::CAPABILITY, $settings['mapping']['capabilityIds'] ?? [], true)) {
            return [];
        }
        $selected = $settings['abilities'] ?? [];

        return array_values(array_filter(self::available(), static fn (array $ability): bool => in_array($ability['name'], $selected, true)));
    }

    /** @param array<string, mixed> $settings */
    public static function run(array $settings, mixed $name, mixed $input): mixed
    {
        if (! is_string($name) || ! in_array($name, array_column(self::approved($settings), 'name'), true) || ! is_array($input) || count($input) > 50) {
            throw new AssistantException('ABILITY_DENIED', 'This ability is not approved for the assistant.', 403);
        }
        $ability = wp_get_ability($name);
        if (! is_object($ability) || ! self::readOnly($ability)) {
            throw new AssistantException('ABILITY_DENIED', 'This ability is not approved for the assistant.', 403);
        }
        // WP_Ability validates input against its schema and applies its permission_callback.
        $output = $ability->execute($input === [] ? null : $input);
        if ($output === null || is_wp_error($output)) {
            throw new AssistantException('ABILITY_FAILED', 'The ability could not run for this visitor.', 422);
        }
        $encoded = wp_json_encode($output);
        if (! is_string($encoded) || strlen($encoded) > self::MAX_OUTPUT_BYTES) {
            throw new AssistantException('ABILITY_OUTPUT_TOO_LARGE', 'The ability returned more data than the assistant accepts.', 413);
        }

        return json_decode($encoded);
    }

    private static function readOnly(object $ability): bool
    {
        $meta = method_exists($ability, 'get_meta') ? $ability->get_meta() : [];

        return is_array($meta) && ($meta['annotations']['readonly'] ?? false) === true;
    }

    private static function validName(mixed $name): bool
    {
        return is_string($name) && strlen($name) <= 128 && preg_match('#^[a-z0-9-]+/[a-z0-9-]+$#', $name) === 1;
    }

    /** @return array{name: string, label: string, description: string, inputSchema: mixed} */
    private static function describe(object $ability): array
    {
        return [
            'name' => $ability->get_name(),
            'label' => mb_substr(sanitize_text_field((string) $ability->get_label()), 0, 120),
            'description' => mb_substr(sanitize_text_field((string) $ability->get_description()), 0, 500),
            'inputSchema' => $ability->get_input_schema() ?? (object) [],
        ];
    }
}
