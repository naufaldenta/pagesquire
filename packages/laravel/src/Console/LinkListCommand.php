<?php

namespace PageSquire\Laravel\Console;

use Illuminate\Console\Command;
use PageSquire\Server\Link\LinkManager;

final class LinkListCommand extends Command
{
    protected $signature = 'pagesquire:link-list';

    protected $description = 'List PageSquire Link partners and what each side approved';

    public function handle(LinkManager $manager): int
    {
        $rows = array_map(static fn (array $link): array => [
            $link['id'],
            $link['partner']['name'].' ('.$link['partner']['origin'].')',
            $link['status'],
            $link['ours']['approved'] ? implode(' ', array_map(static fn (string $skill, array $fields): string => $skill.':'.implode(',', $fields), array_keys($link['ours']['offer']), $link['ours']['offer'])) ?: '-' : 'not approved',
            $link['ours']['approved'] ? implode(',', $link['ours']['accept']) ?: '-' : 'not approved',
            $link['theirs']['approved'] ? implode(',', $link['theirs']['accept']) ?: '-' : 'not approved',
        ], $manager->list());
        if ($rows === []) {
            $this->line('No partners yet. Create an invitation with pagesquire:link-invite.');

            return self::SUCCESS;
        }
        $this->table(['Link', 'Partner', 'Status', 'We offer', 'We accept', 'They accept'], $rows);

        return self::SUCCESS;
    }
}
