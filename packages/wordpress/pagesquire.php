<?php

/**
 * Plugin Name: PageSquire — AI Website Assistant
 * Description: Guided, verified website actions with explicit scope, private context export and server-owned conversations.
 * Version: 0.1.0-alpha.0
 * Requires at least: 7.1
 * Requires PHP: 8.3
 * License: GPL-3.0-or-later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: pagesquire
 */

declare(strict_types=1);
use PageSquire\WordPress\Plugin;

if (! defined('ABSPATH')) {
    exit;
}
if (PHP_VERSION_ID < 80300 || ! is_file(__DIR__.'/runtime/autoload.php')) {
    add_action('admin_notices', static function (): void {
        if (current_user_can('manage_options')) {
            echo '<div class="notice notice-error"><p>'.esc_html__('PageSquire requires PHP 8.3 and the complete built plugin ZIP.', 'pagesquire').'</p></div>';
        }
    });

    return;
}
require_once __DIR__.'/autoload.php';
add_action('plugins_loaded', static function (): void {
    (new Plugin(__FILE__))->register();
});
