<?php

namespace PageSquire\Laravel;

use Illuminate\Contracts\Config\Repository;
use PageSquire\Server\AssistantException;
use PageSquire\Server\Link\Link;
use PageSquire\Server\ProtocolValidator;
use Throwable;

final class CapabilityCatalog
{
    public function __construct(private readonly Repository $config, private readonly ProtocolValidator $validator) {}

    /**
     * @return array<string, mixed>
     */
    public function manifest(): array
    {
        $manifest = $this->config->get('pagesquire.manifest');

        try {
            if (is_string($manifest)) {
                if (! is_file($manifest) || filesize($manifest) > 262144) {
                    throw new AssistantException('INVALID_CONFIGURATION', 'The assistant catalog is not configured.', 503);
                }

                $contents = file_get_contents($manifest);
                $manifest = json_decode($contents, false, 64, JSON_THROW_ON_ERROR);
                $this->validator->validate('manifest', $manifest);

                return $this->withLink(json_decode($contents, true, 64, JSON_THROW_ON_ERROR));
            }

            if (! is_array($manifest)) {
                throw new AssistantException('INVALID_CONFIGURATION', 'The assistant catalog is not configured.', 503);
            }

            $this->validator->validate('manifest', $manifest);

            return $this->withLink($manifest);
        } catch (Throwable) {
            throw new AssistantException('INVALID_CONFIGURATION', 'The assistant catalog is not configured.', 503);
        }
    }

    /**
     * With PageSquire Link on, the catalog also lists link.handoff and link.return; the pagesquire.capability gate still decides who may use them.
     *
     * @param  array<string, mixed>  $manifest
     * @return array<string, mixed>
     */
    private function withLink(array $manifest): array
    {
        if ($this->config->get('pagesquire.link.enabled') && $this->config->get('pagesquire.companion.signing_key')) {
            $ids = array_column($manifest['capabilities'], 'id');
            foreach ([Link::handoffCapability(), Link::returnCapability()] as $capability) {
                if (! in_array($capability['id'], $ids, true)) {
                    $manifest['capabilities'][] = $capability;
                }
            }
        }

        return $manifest;
    }
}
