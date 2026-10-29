<?php

namespace PageSquire\Laravel\Http\Controllers;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use PageSquire\Server\Link\A2AEndpoint;
use PageSquire\Server\Link\LinkManager;

/** PageSquire Link's optional A2A interface: the signed Agent Card, its key set, and the JSON-RPC endpoint. */
final class A2AController
{
    public function __invoke(Request $request, LinkManager $manager): JsonResponse
    {
        $response = (new A2AEndpoint($manager))->handle(
            $request->getMethod(),
            (string) $request->header('Content-Type'),
            $request->getContent(),
            (string) ($request->header('A2A-Version') ?? $request->query('A2A-Version', '')),
        );

        return response()->json($response['body'], $response['status'], [], JSON_UNESCAPED_SLASHES)
            ->header('Cache-Control', 'no-store')
            ->header('X-Content-Type-Options', 'nosniff');
    }

    /** /.well-known/agent-card.json */
    public function card(LinkManager $manager): JsonResponse
    {
        return $this->published($manager->agentCard());
    }

    /** /.well-known/pagesquire-keys.json: the JWK Set the card's jku names. */
    public function keys(LinkManager $manager): JsonResponse
    {
        return $this->published($manager->agentKeys());
    }

    /** @param array<string, mixed> $document */
    private function published(array $document): JsonResponse
    {
        return response()->json($document, 200, [], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)
            ->header('Cache-Control', 'public, max-age=300')
            ->header('Access-Control-Allow-Origin', '*')
            ->header('X-Content-Type-Options', 'nosniff');
    }
}
