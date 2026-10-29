<?php

namespace PageSquire\Laravel\Console;

use Illuminate\Console\Command;
use PageSquire\Server\AssistantException;
use PageSquire\Server\Link\LinkManager;

final class LinkApproveCommand extends Command
{
    protected $signature = 'pagesquire:link-approve {link : The link ID}
        {--offer=* : A partner skill this site may offer, with the fields it may carry: skill:field,field}
        {--accept=* : One of this site\'s own skills the partner may hand visitors into}';

    protected $description = "Approve this site's side of a PageSquire Link";

    public function handle(LinkManager $manager): int
    {
        $offer = [];
        foreach ((array) $this->option('offer') as $entry) {
            [$skill, $fields] = array_pad(explode(':', (string) $entry, 2), 2, '');
            $offer[$skill] = $fields === '' ? [] : explode(',', $fields);
        }
        try {
            $result = $manager->approve((string) $this->argument('link'), ['offer' => $offer, 'accept' => array_values((array) $this->option('accept'))]);
        } catch (AssistantException $exception) {
            $this->error($exception->errorCode.': '.$exception->getMessage());

            return self::FAILURE;
        }
        $this->info('Approved. Status: '.$result['record']['status'].'.');
        if (! $result['notified']) {
            $this->warn('The partner could not be reached; approve again later to tell it.');
        }

        return self::SUCCESS;
    }
}
