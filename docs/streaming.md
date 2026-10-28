# Streamed server progress

A chat request can take several seconds while the provider thinks. While that happens, PageSquire can stream **fixed server stages** to the browser so visitors see what the server is doing.

Model text is never streamed. The reply arrives only after the server has fully validated it, exactly as in the non-streamed response.

## Wire format

The client asks for it with `Accept: application/x-ndjson, application/json;q=0.9`. A server that supports streaming answers `200` with `Content-Type: application/x-ndjson` and one JSON object per line:

```text
{"type":"progress","stage":"accepted"}
{"type":"progress","stage":"thinking"}
{"type":"reply","reply":{ ...ChatReply... }}
```

- **`progress` stages are a fixed set:**
  - `accepted`: the request passed origin, CSRF, authorization and payload checks.
  - `thinking`: a provider call started.
  - `reviewing`: the completion validator or the action check is running.
  - `replaying`: a cached trajectory step is being replayed.

  Node repeats the current stage every 10 seconds as a keep-alive.

- **The last line** is either `reply` or `error` (`{"type":"error","status":429,"error":{"code":"…","message":"…"}}`).
- **No streaming before a request is accepted.** Requests that fail before acceptance (wrong origin, missing CSRF, denied, malformed, busy) are not streamed. They get the usual JSON error with its HTTP status.
- **Older and other servers.** Servers that do not stream (WordPress today, or older versions) answer with plain JSON. The client handles that unchanged, so streaming is backward compatible.

The format types are exported from `@pagesquire/protocol`: `SERVER_PROGRESS_STAGES`, `ServerProgressStage`, `ChatStreamEvent` and `CHAT_STREAM_TYPE`.

## Client

`createHttpTransport` asks for streaming by default, and `stream: false` turns it off. The client handles a streamed response like this:

- **Reading.** It reads lines as they arrive, up to 256 KiB in total.
- **Stages.** Only known stages are passed on; unknown line types are ignored for forward compatibility.
- **Errors.** Error lines use the same allowlisted codes and localized messages as HTTP errors, so server text is never shown verbatim.
- **Fails closed.** A stream that ends without a reply, or contains malformed JSON, fails with `INVALID_RESPONSE`.

`AssistantClient` exposes the current stage as `state.serverStage` and records `server` trace events. The widget shows the stage as its status, for example "The assistant is thinking…" or in Indonesian "Asisten sedang berpikir…". Custom transports receive an optional third argument, `onProgress(stage)`.

## Servers

- **Node (`createChatHandler`).** Streams automatically when asked; Next.js Route Handlers pass the stream through. The handler sends `X-Accel-Buffering: no` for nginx; check other proxies and CDNs do not buffer `application/x-ndjson`.
- **Native PHP (`ChatEndpoint::serve`).** Streams when asked, flushing after each line. Disable output buffering and compression for the route (for example `zlib.output_compression=Off` and no proxy buffering). PHP cannot send keep-alives while a provider call blocks, so keep idle proxy timeouts above the provider timeout.

  `ChatEndpoint::stream($method, $headers, $body, $session, $emit)` writes lines through your own callback. It returns the ordinary response when the request failed before acceptance.

- **Engines.** `ConversationEngine::handle` takes an optional `onProgress` callback in both Node and PHP. Callback errors are ignored. In Node, the callback is passed per call, so concurrent requests never share one.
- **Laravel.** The chat route streams when asked. Middleware and the form request check origin, CSRF, authorization, throttling and the payload first, and those failures stay JSON. A conversation that is no longer found arrives as an `error` line. Disable output buffering for the route as for native PHP.
- **WordPress.** The REST route still answers with JSON.
