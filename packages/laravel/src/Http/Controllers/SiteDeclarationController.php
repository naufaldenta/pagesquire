<?php

namespace PageSquire\Laravel\Http\Controllers;

use Illuminate\Http\JsonResponse;
use PageSquire\Server\ActionSigner;

/** Serves /.well-known/pagesquire.json for the companion extension. */
final class SiteDeclarationController
{
    public function __invoke(ActionSigner $signer): JsonResponse
    {
        return response()
            ->json($signer->declaration('/'.ltrim((string) config('pagesquire.path'), '/'), (bool) config('pagesquire.companion.screenshots', false)), 200, [], JSON_UNESCAPED_SLASHES)
            ->header('Cache-Control', 'public, max-age=300')
            ->header('X-Content-Type-Options', 'nosniff');
    }
}
