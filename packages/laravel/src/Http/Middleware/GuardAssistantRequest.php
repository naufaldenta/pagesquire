<?php

namespace PageSquire\Laravel\Http\Middleware;

use Closure;
use Illuminate\Http\Exceptions\HttpResponseException;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

final class GuardAssistantRequest
{
    /**
     * Handle an incoming request.
     *
     * @param  Closure(Request): (Response)  $next
     */
    public function handle(Request $request, Closure $next): Response
    {
        if (config('session.driver') === 'cookie') {
            return response()->json(['error' => ['code' => 'UNSUPPORTED_SESSION_DRIVER', 'message' => 'The assistant requires server-side session storage.']], 503)->header('Cache-Control', 'no-store');
        }

        if (! $request->isJson() || strlen($request->getContent()) > (int) config('pagesquire.limits.max_body_bytes')) {
            return response()->json(['error' => ['code' => 'INVALID_REQUEST', 'message' => 'Send a bounded JSON assistant request.']], 413)->header('Cache-Control', 'no-store');
        }

        $store = config('pagesquire.cache_store') ?? config('cache.default');
        $driver = config('cache.stores.'.$store.'.driver');

        if (in_array($driver, ['session', 'null'], true) || ($driver === 'array' && ! app()->runningUnitTests())) {
            return response()->json(['error' => ['code' => 'UNSUPPORTED_CACHE_DRIVER', 'message' => 'The assistant requires a durable server-side cache.']], 503)->header('Cache-Control', 'no-store');
        }

        try {
            return $next($request)->header('Cache-Control', 'no-store');
        } catch (HttpResponseException $exception) {
            return $exception->getResponse();
        } catch (Throwable) {
            return response()->json(['error' => ['code' => 'ASSISTANT_UNAVAILABLE', 'message' => 'The assistant is unavailable.']], 503)->header('Cache-Control', 'no-store');
        }
    }
}
