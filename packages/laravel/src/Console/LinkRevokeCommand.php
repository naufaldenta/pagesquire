<?php

namespace PageSquire\Laravel\Console;

use Illuminate\Console\Command;
use PageSquire\Server\AssistantException;
use PageSquire\Server\Link\LinkManager;

final class LinkRevokeCommand extends Command
{
    protected $signature = 'pagesquire:link-revoke {link : The link ID}';

    protected $description = 'Revoke a PageSquire Link at once and tell the partner';

    public function handle(LinkManager $manager): int
    {
        try {
            $result = $manager->revoke((string) $this->argument('link'));
        } catch (AssistantException $exception) {
            $this->error($exception->errorCode.': '.$exception->getMessage());

            return self::FAILURE;
        }
        $this->info('Revoked.');
        if (! $result['notified']) {
            $this->warn('The partner could not be reached; it will refuse on its side once it tries this link.');
        }

        return self::SUCCESS;
    }
}
