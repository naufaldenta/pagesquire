<?php

declare(strict_types=1);

use PageSquire\WordPress\Context;
use PageSquire\WordPress\Mapping;

if (! defined('ABSPATH')) {
    exit;
}
?>
<div class="wrap pagesquire-admin">
    <h1><?php esc_html_e('PageSquire setup', 'pagesquire'); ?></h1>
    <p><?php esc_html_e('Map a small, verified set of public website features. Discovery is not training and never grants permission.', 'pagesquire'); ?></p>
    <div id="pagesquire-admin-status" class="notice inline" role="status" aria-live="polite"></div>
    <form id="pagesquire-settings-form">
        <section class="pagesquire-step" aria-labelledby="pagesquire-step-1">
            <h2 id="pagesquire-step-1"><span class="pagesquire-step-number">1</span> <?php esc_html_e('Connect your provider', 'pagesquire'); ?></h2>
            <p><?php esc_html_e('Saving a draft does not contact a model. A provider key is never included in exports or returned to the browser.', 'pagesquire'); ?></p>
            <table class="form-table" role="presentation">
                <tr><th><label for="ps-name"><?php esc_html_e('Assistant name', 'pagesquire'); ?></label></th><td><input id="ps-name" name="assistantName" class="regular-text" maxlength="60" value="<?php echo esc_attr($settings['assistantName']); ?>" required></td></tr>
                <tr><th><label for="ps-language"><?php esc_html_e('Conversation language', 'pagesquire'); ?></label></th><td><select id="ps-language" name="language"><?php foreach (['auto' => 'Follow the visitor', 'en' => 'English', 'id' => 'Indonesian', 'es' => 'Spanish', 'fr' => 'French', 'de' => 'German', 'pt' => 'Portuguese', 'ja' => 'Japanese', 'zh' => 'Chinese'] as $value => $label) { ?><option value="<?php echo esc_attr($value); ?>" <?php selected($settings['language'], $value); ?>><?php echo esc_html($label); ?></option><?php } ?></select></td></tr>
                <tr><th><label for="ps-endpoint"><?php esc_html_e('HTTPS JSON provider endpoint', 'pagesquire'); ?></label></th><td><input id="ps-endpoint" name="endpoint" type="url" class="large-text" value="<?php echo esc_attr($settings['endpoint']); ?>" placeholder="https://provider.example/v1/chat/completions"></td></tr>
                <tr><th><label for="ps-model"><?php esc_html_e('Model identifier', 'pagesquire'); ?></label></th><td><input id="ps-model" name="model" class="regular-text" maxlength="200" value="<?php echo esc_attr($settings['model']); ?>"></td></tr>
                <tr><th><label for="ps-key"><?php esc_html_e('New provider key', 'pagesquire'); ?></label></th><td><input id="ps-key" name="apiKey" type="password" class="regular-text" autocomplete="new-password" value=""><p class="description"><?php echo esc_html($settings['providerConfigured'] ? __('A key is configured. Leave blank to keep it.', 'pagesquire') : __('No key configured. Use HTTPS and sodium for encrypted storage, or define PAGESQUIRE_API_KEY in wp-config.php.', 'pagesquire')); ?></p><label><input name="removeKey" type="checkbox"> <?php esc_html_e('Remove the dashboard-stored key and disable the assistant', 'pagesquire'); ?></label></td></tr>
            </table>
        </section>
        <section class="pagesquire-step" aria-labelledby="pagesquire-step-2">
            <h2 id="pagesquire-step-2"><span class="pagesquire-step-number">2</span> <?php esc_html_e('Choose public pages', 'pagesquire'); ?></h2>
            <p><?php esc_html_e('Choose up to 20 published, unprotected pages or posts. The list shows the first 50 public items plus saved selections. Private content, users, form values and raw post bodies are never exported.', 'pagesquire'); ?></p>
            <fieldset class="pagesquire-page-list"><legend class="screen-reader-text"><?php esc_html_e('Approved public pages', 'pagesquire'); ?></legend>
                <?php foreach ($state['choices'] as $page) { ?>
                    <label><input type="checkbox" name="pageIds" value="<?php echo esc_attr((string) $page['id']); ?>" <?php checked(in_array($page['id'], $settings['pageIds'], true)); ?>> <?php echo esc_html($page['title']); ?> <code>#<?php echo esc_html((string) $page['id']); ?></code></label>
                <?php } ?>
            </fieldset>
        </section>
        <section class="pagesquire-step" aria-labelledby="pagesquire-step-3">
            <h2 id="pagesquire-step-3"><span class="pagesquire-step-number">3</span> <?php esc_html_e('Inspect and verify', 'pagesquire'); ?></h2>
            <p><?php esc_html_e('Save the draft first. Open each selected frontend page, then run its adapter checks. Inspection uploads counts and verified adapter IDs, not page text, labels, field values or HTML. Navigation must be checked by arriving on each selected page.', 'pagesquire'); ?></p>
            <ul id="pagesquire-inspection-links"><?php foreach (Context::pages($settings) as $page) { ?><li><a href="<?php echo esc_url(add_query_arg('pagesquire_inspect', '1', $page['url'])); ?>" target="_blank" rel="noopener"><?php echo esc_html(sprintf(__('Inspect %s', 'pagesquire'), $page['title'])); ?></a></li><?php } ?></ul>
            <p><button type="button" class="button" id="pagesquire-refresh"><?php esc_html_e('Refresh readiness', 'pagesquire'); ?></button></p>
            <ul id="pagesquire-gaps"><?php foreach ($state['gaps'] as $gap) { ?><li><?php echo esc_html($gap); ?></li><?php } ?></ul>
            <p class="description"><?php esc_html_e('These checks cover the current visible frontend state only. Elementor, WooCommerce and third-party accessibility integrations are not certified.', 'pagesquire'); ?></p>
        </section>
        <section class="pagesquire-step" aria-labelledby="pagesquire-step-4">
            <h2 id="pagesquire-step-4"><span class="pagesquire-step-number">4</span> <?php esc_html_e('Review mappings or ask a coding agent', 'pagesquire'); ?></h2>
            <p><?php esc_html_e('Exports contain filtered public metadata and English assistant-setup skills for Codex and Claude Code. Review them in a separate folder. Imports accept only this site’s built-in adapter configuration, never executable code or arbitrary selectors.', 'pagesquire'); ?></p>
            <p><label for="ps-root"><?php esc_html_e('Public content root', 'pagesquire'); ?></label> <select id="ps-root" name="contentRoot"><?php foreach (Mapping::ROOTS as $selector) { ?><option value="<?php echo esc_attr($selector); ?>" <?php selected($settings['mapping']['contentRoot'], $selector); ?>><?php echo esc_html($selector); ?></option><?php } ?></select></p>
            <fieldset><legend><?php esc_html_e('Permitted basic adapters', 'pagesquire'); ?></legend><?php foreach (Mapping::CAPABILITIES as $id) { ?><label class="pagesquire-adapter"><input type="checkbox" name="capabilityIds" value="<?php echo esc_attr($id); ?>" <?php checked(in_array($id, $settings['mapping']['capabilityIds'], true)); ?>> <code><?php echo esc_html($id); ?></code></label><?php } ?></fieldset>
            <p><button type="button" class="button" id="pagesquire-export"><?php esc_html_e('Export AI integration ZIP', 'pagesquire'); ?></button> <label class="button" for="pagesquire-import"><?php esc_html_e('Import mapping JSON', 'pagesquire'); ?></label><input id="pagesquire-import" type="file" accept="application/json,.json" class="screen-reader-text"></p>
        </section>
        <section class="pagesquire-step" aria-labelledby="pagesquire-step-5">
            <h2 id="pagesquire-step-5"><span class="pagesquire-step-number">5</span> <?php esc_html_e('Review access and enable', 'pagesquire'); ?></h2>
            <p><label for="ps-access"><?php esc_html_e('Who can use the assistant?', 'pagesquire'); ?></label> <select id="ps-access" name="access"><?php foreach (['administrators' => 'Administrators only', 'authenticated' => 'Logged-in readers', 'public' => 'Public visitors (explicit opt-in)'] as $value => $label) { ?><option value="<?php echo esc_attr($value); ?>" <?php selected($settings['access'], $value); ?>><?php echo esc_html($label); ?></option><?php } ?></select></p>
            <p><label for="ps-budget"><?php esc_html_e('Site-wide provider attempts per UTC day', 'pagesquire'); ?></label> <input id="ps-budget" name="dailyAttempts" type="number" min="1" max="1000" value="<?php echo esc_attr((string) $settings['dailyAttempts']); ?>"></p>
            <p><?php esc_html_e('Attempts include failures and are saved before inference. This is not a currency cap. Add hosting/IP protections and review provider costs before enabling public access.', 'pagesquire'); ?></p>
            <p><label><input name="consent" type="checkbox" <?php checked($settings['consent']); ?>> <?php esc_html_e('I approve sending visitor messages, filtered page observations and selected public metadata to the configured external provider.', 'pagesquire'); ?></label></p>
            <p id="pagesquire-enabled-state"><?php echo esc_html($settings['enabled'] ? __('Assistant enabled', 'pagesquire') : __('Assistant disabled', 'pagesquire')); ?></p>
            <p><button type="submit" class="button button-secondary" value="draft"><?php esc_html_e('Save draft and disable', 'pagesquire'); ?></button> <button type="submit" class="button button-primary" value="enable"><?php esc_html_e('Enable verified assistant', 'pagesquire'); ?></button></p>
        </section>
    </form>
</div>
