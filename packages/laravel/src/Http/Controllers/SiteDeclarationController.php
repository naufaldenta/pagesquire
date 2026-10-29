<?php

namespace PageSquire\Laravel\Http\Controllers;

use Illuminate\Http\JsonResponse;
use PageSquire\Server\ActionSigner;
use PageSquire\Server\Link\LinkManager;

/** Serves /.well-known/pagesquire.json for the companion extension and Link partners. */
final class SiteDeclarationController
{
    public function __invoke(ActionSigner $signer): JsonResponse
    {
        $link = config('pagesquire.link.enabled') ? app(LinkManager::class)->declaration() : null;

        return response()
            ->json($signer->declaration('/'.ltrim((string) config('pagesquire.path'), '/'), (bool) config('pagesquire.companion.screenshots', false), $link), 200, [], JSON_UNESCAPED_SLASHES)
            ->header('Cache-Control', 'public, max-age=300')
            ->header('X-Content-Type-Options', 'nosniff');
    }
}
