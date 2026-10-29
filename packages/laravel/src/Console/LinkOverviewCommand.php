<?php

namespace PageSquire\Laravel\Console;

use Illuminate\Console\Command;
use PageSquire\Server\Link\LinkManager;

final class LinkOverviewCommand extends Command
{
    protected $signature = 'pagesquire:link-overview';

    protected $description = 'Show which partners offer each service, which partners may use your skills, and the visitors carried';

    public function handle(LinkManager $manager): int
    {
        $overview = $manager->overview();
        $partners = static fn (array $entry): string => implode(', ', array_map(static fn (array $partner): string => $partner['name'].' ('.$partner['origin'].')', $entry['partners'])) ?: '-';
        $this->line(sprintf(
            'Partners: %d active, %d pending, %d revoked. Visitors sent: %d, received: %d.',
            $overview['links']['active'],
            $overview['links']['pending'],
            $overview['links']['revoked'],
            $overview['totals']['sent'],
            $overview['totals']['received'],
        ));
        if (isset($overview['agents'])) {
            $this->line(sprintf(
                'A2A agents may send requests into: %s. Requests received: %d.',
                implode(', ', $overview['agents']['skills']) ?: 'no skills yet',
                $overview['agents']['received'],
            ));
        }

        $this->newLine();
        $this->line('Partner services your assistant may offer (with several partners, the visitor chooses):');
        if ($overview['offered'] === []) {
            $this->line('None yet. Approve a partner skill with pagesquire:link-approve --offer.');
        } else {
            $this->table(['Skill', 'Partners'], array_map(static fn (array $entry): array => [$entry['skill'].' ('.$entry['name'].')', $partners($entry)], $overview['offered']));
        }

        $this->newLine();
        $this->line('Your skills partners may hand visitors into:');
        if ($overview['accepted'] === []) {
            $this->line('This site lists no skills. Add them under pagesquire.link.skills.');
        } else {
            $this->table(['Skill', 'Partners'], array_map(static fn (array $entry): array => [$entry['skill'].' ('.$entry['name'].')', $partners($entry)], $overview['accepted']));
        }

        $rows = [];
        foreach ($manager->list() as $link) {
            if (! isset($link['stats'])) {
                continue;
            }
            $rows[] = [
                $link['partner']['name'].' ('.$link['partner']['origin'].')',
                $link['stats']['sent'].' / '.$link['stats']['received'],
                implode(', ', array_map(static fn (string $skill, array $counts): string => $skill.' '.$counts['sent'].' / '.$counts['received'], array_keys($link['stats']['skills'] ?? []), $link['stats']['skills'] ?? [])) ?: '-',
                isset($link['stats']['lastAt']) ? gmdate('Y-m-d H:i', intdiv($link['stats']['lastAt'], 1000)).' UTC' : '-',
            ];
        }
        $this->newLine();
        $this->line('Visitors carried, sent / received:');
        if ($rows === []) {
            $this->line('No handoffs yet.');
        } else {
            $this->table(['Partner', 'All', 'Handoffs per skill', 'Last'], $rows);
        }

        return self::SUCCESS;
    }
}
