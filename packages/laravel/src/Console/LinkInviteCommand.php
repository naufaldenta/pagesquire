<?php

namespace PageSquire\Laravel\Console;

use Illuminate\Console\Command;
use PageSquire\Server\AssistantException;
use PageSquire\Server\Link\LinkManager;

final class LinkInviteCommand extends Command
{
    protected $signature = 'pagesquire:link-invite {--hours=24 : How long the invitation stays valid (1 to 168)}';

    protected $description = 'Create a single-use PageSquire Link invitation for another site owner';

    public function handle(LinkManager $manager): int
    {
        try {
            $invitation = $manager->createInvitation((int) $this->option('hours'));
        } catch (AssistantException $exception) {
            $this->error($exception->getMessage());

            return self::FAILURE;
        }
        $this->line('Send this invitation to the partner owner over a channel you trust:');
        $this->line($invitation['code']);
        $this->line('It works once and expires '.date('Y-m-d H:i', intdiv($invitation['expiresAt'], 1000)).'.');

        return self::SUCCESS;
    }
}
