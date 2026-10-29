<?php

namespace PageSquire\Laravel\Console;

use Illuminate\Console\Command;
use PageSquire\Server\AssistantException;
use PageSquire\Server\Link\LinkManager;

final class LinkAcceptCommand extends Command
{
    protected $signature = 'pagesquire:link-accept {invitation : The psq1.… invitation from the partner owner}';

    protected $description = "Accept another owner's PageSquire Link invitation";

    public function handle(LinkManager $manager): int
    {
        try {
            $link = $manager->acceptInvitation((string) $this->argument('invitation'));
        } catch (AssistantException $exception) {
            $this->error($exception->errorCode.': '.$exception->getMessage());

            return self::FAILURE;
        }
        $this->info('Paired with '.$link['partner']['name'].' ('.$link['partner']['origin'].').');
        $this->line('Link: '.$link['id'].' (pending until both owners approve)');
        $this->line('Partner skills: '.(implode(', ', array_column($link['partner']['skills'], 'id')) ?: 'none'));
        $this->line('Approve with: php artisan pagesquire:link-approve '.$link['id'].' --offer=skill:field,field --accept=own_skill');

        return self::SUCCESS;
    }
}
