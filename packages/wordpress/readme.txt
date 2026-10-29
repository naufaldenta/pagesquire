=== PageSquire ===
Contributors: pagesquire
Tags: assistant, accessibility, ai
Requires at least: 7.1
Tested up to: 7.1
Requires PHP: 8.3
Stable tag: 0.1.0-beta.0
License: GPLv3 or later
License URI: https://www.gnu.org/licenses/gpl-3.0.html

Owner-reviewed AI assistance for selected public pages, with verified basic adapters and configuration-only onboarding.

== Description ==

PageSquire is an experimental, disabled-by-default assistant. Configure an external OpenAI-compatible HTTPS JSON chat provider, select public pages, inspect the current frontend state, review mappings and explicitly enable access. No model training or universal theme discovery is claimed. See README.md for the complete English setup, privacy, retention and operational guidance.

== External services ==

The administrator can select Sumopod, OpenAI, OpenRouter, Groq, DeepSeek, Qwen/Alibaba Cloud, GLM via Z.AI or Zhipu, 9Router, Gemini, Mistral, Together AI, Fireworks AI, Cerebras, xAI or a Custom OpenAI-compatible HTTPS endpoint. Presets are connection profiles, not accounts, free credits or live certification of every model. API key and exact model ID are required; custom/regional gateways also require a full endpoint. Review https://github.com/naufaldenta/pagesquire/blob/main/docs/providers.md for each service's official documentation and setup instructions before consenting to external processing.

When enabled, visitor messages, filtered visible page observations and selected public metadata are sent to the provider endpoint chosen by the site administrator. No external model service is selected or contacted on activation, draft saving, inspection or context export. The administrator must supply the provider API key, review that provider's terms/privacy policy, configure spending controls and obtain appropriate visitor consent. Review public metadata before sharing AI integration exports with any coding service. PageSquire does not ship analytics or a hosted inference service.

PageSquire Link is off by default. When the administrator enables it and pairs with a partner site, this site's server exchanges signed messages with that partner's server only. Those messages carry site names, public keys, skills, approvals and revocations, and no visitor data. The partner is chosen and approved by the administrator.

== Installation ==

Upload the prebuilt ZIP, activate, open PageSquire, and complete the five setup steps. Production HTTPS is required. Server-side PAGESQUIRE_API_KEY configuration is supported; encrypted dashboard key storage also requires sodium. Hosting users do not need Composer or Node.js.

== Frequently Asked Questions ==

= Can this control every WordPress plugin? =
No. Only the approved heading-color, link-highlight, root-font-weight and exact-page navigation adapters are included. Elementor, WooCommerce and custom plugin workflows are not certified.

= Does import execute AI-generated code? =
No. Only a closed JSON mapping for the current origin and built-in adapter IDs is accepted. A custom integration requires separately reviewed developer work.

== Changelog ==

= 0.1.0-beta.0 =
Initial local F5 implementation. Not yet published to the WordPress.org directory.
