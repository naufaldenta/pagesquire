<?php

declare(strict_types=1);
use PageSquire\WordPress\DatabaseCounter;
use PageSquire\WordPress\DatabaseLock;
use PageSquire\WordPress\OptionsStore;
use PageSquire\WordPress\Quota;
use PageSquireWPVendor\PageSquire\Server\AssistantException;

/** Local-only test harness. Never included in the distributable plugin. */
if (! defined('PAGESQUIRE_FIXTURE') || ! PAGESQUIRE_FIXTURE || PHP_SAPI !== 'cli' && ! in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
    return;
}

add_action('wp_abilities_api_categories_init', static function (): void {
    wp_register_ability_category('pagesquire-fixture', ['label' => 'PageSquire fixture', 'description' => 'Synthetic abilities for local tests.']);
});
add_action('wp_abilities_api_init', static function (): void {
    wp_register_ability('pagesquire-fixture/site-tagline', [
        'label' => 'Site tagline',
        'description' => 'Returns the public synthetic site tagline.',
        'category' => 'pagesquire-fixture',
        'output_schema' => ['type' => 'object', 'properties' => ['tagline' => ['type' => 'string']]],
        'execute_callback' => static fn (): array => ['tagline' => 'Synthetic fixture tagline'],
        'permission_callback' => '__return_true',
        'meta' => ['annotations' => ['readonly' => true, 'destructive' => false]],
    ]);
    wp_register_ability('pagesquire-fixture/reset-site', [
        'label' => 'Reset site',
        'description' => 'A writable synthetic ability that must never be offered.',
        'category' => 'pagesquire-fixture',
        'output_schema' => ['type' => 'object'],
        'execute_callback' => static function (): array {
            update_option('pagesquire_fixture_reset_ran', true, false);

            return [];
        },
        'permission_callback' => '__return_true',
        'meta' => ['annotations' => ['readonly' => false, 'destructive' => true]],
    ]);
});

add_filter('pre_http_request', static function (mixed $result, array $arguments, string $url): mixed {
    if (preg_match('~^http://127\.0\.0\.1:[0-9]+/~', $url) === 1 && ! str_starts_with($url, 'http://127.0.0.1:4177/')) {
        return $result; // Local PageSquire Link partners started by the tests.
    }
    if ($url !== 'https://provider.example.test/v1/chat/completions') {
        return new WP_Error('fixture_network_denied', 'External network is disabled in this fixture.');
    }
    update_option('pagesquire_fixture_calls', (int) get_option('pagesquire_fixture_calls', 0) + 1, false);
    $mode = get_option('pagesquire_fixture_mode', 'normal');
    if ($mode === 'failure') {
        return new WP_Error('fixture_failure', 'Synthetic provider failure with secret upstream detail.');
    }
    $body = json_decode($arguments['body'], true, 64, JSON_THROW_ON_ERROR);
    $text = '';
    $results = [];
    foreach ($body['messages'] as $message) {
        if ($message['role'] !== 'user') {
            continue;
        }
        $data = json_decode($message['content'], true);
        if (! is_array($data)) {
            $text = strtolower($message['content']);
            $results = [];
        } elseif (isset($data['browserResult'])) {
            $results[] = $data['browserResult'];
        }
    }
    $queue = [];
    if (str_contains($text, 'navigate')) {
        $ids = get_option('pagesquire_fixture_pages');
        $queue[] = ['capabilityId' => 'browser.navigate', 'parameters' => (object) ['url' => get_permalink($ids['beta'])]];
    }
    if (str_contains($text, 'tagline')) {
        $queue[] = ['capabilityId' => 'wordpress.run_ability', 'parameters' => (object) ['name' => 'pagesquire-fixture/site-tagline', 'input' => (object) []]];
    }
    foreach (['heading' => ['accessibility.set_heading_color', ['color' => '#ff0000']], 'link' => ['accessibility.set_link_highlight', ['enabled' => true]], 'bold' => ['accessibility.set_font_weight', ['weight' => 700]]] as $word => [$id, $parameters]) {
        if (str_contains($text, $word)) {
            $queue[] = ['capabilityId' => $id, 'parameters' => (object) $parameters];
        }
    }
    $call = $queue[count($results)] ?? null;
    $proposal = ['text' => $call ? 'Premature claim must stay hidden.' : 'The requested changes were verified on this page.', 'emotion' => 'happy', 'finished' => $call === null, 'toolCalls' => $call ? [$call] : []];
    if ($mode === 'invalid') {
        $proposal['toolCalls'] = [['capabilityId' => 'wordpress.delete_posts', 'parameters' => (object) []]];
        $proposal['finished'] = false;
    }

    return ['headers' => ['content-type' => 'application/json'], 'body' => wp_json_encode(['choices' => [['message' => ['content' => wp_json_encode($proposal)]]]]), 'response' => ['code' => 200, 'message' => 'OK'], 'cookies' => [], 'filename' => null];
}, 10, 3);

add_action('rest_api_init', static function (): void {
    $permission = static fn (WP_REST_Request $request): bool => current_user_can('manage_options') && (bool) wp_verify_nonce((string) $request->get_header('x-wp-nonce'), 'wp_rest') && $request->get_header('origin') === home_url();
    register_rest_route('pagesquire-fixture/v1', '/reset', ['methods' => 'POST', 'permission_callback' => $permission, 'callback' => static function (): array {
        $budget = json_decode(get_option(OptionsStore::name('site-request-budget'), '{}'), true);
        foreach (array_keys($budget['sessions'] ?? []) as $key) {
            delete_option(OptionsStore::name($key));
        }
        foreach (['pagesquire_settings', 'pagesquire_observations', 'pagesquire_provider_key', 'pagesquire_fixture_calls', 'pagesquire_fixture_mode', 'pagesquire_fixture_quota_time', 'pagesquire_fixture_reset_ran', OptionsStore::name('site-request-budget'), OptionsStore::name('site-provider-budget')] as $name) {
            delete_option($name);
        }
        pagesquire_fixture_delete_counters();
        switch_theme('pagesquire-fixture');

        return ['pages' => get_option('pagesquire_fixture_pages')];
    }]);
    register_rest_route('pagesquire-fixture/v1', '/state', ['methods' => 'GET', 'permission_callback' => $permission, 'callback' => static function (): array {
        return ['resetRan' => (bool) get_option('pagesquire_fixture_reset_ran', false), 'calls' => (int) get_option('pagesquire_fixture_calls', 0), 'budget' => wp_json_encode(['attempts' => (new Quota(new OptionsStore))->providerAttempts()]), 'pages' => get_option('pagesquire_fixture_pages')];
    }]);
    register_rest_route('pagesquire-fixture/v1', '/locks', ['methods' => 'POST', 'permission_callback' => $permission, 'callback' => static function (): array {
        global $wpdb;
        $key = 'fixture-lock-collision';
        $name = OptionsStore::name($key).'_lock';
        $entered = false;
        $busy = false;
        (new OptionsStore)->transaction($key, static function (?array $state, callable $save) use ($key, $name, &$entered, &$busy): void {
            wp_cache_delete($name, 'options');
            wp_cache_set('notoptions', [$name => true], 'options');
            try {
                (new OptionsStore)->transaction($key, static function () use (&$entered): void {
                    $entered = true;
                });
            } catch (AssistantException $error) {
                $busy = $error->errorCode === 'BUSY';
            }
            if (! OptionsStore::locked($key)) {
                throw new RuntimeException('The original owner lost its lock.');
            }
            $save(['verified' => true]);
        });
        $locks = new DatabaseLock($wpdb);
        $token = $locks->acquire($name);
        $ownerProtected = false;
        try {
            try {
                $locks->release($name, 'wrong-owner');
            } catch (AssistantException) {
                $ownerProtected = $locks->held($name);
            }
        } finally {
            $locks->release($name, $token);
            delete_option(OptionsStore::name($key));
        }

        return ['entered' => $entered, 'busy' => $busy, 'ownerProtected' => $ownerProtected, 'released' => ! $locks->held($name)];
    }]);
    register_rest_route('pagesquire-fixture/v1', '/control', ['methods' => 'POST', 'permission_callback' => $permission, 'callback' => static function (WP_REST_Request $request): array {
        $body = $request->get_json_params();
        if (isset($body['mode']) && in_array($body['mode'], ['normal', 'failure', 'invalid'], true)) {
            update_option('pagesquire_fixture_mode', $body['mode'], false);
        }
        if (isset($body['theme']) && in_array($body['theme'], ['pagesquire-fixture', 'pagesquire-ambiguous', 'twentytwentyfive'], true)) {
            switch_theme($body['theme']);
        }
        if ($body['resetRequestBudget'] ?? false) {
            delete_option(OptionsStore::name('site-request-budget'));
            pagesquire_fixture_delete_counters(['ip', 'site']);
        }
        if ($body['freezeQuotaClock'] ?? false) {
            update_option('pagesquire_fixture_quota_time', ['now' => time()], false);
        }
        if ($body['advanceQuotaClock'] ?? false) {
            $clock = get_option('pagesquire_fixture_quota_time', ['now' => time()]);
            update_option('pagesquire_fixture_quota_time', ['now' => $clock['now'] + 60], false);
        }
        if ($body['editPage'] ?? false) {
            $id = get_option('pagesquire_fixture_pages')['alpha'];
            wp_update_post(['ID' => $id, 'post_content' => get_post($id)->post_content.'<!-- wp:paragraph --><p>Changed public fixture.</p><!-- /wp:paragraph -->']);
        }

        return ['ok' => true];
    }]);
});

/** @param list<string> $kinds Counter kinds to delete; all when empty. */
function pagesquire_fixture_delete_counters(array $kinds = []): void
{
    global $wpdb;
    foreach ($kinds === [] ? [''] : $kinds as $kind) {
        $wpdb->query($wpdb->prepare('DELETE FROM %i WHERE option_name LIKE %s', $wpdb->options, $wpdb->esc_like(DatabaseCounter::PREFIX.($kind === '' ? '' : $kind.'_')).'%'));
    }
}
