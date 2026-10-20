<?php

namespace PageSquire\Laravel\Http\Controllers;

use Illuminate\Http\JsonResponse;
use PageSquire\Laravel\HandleChat;
use PageSquire\Laravel\Http\Requests\ChatRequest;
use PageSquire\Server\AssistantException;

final class ChatController
{
    public function __invoke(ChatRequest $request, HandleChat $chat): JsonResponse
    {
        try {
            return response()->json($chat->handle($request, $request->validated()))->header('Cache-Control', 'no-store');
        } catch (AssistantException $exception) {
            return response()->json(['error' => ['code' => $exception->errorCode, 'message' => $exception->getMessage()]], $exception->httpStatus)->header('Cache-Control', 'no-store');
        }
    }
}
