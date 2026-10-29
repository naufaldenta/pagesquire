<?php

if (! defined('WP_CLI') || ! WP_CLI || ! defined('PAGESQUIRE_FIXTURE') || ! PAGESQUIRE_FIXTURE) {
    exit(1);
}
$pages = [];
foreach (['alpha', 'beta', 'private', 'draft', 'protected'] as $slug) {
    $existing = get_page_by_path('pagesquire-'.$slug);
    $content = '<!-- wp:heading --><h2 class="wp-block-heading">Public section</h2><!-- /wp:heading --><!-- wp:paragraph --><p id="body-copy">Ordinary public body text. <a href="https://example.test/">Public link</a></p><!-- /wp:paragraph --><!-- wp:html --><div data-pagesquire-private>private-section-secret</div><form><label>Password<input type="password" value="password-value-secret"></label><textarea>textarea-value-secret</textarea></form><!-- /wp:html -->';
    $pages[$slug] = wp_insert_post(['ID' => $existing?->ID ?? 0, 'post_type' => 'page', 'post_status' => $slug === 'private' ? 'private' : ($slug === 'draft' ? 'draft' : 'publish'), 'post_password' => $slug === 'protected' ? 'protected-page-secret' : '', 'post_title' => 'PageSquire '.ucfirst($slug), 'post_name' => 'pagesquire-'.$slug, 'post_content' => $content], true);
    if (is_wp_error($pages[$slug])) {
        throw new RuntimeException($pages[$slug]->get_error_message());
    }
}
update_option('pagesquire_fixture_pages', $pages, false);
if (! username_exists('fixture-reader')) {
    $id = wp_create_user('fixture-reader', 'pagesquire-reader-password', 'reader@example.test');
    (new WP_User($id))->set_role('subscriber');
}
update_option('permalink_structure', '');
// PageSquire Link starts empty on every run, so a failed earlier run leaves no partners behind.
foreach (['pagesquire_link', 'pagesquire_links'] as $option) {
    delete_option($option);
}
switch_theme('pagesquire-fixture');
WP_CLI::success('Seeded synthetic public/private pages and a reader; assistant remains opt-in.');
