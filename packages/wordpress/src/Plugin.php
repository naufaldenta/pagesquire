<?php

declare(strict_types=1);

namespace PageSquire\WordPress;

use PageSquireWPVendor\PageSquire\Server\AssistantException;
use PageSquireWPVendor\PageSquire\Server\ConversationEngine;
use PageSquireWPVendor\PageSquire\Server\Http\ChatEndpoint;
use PageSquireWPVendor\PageSquire\Server\Http\OpenAiCompatibleProvider;
use PageSquireWPVendor\PageSquire\Server\ProtocolValidator;
use PageSquireWPVendor\PageSquire\Server\ProviderConfiguration;

final class Plugin
{
    public function __construct(private readonly string $file) {}

    public function register(): void
    {
        add_action('rest_api_init', $this->routes(...));
        add_action('admin_menu', function (): void {
            add_menu_page('PageSquire', 'PageSquire', 'manage_options', 'pagesquire', $this->dashboard(...), 'dashicons-universal-access-alt', 80);
        });
        add_action('admin_enqueue_scripts', function (string $hook): void {
            if ($hook === 'toplevel_page_pagesquire' && current_user_can('manage_options')) {
                wp_enqueue_style('pagesquire-admin', plugins_url('assets/plugin.css', $this->file), [], '0.1.0-beta.0');
                wp_enqueue_script('pagesquire-admin', plugins_url('assets/admin.js', $this->file), [], '0.1.0-beta.0', true);
            }
        });
        add_action('wp_enqueue_scripts', $this->frontend(...));
        add_filter('rest_pre_dispatch', function (mixed $result, \WP_REST_Server $server, \WP_REST_Request $request): mixed {
            if (str_starts_with($request->get_route(), '/pagesquire/v1/')) {
                if (strlen($request->get_body()) > 196608) {
                    return new \WP_Error('REQUEST_TOO_LARGE', 'The assistant request is too large.', ['status' => 413]);
                }
                $encoding = (string) $request->get_header('content-encoding');
                if ($encoding !== '' && $encoding !== 'identity') {
                    return new \WP_Error('JSON_REQUIRED', 'Compressed assistant requests are not supported.', ['status' => 415]);
                }
            }

            return $result;
        }, 1, 3);
        add_filter('rest_post_dispatch', static function (mixed $response, \WP_REST_Server $server, \WP_REST_Request $request): mixed {
            if (str_starts_with($request->get_route(), '/pagesquire/v1/') && $response instanceof \WP_REST_Response) {
                $response->header('Cache-Control', 'no-store, private');
                $response->header('X-Content-Type-Options', 'nosniff');
            }

            return $response;
        }, 10, 3);
    }

    public function routes(): void
    {
        $admin = $this->adminPermission(...);
        $public = $this->publicPermission(...);
        $definitions = [
            ['/admin', 'GET', fn (): array => $this->adminState(), $admin],
            ['/settings', 'PUT', function (\WP_REST_Request $request): array {
                $raw = $this->raw($request);
                if (! $raw instanceof \stdClass) {
                    throw new AssistantException('INVALID_SETTINGS', 'Send a settings object.');
                }

                return Settings::save(get_object_vars($raw));
            }, $admin],
            ['/context', 'GET', fn (): array => Context::bundle(Settings::get()), $admin],
            ['/mapping', 'PUT', function (\WP_REST_Request $request): array {
                $mapping = Mapping::validate($this->raw($request), Settings::origin());
                $settings = Settings::get();
                $settings['mapping'] = $mapping;
                $settings['enabled'] = false;
                $settings['revision']++;
                update_option('pagesquire_settings', $settings, false);
                update_option('pagesquire_observations', [], false);

                return ['mapping' => $mapping, 'enabled' => false];
            }, $admin],
            ['/observations', 'POST', function (\WP_REST_Request $request): array {
                $settings = Settings::get();
                $report = Context::report($this->raw($request), $settings);
                $reports = get_option('pagesquire_observations', []);
                $reports[$report['pageId']] = $report;
                $reports = array_intersect_key($reports, array_flip($settings['pageIds']));
                update_option('pagesquire_observations', $reports, false);

                return ['saved' => true, 'gaps' => Context::gaps($settings)];
            }, $admin],
            ['/session', 'POST', function (\WP_REST_Request $request): array {
                $raw = $this->raw($request);
                if (! $raw instanceof \stdClass || get_object_vars($raw) !== []) {
                    throw new AssistantException('INVALID_PAYLOAD', 'Send an empty session bootstrap object.');
                }
                $settings = Settings::get();
                $session = Session::issue($settings);
                (new Quota(new OptionsStore))->request($this->ipHash(), $session['key'], $session['expiresAt']);

                return ['csrfToken' => $session['csrfToken']];
            }, $public],
            ['/chat', 'POST', $this->chat(...), $public],
            ['/ability', 'POST', $this->ability(...), $public],
        ];
        foreach ($definitions as [$path, $methods, $callback, $permission]) {
            register_rest_route('pagesquire/v1', $path, ['methods' => $methods, 'permission_callback' => $permission, 'callback' => function (\WP_REST_Request $request) use ($callback): mixed {
                try {
                    return $callback($request);
                } catch (AssistantException $error) {
                    return new \WP_Error($error->errorCode, $error->getMessage(), ['status' => $error->httpStatus === 419 ? 403 : $error->httpStatus]);
                } catch (\Throwable) {
                    return new \WP_Error('ASSISTANT_UNAVAILABLE', 'The assistant is unavailable. Review configuration or try again later.', ['status' => 503]);
                }
            }]);
        }
    }

    public function adminPermission(\WP_REST_Request $request): bool|\WP_Error
    {
        if (! current_user_can('manage_options') || ! wp_verify_nonce((string) $request->get_header('x-wp-nonce'), 'wp_rest') || (string) $request->get_header('origin') !== '' && $request->get_header('origin') !== Settings::origin()) {
            return new \WP_Error('ACCESS_DENIED', 'Administrator permission and a valid WordPress nonce are required.', ['status' => 403]);
        }

        return true;
    }

    public function publicPermission(\WP_REST_Request $request): bool|\WP_Error
    {
        $settings = Settings::get();
        if ($request->get_header('origin') !== Settings::origin() || ! $settings['enabled'] || ! $settings['consent'] || ! Settings::canUse($settings) || Settings::key() === '' || $settings['endpoint'] === '' || $settings['model'] === '' || Context::gaps($settings) !== []) {
            return new \WP_Error('ACCESS_DENIED', 'The assistant is not enabled or authorized for this site/session.', ['status' => 403]);
        }

        return true;
    }

    private function raw(\WP_REST_Request $request): mixed
    {
        if (! preg_match('/^application\/json(?:\s*;|$)/i', (string) $request->get_header('content-type'))) {
            throw new AssistantException('JSON_REQUIRED', 'Send an application/json request.', 415);
        }

        try {
            return json_decode($request->get_body(), false, 64, JSON_THROW_ON_ERROR);
        } catch (\JsonException) {
            throw new AssistantException('INVALID_PAYLOAD', 'Send a valid JSON object.');
        }
    }

    /** Runs one approved read-only WordPress ability for the browser handler of wordpress.run_ability. */
    public function ability(\WP_REST_Request $request): array
    {
        $settings = Settings::get();
        $session = Session::read($settings);
        if ($session === null) {
            throw new AssistantException('SESSION_REQUIRED', 'Reload the page to establish an assistant session.', 403);
        }
        $token = (string) $request->get_header('x-csrf-token');
        if ($request->get_header('origin') !== Settings::origin() || strlen($token) < 16 || ! hash_equals($session['csrfToken'], $token)) {
            throw new AssistantException('CSRF_MISMATCH', 'Refresh the page before using the assistant.', 403);
        }
        $raw = $this->raw($request);
        if (! $raw instanceof \stdClass || array_keys(get_object_vars($raw)) !== ['name', 'input'] || ! $raw->input instanceof \stdClass) {
            throw new AssistantException('INVALID_PAYLOAD', 'Send an ability name and input object.');
        }
        (new Quota(new OptionsStore))->request($this->ipHash());
        $input = json_decode(wp_json_encode($raw->input), true, 32, JSON_THROW_ON_ERROR);

        return ['output' => Abilities::run($settings, $raw->name, $input)];
    }

    public function chat(\WP_REST_Request $request): \WP_REST_Response
    {
        $settings = Settings::get();
        $session = Session::read($settings);
        if ($session === null) {
            throw new AssistantException('SESSION_REQUIRED', 'Reload the page to establish an assistant session.', 403);
        }
        if (! $this->raw($request) instanceof \stdClass) {
            throw new AssistantException('INVALID_PAYLOAD', 'Send a chat request object.');
        }
        $input = json_decode($request->get_body(), true, 64, JSON_THROW_ON_ERROR);
        $permittedUrls = array_column(Context::pages($settings), 'url');
        if (! in_array($input['snapshot']['url'] ?? null, $permittedUrls, true)) {
            throw new AssistantException('PAGE_DENIED', 'Use the assistant only on an approved public page.', 403);
        }
        $store = new OptionsStore;
        $quota = new Quota($store);
        $quota->request($this->ipHash());
        if ($quota->providerExhausted($settings['dailyAttempts'])) {
            throw new AssistantException('PROVIDER_BUDGET', 'The site provider attempt budget was reached. Try again tomorrow.', 429);
        }
        $validator = new ProtocolValidator;
        $provider = new SiteProvider(new OpenAiCompatibleProvider($validator, $settings['endpoint'], Settings::key(), $settings['model'], new WordPressHttpClient, options: Settings::providerOptions($settings)), $quota, $settings);
        $endpoint = new ChatEndpoint(new ConversationEngine($provider, $validator, Mapping::manifest($settings['mapping']), locale: self::locale($settings)), $validator, $store, Settings::origin());
        $result = $endpoint->handle($request->get_method(), ['origin' => $request->get_header('origin'), 'content-type' => $request->get_header('content-type'), 'x-csrf-token' => $request->get_header('x-csrf-token')], $request->get_body(), $session);

        return new \WP_REST_Response($result['body'], $result['status'] === 419 ? 403 : $result['status']);
    }

    /** Built-in UI and engine language: Indonesian for an Indonesian site or setting, English otherwise. */
    private static function locale(array $settings): string
    {
        $language = $settings['language'] === 'auto' ? strtolower(substr((string) get_locale(), 0, 2)) : $settings['language'];

        return $language === 'id' ? 'id' : 'en';
    }

    private function ipHash(): string
    {
        return hash_hmac('sha256', (string) ($_SERVER['REMOTE_ADDR'] ?? 'unknown'), wp_salt('auth'));
    }

    public function adminState(): array
    {
        $settings = Settings::get();
        $posts = get_posts(['post_type' => ['page', 'post'], 'post_status' => 'publish', 'posts_per_page' => 50, 'suppress_filters' => false]);
        foreach ($settings['pageIds'] as $id) {
            $posts[] = get_post($id);
        }
        $choices = [];
        foreach ($posts as $post) {
            if (Context::permitted($post)) {
                $choices[$post->ID] = ['id' => $post->ID, 'title' => mb_substr(sanitize_text_field($post->post_title), 0, 160), 'url' => Context::url($post->ID)];
            }
        }

        return ['settings' => Settings::publicSettings(), 'providers' => ProviderConfiguration::presets(), 'choices' => array_values($choices), 'gaps' => Context::gaps($settings), 'observations' => array_values(get_option('pagesquire_observations', [])), 'abilities' => Abilities::available()];
    }

    public function dashboard(): void
    {
        if (! current_user_can('manage_options')) {
            return;
        }
        $state = $this->adminState();
        $settings = $state['settings'];
        $config = ['rest' => rest_url('pagesquire/v1/'), 'nonce' => wp_create_nonce('wp_rest'), 'origin' => Settings::origin(), 'state' => $state, 'skillUrl' => plugins_url('assets/assistant-setup.md', $this->file)];
        require __DIR__.'/../views/dashboard.php';
        $this->jsonConfig('pagesquire-admin-config', $config);
    }

    private function jsonConfig(string $id, array $config): void
    {
        echo '<script type="application/json" id="'.esc_attr($id).'">'.wp_json_encode($config, JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT).'</script>';
    }

    public function frontend(): void
    {
        $settings = Settings::get();
        $pageId = get_queried_object_id();
        if (! in_array($pageId, $settings['pageIds'], true) || ! Context::permitted(get_post($pageId))) {
            return;
        }
        $inspect = isset($_GET['pagesquire_inspect']) && $_GET['pagesquire_inspect'] === '1' && current_user_can('manage_options');
        if (! $inspect && (! $settings['enabled'] || ! $settings['consent'] || ! Settings::canUse($settings) || Settings::key() === '' || Context::gaps($settings) !== [])) {
            return;
        }
        wp_enqueue_style('pagesquire-widget', plugins_url('assets/widget.css', $this->file), [], '0.1.0-beta.0');
        wp_enqueue_style('pagesquire-site', plugins_url('assets/plugin.css', $this->file), ['pagesquire-widget'], '0.1.0-beta.0');
        wp_enqueue_script('pagesquire-site', plugins_url('assets/frontend.js', $this->file), [], '0.1.0-beta.0', true);
        $config = ['rest' => rest_url('pagesquire/v1/'), 'nonce' => is_user_logged_in() ? wp_create_nonce('wp_rest') : '', 'origin' => Settings::origin(), 'inspect' => $inspect, 'pageId' => $pageId, 'pages' => Context::pages($settings), 'mapping' => $settings['mapping'], 'fingerprint' => Context::fingerprint($settings), 'assistantName' => $settings['assistantName'], 'locale' => self::locale($settings)];
        add_action('wp_footer', function () use ($config): void {
            echo '<div id="pagesquire-widget" data-pagesquire-root></div>';
            $this->jsonConfig('pagesquire-site-config', $config);
        }, 5);
    }
}
