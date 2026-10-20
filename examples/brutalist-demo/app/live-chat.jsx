'use client';

import { useEffect, useRef, useState } from 'react';
import {
  AssistantClient,
  createHttpTransport,
} from '../../../packages/client/dist/index.js';

export default function LiveChat({ runtime, onState, pageBusy }) {
  const [session, setSession] = useState({
    status: 'checking',
    authenticated: false,
    csrfToken: '',
  });
  const [code, setCode] = useState('');
  const [input, setInput] = useState('');
  const [notice, setNotice] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [chat, setChat] = useState({
    busy: false,
    messages: [],
    emotion: 'idle',
  });
  const client = useRef(null);
  const log = useRef(null);
  const expired = useRef(false);
  const sending = useRef(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch('/api/session', {
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw Error('unavailable');
        const result = await response.json();
        if (result.available !== true) throw Error('unavailable');
        if (!controller.signal.aborted)
          setSession({
            status: 'available',
            authenticated: result.authenticated === true,
            csrfToken: result.csrfToken ?? '',
          });
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setSession({
            status: 'unavailable',
            authenticated: false,
            csrfToken: '',
          });
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!runtime || !session.authenticated || !session.csrfToken) return;
    const transport = createHttpTransport({
      endpoint: '/api/chat',
      baseUrl: window.location.href,
      csrfToken: () => session.csrfToken,
    });
    const instance = new AssistantClient({
      runtime,
      transport: async (...args) => {
        try {
          return await transport(...args);
        } catch (error) {
          if (['ACCESS_DENIED', 'HTTP_419'].includes(error.code))
            expired.current = true;
          throw error;
        }
      },
      maxRounds: 10,
      timeoutMs: 120000,
    });
    client.current = instance;
    const unsubscribe = instance.subscribe((state) => {
      setChat(state);
      onState(state);
      if (!state.busy && expired.current) {
        expired.current = false;
        setSession({
          status: 'available',
          authenticated: false,
          csrfToken: '',
        });
        setNotice(
          'Your session expired or access changed. Unlock the demo again to continue.',
        );
      }
    });
    return () => {
      unsubscribe();
      instance.cancel();
      client.current = null;
    };
  }, [runtime, session.authenticated, session.csrfToken, onState]);

  useEffect(() => {
    if (log.current) log.current.scrollTop = log.current.scrollHeight;
  }, [chat.messages.length]);

  async function unlock(event) {
    event.preventDefault();
    if (authBusy || pageBusy) return;
    setAuthBusy(true);
    setNotice('');
    try {
      const response = await fetch('/api/session', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        redirect: 'error',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accessCode: code }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        setNotice(
          response.status === 403
            ? 'The access code is incorrect.'
            : response.status === 429
              ? 'Too many attempts. Try again later.'
              : 'The assistant is unavailable. Try again later.',
        );
        return;
      }
      const result = await response.json();
      if (!result.authenticated || typeof result.csrfToken !== 'string')
        throw Error('invalid');
      setCode('');
      setSession({
        status: 'available',
        authenticated: true,
        csrfToken: result.csrfToken,
      });
    } catch {
      setNotice('The assistant could not be reached. Try again.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function send(event) {
    event.preventDefault();
    if (!client.current || pageBusy || sending.current || !input.trim()) return;
    sending.current = true;
    const message = input;
    setInput('');
    setNotice('');
    try {
      await client.current.send(message);
    } catch {
      setNotice(
        'The message could not start. Try again when the page is ready.',
      );
    } finally {
      sending.current = false;
    }
  }

  async function logout() {
    if (pageBusy || authBusy) return;
    setAuthBusy(true);
    try {
      const response = await fetch('/api/session', {
        method: 'DELETE',
        credentials: 'same-origin',
        redirect: 'error',
        headers: {
          'Content-Type': 'application/json',
          'X-CSRF-TOKEN': session.csrfToken,
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!response.ok) throw Error('unavailable');
      client.current?.reset();
      setSession({ status: 'available', authenticated: false, csrfToken: '' });
      setChat({ busy: false, messages: [], emotion: 'idle' });
      setNotice('');
    } catch {
      setNotice('Sign out failed. Reload the page and try signing out again.');
    } finally {
      setAuthBusy(false);
    }
  }

  return (
    <section className="live-chat" aria-label="Live AI chat">
      <div className="chat-title">
        <strong>AI chat</strong>
        <span className="chat-badge">
          {session.authenticated
            ? 'LIVE · PRIVATE DEMO'
            : session.status === 'unavailable'
              ? 'TEMPORARILY UNAVAILABLE'
              : 'ACCESS CODE REQUIRED'}
        </span>
      </div>
      {session.status === 'checking' && (
        <p role="status">Checking the assistant…</p>
      )}
      {session.status === 'unavailable' && (
        <p role="status">
          Live chat is unavailable. Guided actions still work. Reload to check
          again.
        </p>
      )}
      {session.status === 'available' && !session.authenticated && (
        <form onSubmit={unlock} className="unlock-form">
          <label htmlFor="demo-access-code">Demo access code</label>
          <div className="chat-input-row">
            <input
              id="demo-access-code"
              type="password"
              autoComplete="off"
              value={code}
              onChange={(event) => setCode(event.target.value)}
              maxLength={256}
              required
              disabled={authBusy || pageBusy}
            />
            <button disabled={authBusy || pageBusy || !code.trim()}>
              {authBusy ? 'Checking…' : 'Unlock AI'}
            </button>
          </div>
          <p>
            The private code protects the demo’s usage budget. Never enter a
            provider API key here.
          </p>
        </form>
      )}
      {session.authenticated && (
        <>
          <div
            ref={log}
            className="chat-messages"
            role="log"
            aria-label="Conversation"
            aria-live="polite"
          >
            {chat.messages.length === 0 ? (
              <p className="chat-empty">
                Ask about this page, or try “Make headings red and highlight
                links.”
              </p>
            ) : (
              chat.messages.map((message, index) => (
                <div key={index} className={`chat-message ${message.role}`}>
                  <span className="chat-message-label">
                    {message.role === 'user'
                      ? 'YOU'
                      : message.role === 'action'
                        ? 'BROWSER RESULT'
                        : 'PAGESQUIRE'}
                    {message.emotion && ` · ${message.emotion.toUpperCase()}`}
                  </span>
                  <p>{message.text}</p>
                </div>
              ))
            )}
          </div>
          <form onSubmit={send} className="chat-send-form">
            <label htmlFor="chat-message">Message PageSquire</label>
            <div className="chat-input-row">
              <textarea
                id="chat-message"
                rows={2}
                maxLength={4000}
                value={input}
                onChange={(event) => setInput(event.target.value)}
                disabled={pageBusy || !runtime}
                placeholder="Ask, explore, or change this page…"
              />
              <button disabled={pageBusy || !runtime || !input.trim()}>
                Send
              </button>
            </div>
          </form>
          <div className="chat-controls">
            {chat.busy && (
              <button onClick={() => client.current?.cancel()}>Stop</button>
            )}
            <button disabled={pageBusy} onClick={() => client.current?.reset()}>
              New conversation
            </button>
            <button disabled={pageBusy || authBusy} onClick={logout}>
              Sign out
            </button>
          </div>
          <details className="chat-prompts">
            <summary>Explore more page actions</summary>
            {[
              'Make body text violet.',
              'Use double line spacing.',
              'Use a serif reading font.',
              'Search art for brain',
              'Sort art Z to A.',
              'Reset all page changes.',
            ].map((prompt) => (
              <button
                key={prompt}
                disabled={pageBusy}
                onClick={() => setInput(prompt)}
              >
                {prompt}
              </button>
            ))}
          </details>
          <p className="privacy-note">
            Chat is stored privately for a short time to process actions and
            enforce usage limits. Page actions are verified locally. Don’t share
            personal or sensitive information.
          </p>
        </>
      )}
      {notice && (
        <p role="alert" className="chat-notice">
          {notice}
        </p>
      )}
    </section>
  );
}
