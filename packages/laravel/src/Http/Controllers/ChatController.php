<?php

namespace PageSquire\Laravel\Http\Controllers;

use Illuminate\Http\JsonResponse;
use PageSquire\Laravel\HandleChat;
use PageSquire\Laravel\Http\Requests\ChatRequest;
use PageSquire\Server\AssistantException;
use Symfony\Component\HttpFoundation\StreamedResponse;

final class ChatController
{
    public function __invoke(ChatRequest $request, HandleChat $chat): JsonResponse|StreamedResponse
    {
        // Origin, CSRF, authorization, throttling and payload checks already ran
        // in middleware and the form request, so a stream starts only after them.
        if (str_contains(strtolower((string) $request->header('Accept')), 'application/x-ndjson')) {
            return $this->stream($request, $chat);
        }
        try {
            return response()->json($chat->handle($request, $request->payload()))->header('Cache-Control', 'no-store');
        } catch (AssistantException $exception) {
            return response()->json(['error' => ['code' => $exception->errorCode, 'message' => $exception->getMessage()]], $exception->httpStatus)->header('Cache-Control', 'no-store');
        }
    }

    /** Fixed progress stages, then exactly one reply or error line; never model text before validation. */
    private function stream(ChatRequest $request, HandleChat $chat): StreamedResponse
    {
        $payload = $request->payload();

        return response()->stream(static function () use ($request, $chat, $payload): void {
            $emit = static function (array $event): void {
                echo json_encode($event, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE)."\n";
                if (ob_get_level() > 0) {
                    ob_flush();
                }
                flush();
            };
            try {
                $reply = $chat->handle($request, $payload, static fn (string $stage) => $emit(['type' => 'progress', 'stage' => $stage]));
                $emit(['type' => 'reply', 'reply' => $reply]);
            } catch (AssistantException $exception) {
                $emit(['type' => 'error', 'status' => $exception->httpStatus, 'error' => ['code' => $exception->errorCode, 'message' => $exception->getMessage()]]);
            }
        }, 200, [
            'Content-Type' => 'application/x-ndjson; charset=utf-8',
            'Cache-Control' => 'no-store',
            'X-Content-Type-Options' => 'nosniff',
            'X-Accel-Buffering' => 'no',
        ]);
    }
}
