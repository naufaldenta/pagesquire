<?php

namespace PageSquire\Laravel\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use PageSquire\Server\Link\LinkEndpoint;
use PageSquire\Server\Link\LinkManager;

/** PageSquire Link endpoint: partner servers POST signed envelopes here. */
final class LinkController
{
    public function __invoke(Request $request, LinkManager $manager): JsonResponse
    {
        $response = (new LinkEndpoint($manager))->handle($request->getMethod(), (string) $request->header('Content-Type'), $request->getContent());

        return response()->json($response['body'], $response['status'], [], JSON_UNESCAPED_SLASHES)
            ->header('Cache-Control', 'no-store')
            ->header('X-Content-Type-Options', 'nosniff');
    }
}
