<?php

declare(strict_types=1);
use PageSquire\WordPress\DatabaseLock;
use PageSquire\WordPress\OptionsStore;
use PageSquireWPVendor\PageSquire\Server\AssistantException;

/** Local-only test harness. Never included in the distributable plugin. */
if (! defined('PAGESQUIRE_FIXTURE') || ! PAGESQUIRE_FIXTURE || PHP_SAPI !== 'cli' && ! in_array($_SERVER['REMOTE_ADDR'] ?? '', ['127.0.0.1', '::1'], true)) {
    return;
}

add_filter('pre_http_request', static function (mixed $result, array $arguments, string $url): mixed {
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
        foreach (['pagesquire_settings', 'pagesquire_observations', 'pagesquire_provider_key', 'pagesquire_fixture_calls', 'pagesquire_fixture_mode', 'pagesquire_fixture_quota_time', OptionsStore::name('site-request-budget'), OptionsStore::name('site-provider-budget')] as $name) {
            delete_option($name);
        }
        switch_theme('pagesquire-fixture');

        return ['pages' => get_option('pagesquire_fixture_pages')];
    }]);
    register_rest_route('pagesquire-fixture/v1', '/state', ['methods' => 'GET', 'permission_callback' => $permission, 'callback' => static function (): array {
        return ['calls' => (int) get_option('pagesquire_fixture_calls', 0), 'budget' => get_option(OptionsStore::name('site-provider-budget')), 'pages' => get_option('pagesquire_fixture_pages')];
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
