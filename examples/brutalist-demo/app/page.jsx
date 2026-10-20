'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import LiveChat from './live-chat.jsx';
import { createOffbeatRuntime } from '../adapter.mjs';
import { art, styles, readingFonts, galleryView } from '../art.mjs';

const defaults = {
  color: '#171717',
  textColor: 'original',
  headingHighlight: false,
  highlight: false,
  weight: 400,
  size: 16,
  spacing: 1.6,
  font: 'sans',
};
const actions = [
  {
    label: 'Make headings red',
    id: 'accessibility.set_heading_color',
    args: { color: '#c52b28' },
    done: 'Headings are now red. Body text is unchanged.',
  },
  {
    label: 'Highlight links',
    id: 'accessibility.set_link_highlight',
    args: { enabled: true },
    done: 'Page links are highlighted and underlined.',
  },
  {
    label: 'Make text bold',
    id: 'accessibility.set_font_weight',
    args: { weight: 700 },
    done: 'Reading text is now bold.',
  },
  {
    label: 'Make text larger',
    id: 'accessibility.set_text_size',
    args: { size: 20 },
    done: 'Reading text is now 20 pixels.',
  },
  {
    label: 'Show 3D art',
    id: 'gallery.filter',
    args: { style: '3d' },
    done: 'The gallery now shows only 3D art.',
  },
  {
    label: 'Jump to the gallery',
    id: 'page.scroll_to',
    args: { section: 'gallery' },
    done: 'You are at the gallery.',
  },
];

function Arrow() {
  return <span aria-hidden="true">↗</span>;
}

function keepDialogFocus(event) {
  if (event.key !== 'Tab') return;
  const controls = [
    ...event.currentTarget.querySelectorAll(
      'button:not(:disabled), select:not(:disabled), a[href]',
    ),
  ].filter((element) => element.getClientRects().length);
  const first = controls[0];
  const last = controls.at(-1);
  if (
    (!event.shiftKey && document.activeElement === last) ||
    (event.shiftKey && document.activeElement === first)
  ) {
    event.preventDefault();
    (event.shiftKey ? last : first)?.focus();
  }
}

function Face({ emotion = 'idle', small = false }) {
  const mouths = {
    idle: 'M18 29h12',
    happy: 'M16 26q8 12 16 0',
    sad: 'M16 33q8-10 16 0',
    thinking: 'M22 29h9',
    confused: 'M17 30l5-3 5 4 5-2',
    hover: 'M17 27q7 8 14 0',
  };
  return (
    <svg
      className={`squire-face ${small ? 'small' : ''}`}
      data-emotion={emotion}
      viewBox="0 0 48 48"
      role="img"
      aria-label={`PageSquire: ${emotion}`}
    >
      <rect
        x="3"
        y="3"
        width="42"
        height="42"
        rx="11"
        fill="currentColor"
        stroke="#171717"
        strokeWidth="2.5"
      />
      <g stroke="#171717" strokeWidth="3" fill="none" strokeLinecap="round">
        <path
          d={
            emotion === 'thinking'
              ? 'M14 19l6 2m9-2 5-2'
              : emotion === 'sad'
                ? 'M14 19l6-2m9 0 5 2'
                : 'M16 17v5m16-5v5'
          }
        />
        <path d={mouths[emotion]} />
      </g>
    </svg>
  );
}

function Doodle() {
  return (
    <svg viewBox="0 0 300 300" className="doodle" aria-hidden="true">
      <path
        d="M86 208L61 261m142-53 30 52"
        stroke="#171717"
        strokeWidth="14"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M77 263H38m194 0h35"
        stroke="#171717"
        strokeWidth="16"
        strokeLinecap="round"
      />
      <path
        d="M72 124Q42 84 76 69l40 12q39-57 67-4 66-22 50 40 45 32 9 61 10 50-41 43-25 39-62 5-62 15-67-33-45-39 0-69Z"
        fill="#d9ff47"
        stroke="#171717"
        strokeWidth="6"
      />
      <ellipse
        cx="124"
        cy="129"
        rx="17"
        ry="25"
        fill="#f7f7f2"
        stroke="#171717"
        strokeWidth="4"
      />
      <ellipse
        cx="172"
        cy="129"
        rx="17"
        ry="25"
        fill="#f7f7f2"
        stroke="#171717"
        strokeWidth="4"
      />
      <ellipse cx="130" cy="137" rx="6" ry="11" fill="#171717" />
      <ellipse cx="178" cy="137" rx="6" ry="11" fill="#171717" />
      <path
        d="M112 173q36 40 77-6"
        stroke="#171717"
        strokeWidth="6"
        fill="none"
        strokeLinecap="round"
      />
      <path
        d="M65 151 23 129m218 19 35-30"
        stroke="#171717"
        strokeWidth="11"
        strokeLinecap="round"
      />
      <path
        d="M22 129l-3-24m4 24-17-14m270 3 8-21m-8 21 19-8"
        stroke="#171717"
        strokeWidth="5"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ArtVisual({ item }) {
  if (item.visual === 'creatures')
    return (
      <img
        src="/art/offbeat-creatures.png"
        width="1536"
        height="1024"
        alt="Original lime three-eyed creature, pink alien, and rubber-hose friends in a violet character world"
        loading="lazy"
      />
    );
  if (item.visual === 'poster')
    return (
      <div className="poster-visual" aria-hidden="true">
        <span className="poster-star">✳</span>
        <span>
          LESS
          <br />
          SCROLL.
          <br />
          <em>MORE SOUL.</em>
        </span>
        <span className="poster-note">
          YOUR BRAIN CALLED. IT WANTS A BREAK.
        </span>
      </div>
    );
  if (item.visual === 'doodle') return <Doodle />;
  return (
    <div className="type-visual" aria-hidden="true">
      <span>
        WORK
        <br />
        IN
        <br />
        <i>PLAY.</i>
      </span>
      <b>
        NOT EVERYTHING
        <br />
        NEEDS A REASON ↗
      </b>
    </div>
  );
}

export default function Page() {
  const [settings, setSettings] = useState(defaults);
  const [filter, setFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [order, setOrder] = useState('featured');
  const [selected, setSelected] = useState(null);
  const [assistantOpen, setAssistantOpen] = useState(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emotion, setEmotion] = useState('idle');
  const [feedback, setFeedback] = useState(null);
  const [runtimeFailed, setRuntimeFailed] = useState(false);
  const runtime = useRef(null);
  const busyRef = useRef(false);
  const detailDialog = useRef(null);
  const settingsDialog = useRef(null);
  const resetPage = useCallback((scope) => {
    setSettings(defaults);
    if (scope === 'all') {
      setFilter('all');
      setQuery('');
      setOrder('featured');
    }
  }, []);
  const handleChatState = useCallback((state) => {
    busyRef.current = state.busy;
    setBusy(state.busy);
    setEmotion(state.emotion);
  }, []);

  useEffect(() => {
    try {
      runtime.current = createOffbeatRuntime(
        document,
        (activity) => {
          if (activity === 'thinking') setEmotion('thinking');
        },
        resetPage,
      );
      setReady(true);
    } catch {
      setRuntimeFailed(true);
    }
    return () => runtime.current?.cancel();
  }, [resetPage]);

  async function runAction(action) {
    if (!runtime.current || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setEmotion('thinking');
    setFeedback({
      status: 'thinking',
      text: 'Checking the page and applying your action…',
    });
    try {
      const snapshot = runtime.current.observe();
      const result = await runtime.current.execute({
        protocolVersion: '0.1',
        callId: crypto.randomUUID(),
        snapshotId: snapshot.id,
        capabilityId: action.id,
        parameters: action.args,
      });
      const verified =
        result.status === 'success' && result.code === 'VERIFIED';
      setEmotion(verified ? 'happy' : 'confused');
      setFeedback({
        status: verified ? 'verified' : 'failed',
        text: verified
          ? action.done
          : 'This action could not be verified. Reset the page and try again.',
      });
    } catch {
      setEmotion('sad');
      setFeedback({
        status: 'failed',
        text: 'The action did not finish. Reset the page and try again.',
      });
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }

  function reset() {
    if (busyRef.current) return;
    resetPage('all');
    setFeedback(null);
    setEmotion('idle');
  }

  function openArt(item) {
    setSelected(item);
    detailDialog.current.showModal();
  }

  const galleryItems = galleryView(filter, query, order);
  const visibleCount = galleryItems.filter((item) => item.visible).length;
  const update = (key, value) =>
    setSettings((previous) => ({ ...previous, [key]: value }));

  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <div
        id="offbeat-page"
        className={`${settings.highlight ? 'links-highlighted' : ''} ${settings.headingHighlight ? 'headings-highlighted' : ''}`}
        style={{
          '--heading-color': settings.color,
          '--copy-weight': settings.weight,
          '--copy-size': `${settings.size}px`,
          '--copy-color':
            settings.textColor === 'original' ? undefined : settings.textColor,
          '--copy-spacing': settings.spacing,
          '--copy-font': readingFonts[settings.font],
        }}
      >
        <div className="issue-bar">
          <span>INDEPENDENT MINDS. LOUD IDEAS.</span>
          <span>
            AN INTERNET CULTURE PLAYGROUND <span aria-hidden="true">✳</span>
          </span>
        </div>
        <header className="site-header">
          <a href="#" className="wordmark" aria-label="OFFBEAT home">
            OFFBEAT<span aria-hidden="true">✳</span>
          </a>
          <nav aria-label="Main navigation">
            <a href="#gallery">The gallery</a>
            <a href="#culture">Culture notes</a>
            <a href="#playground">The playground</a>
          </nav>
          <button
            className="access-button"
            onClick={() => settingsDialog.current.showModal()}
            aria-label="Open accessibility settings"
          >
            <span aria-hidden="true">Aa</span>
            <span className="access-label">Make it yours</span>
            <Arrow />
          </button>
        </header>
        <main id="main">
          <section id="hero" className="hero" aria-labelledby="hero-title">
            <div className="hero-copy">
              <span className="eyebrow">
                <span className="live-dot" /> FOR THE CHRONICALLY CREATIVE
              </span>
              <h1 id="hero-title">
                WEIRD LOOKS
                <br />
                GOOD ON{' '}
                <span className="you">
                  YOU
                  <svg viewBox="0 0 290 30" aria-hidden="true">
                    <path d="M5 20Q140-7 284 14M15 27Q150 4 273 23" />
                  </svg>
                </span>
                .
              </h1>
              <p data-reading-copy>
                Your daily dose of art, characters, and ideas that don’t fit the
                algorithm. Less doomscroll. More good weird.
              </p>
              <div className="hero-actions">
                <a className="button button-ink" href="#gallery">
                  Find your kind of weird <Arrow />
                </a>
                <span className="hand-note">
                  a little off is
                  <br />a good place to be.
                </span>
              </div>
              <div className="hero-bottom">
                <span>ART WITHOUT THE ATTITUDE.</span>
                <a href="#playground">
                  KEEP EXPLORING <span aria-hidden="true">↓</span>
                </a>
              </div>
            </div>
            <div className="hero-art">
              <img
                src="/art/offbeat-creatures.png"
                width="1536"
                height="1024"
                alt="A joyful crew of original 3D and cartoon creatures: a lime three-eyed sneakerhead, pink alien, orange figure, and monochrome glove character"
                fetchPriority="high"
              />
              <div className="art-label">
                <span>MEET YOUR NEW INNER CIRCLE.</span>
                <span>ORIGINAL CHARACTER WORLD ↗</span>
              </div>
              <span className="sticker" aria-hidden="true">
                100%
                <br />
                ODD
                <br />
                <small>BY NATURE</small>
              </span>
              <span className="art-side-note" aria-hidden="true">
                NO NORMAL PEOPLE WERE HARMED.
              </span>
            </div>
          </section>
          <div
            className="culture-strip"
            aria-label="Character design, digital daydreams, internet culture, and good weird"
          >
            <span>
              CHARACTER DESIGN <b>✳</b> DIGITAL DAYDREAMS <b>✳</b> INTERNET
              CULTURE <b>✳</b> GOOD WEIRD <b>✳</b> ART THAT HITS DIFFERENT{' '}
              <b>✳</b>
            </span>
          </div>

          <section
            id="gallery"
            className="gallery-section"
            aria-labelledby="gallery-heading"
          >
            <div className="section-intro">
              <div>
                <span className="eyebrow">THE VISUAL RABBIT HOLE</span>
                <h2 id="gallery-heading">FEED YOUR EYEBALLS.</h2>
              </div>
              <p data-reading-copy>
                No perfect aesthetic required.
                <br />
                Just things that make your brain go <em>oh, nice.</em>
              </p>
            </div>
            <div className="filter-bar">
              <div
                className="filter-buttons"
                role="group"
                aria-label="Filter art styles"
              >
                {styles.map(([value, label]) => (
                  <button
                    key={value}
                    aria-pressed={filter === value}
                    onClick={() => setFilter(value)}
                  >
                    {label}
                    {filter === value && <span aria-hidden="true"> ↗</span>}
                  </button>
                ))}
              </div>
              <span className="art-count" aria-live="polite">
                {visibleCount} / {art.length} WORLDS
              </span>
            </div>
            <select
              id="art-style"
              tabIndex={-1}
              className="adapter-control"
              aria-label="Gallery style"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              data-pagesquire-ignore
            >
              {styles.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <div className="gallery-tools">
              <label htmlFor="art-query">
                Find your kind of weird
                <input
                  id="art-query"
                  type="search"
                  maxLength={80}
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="Search titles, styles, ideas…"
                />
              </label>
              <label htmlFor="art-order">
                Arrange the feed
                <select
                  id="art-order"
                  value={order}
                  onChange={(event) => setOrder(event.target.value)}
                >
                  <option value="featured">Featured order</option>
                  <option value="title-asc">Title A–Z</option>
                  <option value="title-desc">Title Z–A</option>
                </select>
              </label>
            </div>
            {visibleCount === 0 && (
              <p className="gallery-empty" role="status">
                No worlds match yet. Try another search or choose Everything.
              </p>
            )}
            <div className="art-grid">
              {galleryItems.map((item) => (
                <article
                  key={item.id}
                  data-art-card
                  data-art-style={item.style}
                  data-art-id={item.id}
                  hidden={!item.visible}
                  className={`art-card ${item.color}`}
                >
                  <button
                    className="art-open"
                    onClick={() => openArt(item)}
                    aria-label={`Explore ${item.title}`}
                  >
                    <div className={`art-visual ${item.visual}`}>
                      <ArtVisual item={item} />
                      <span className="explore-icon" aria-hidden="true">
                        ↗
                      </span>
                    </div>
                    <div className="art-caption">
                      <span className="eyebrow">{item.label}</span>
                      <h3>{item.title}</h3>
                    </div>
                  </button>
                </article>
              ))}
            </div>
            <div className="gallery-footnote">
              <span>ORIGINAL WORLDS. NO GATEKEEPING.</span>
              <span>CLICK A WORLD. STAY A WHILE. ↗</span>
            </div>
          </section>

          <section
            id="culture"
            className="culture-section"
            aria-labelledby="culture-heading"
          >
            <div className="culture-heading">
              <span className="eyebrow">
                FROM OUR LITTLE CORNER OF THE INTERNET
              </span>
              <h2 id="culture-heading">
                CURRENT
                <br />
                <span>OBSESSIONS.</span>
              </h2>
              <p data-reading-copy>
                Not trends to keep up with.
                <br />
                Little ideas worth slowing down for.
              </p>
              <span className="culture-spark" aria-hidden="true">
                ✳
              </span>
            </div>
            <div className="culture-notes">
              <article>
                <span className="eyebrow">ON / MAKING THINGS</span>
                <h3>
                  YOUR SIDE QUEST
                  <br />
                  IS THE MAIN EVENT.
                </h3>
                <p data-reading-copy>
                  The playlist cover you spent three hours on. The tiny doodle
                  with a whole backstory. Make the thing nobody asked for.
                  That’s usually the good stuff.
                </p>
                <a href="#gallery">
                  Enter the visual rabbit hole <Arrow />
                </a>
              </article>
              <article>
                <span className="eyebrow">ON / BEING ONLINE</span>
                <h3>
                  CURATE YOUR FEED.
                  <br />
                  KEEP YOUR WEIRD.
                </h3>
                <p data-reading-copy>
                  You don’t need a personal brand for every interest. Be into
                  clay monsters and pixel type and terrible puns. A personality
                  isn’t a mood board.
                </p>
                <a href="#playground">
                  Make this space your own <Arrow />
                </a>
              </article>
            </div>
          </section>

          <section
            id="playground"
            className="playground"
            aria-labelledby="playground-heading"
          >
            <div className="playground-copy">
              <span className="eyebrow">THIS PAGE HAS A LITTLE SIDEKICK</span>
              <h2 id="playground-heading">
                DON’T JUST SCROLL.
                <br />
                MESS WITH IT.
              </h2>
              <p data-reading-copy>
                Meet PageSquire. Try a guided action and watch this actual page
                change. Red headings? Bolder text? Your call.
              </p>
              <button
                className="button button-ink"
                onClick={() => setAssistantOpen(true)}
              >
                Try PageSquire <Arrow />
              </button>
              <span className="demo-disclosure">
                Guided actions are open. Live AI chat uses a private access
                code.
              </span>
            </div>
            <div className="playground-demo">
              <div className="mini-window-bar">
                <span className="window-dots" aria-hidden="true">
                  ● ● ●
                </span>
                <span>YOUR PAGE. YOUR RULES.</span>
                <span aria-hidden="true">↗</span>
              </div>
              <div className="mini-window-body">
                <Face emotion={emotion} />
                <span className="eyebrow">TAKE IT FOR A SPIN</span>
                <div className="sample-action-list">
                  {actions.slice(0, 3).map((action) => (
                    <button
                      key={action.id}
                      disabled={!ready || busy}
                      onClick={() => runAction(action)}
                    >
                      {action.label}
                      <Arrow />
                    </button>
                  ))}
                </div>
                <div className="inline-feedback" role="status">
                  {feedback ? (
                    <>
                      <span className={`status-dot ${feedback.status}`} />
                      {feedback.status === 'verified' ? 'Verified · ' : ''}
                      {feedback.text}
                    </>
                  ) : (
                    'Real actions. Checked against the rendered page.'
                  )}
                </div>
              </div>
            </div>
          </section>
          <section className="closing-note" aria-label="About OFFBEAT">
            <span aria-hidden="true">✳</span>
            <p>
              A LITTLE OFFBEAT.
              <br />
              <span>A LOT MORE YOU.</span>
            </p>
            <a
              href="#gallery"
              className="circle-link"
              aria-label="Back to the gallery"
            >
              ↗
            </a>
          </section>
        </main>
        <footer id="footer" className="site-footer">
          <a className="wordmark" href="#">
            OFFBEAT<span aria-hidden="true">✳</span>
          </a>
          <div>
            <span>AN ORIGINAL INTERNET-CULTURE DEMO.</span>
            <span>BUILT TO PLAY. NOT TO SELL YOU ANYTHING.</span>
          </div>
          <a
            href="https://github.com/naufaldenta/pagesquire"
            target="_blank"
            rel="noreferrer"
          >
            OPEN SOURCE WITH PAGESQUIRE <Arrow />
          </a>
        </footer>
      </div>

      <div className="assistant-dock" data-pagesquire-root="offbeat">
        {
          <aside
            hidden={!assistantOpen}
            className="assistant-panel"
            id="pagesquire-panel"
            aria-label="PageSquire guided actions"
          >
            <div className="assistant-top">
              <Face emotion={emotion} small />
              <div>
                <strong>PageSquire</strong>
                <span>YOUR LITTLE PAGE SIDEKICK</span>
              </div>
              <button
                aria-label="Close PageSquire"
                onClick={() => setAssistantOpen(false)}
              >
                ×
              </button>
            </div>
            <div className="assistant-content">
              <span className="locked-label">GUIDED ACTIONS + LIVE AI</span>
              <h2>Small actions. Real changes.</h2>
              <p>
                These buttons run registered, verified browser actions. They are
                not AI-generated responses.
              </p>
              <div className="guided-actions">
                {actions.map((action) => (
                  <button
                    key={action.id}
                    onClick={() => runAction(action)}
                    disabled={!ready || busy}
                  >
                    {action.label}
                    <Arrow />
                  </button>
                ))}
              </div>
              <div
                className="assistant-feedback"
                role="status"
                data-status={feedback?.status || 'idle'}
              >
                {runtimeFailed
                  ? 'The browser runtime could not start. Reload the page to try again.'
                  : feedback
                    ? `${feedback.status === 'verified' ? 'Verified · ' : ''}${feedback.text}`
                    : 'Choose an action. I’ll check that it actually worked.'}
              </div>
              <div className="reset-row">
                <span>EXPRESSION: {emotion.toUpperCase()}</span>
                <button onClick={reset} disabled={busy}>
                  Reset page
                </button>
              </div>
              <LiveChat
                runtime={ready ? runtime.current : null}
                onState={handleChatState}
                pageBusy={busy}
              />
              <details className="emotion-preview">
                <summary>Preview the six expressions</summary>
                <div>
                  {[
                    'idle',
                    'happy',
                    'sad',
                    'thinking',
                    'confused',
                    'hover',
                  ].map((value) => (
                    <button
                      key={value}
                      disabled={busy}
                      onClick={() => setEmotion(value)}
                      aria-label={`Preview ${value} expression`}
                    >
                      <Face emotion={value} small />
                      <span>{value}</span>
                    </button>
                  ))}
                </div>
                <p>Original CSS/SVG avatar; not a Rive asset.</p>
              </details>
            </div>
          </aside>
        }
        <button
          className={`assistant-launcher ${assistantOpen ? 'is-open' : ''}`}
          aria-label={assistantOpen ? 'Hide PageSquire' : 'Open PageSquire'}
          aria-expanded={assistantOpen}
          aria-controls="pagesquire-panel"
          onClick={() => setAssistantOpen((value) => !value)}
          onMouseEnter={() => {
            if (emotion === 'idle' && !busy) setEmotion('hover');
          }}
          onMouseLeave={() => {
            if (emotion === 'hover' && !busy) setEmotion('idle');
          }}
        >
          <Face emotion={emotion} small />
          <span>
            {assistantOpen ? 'Close sidekick' : 'Try PageSquire'}
            <small>{busy ? 'Thinking…' : 'GUIDED ACTIONS + PRIVATE AI'}</small>
          </span>
          <span aria-hidden="true">{assistantOpen ? '×' : '↗'}</span>
        </button>
      </div>

      <dialog
        ref={settingsDialog}
        onKeyDown={keepDialogFocus}
        className="settings-dialog"
        data-pagesquire-root="settings"
        aria-labelledby="settings-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <div className="dialog-top">
          <span className="eyebrow">YOUR PAGE. YOUR RULES.</span>
          <button
            aria-label="Close accessibility settings"
            onClick={() => settingsDialog.current.close()}
          >
            ×
          </button>
        </div>
        <h2 id="settings-title">Make it yours.</h2>
        <p>
          All of these controls are also registered PageSquire capabilities.
        </p>
        <label>
          Heading color
          <select
            id="heading-color"
            aria-label="Heading color"
            value={settings.color}
            onChange={(event) => update('color', event.target.value)}
          >
            <option value="#171717">Ink (original)</option>
            <option value="#c52b28">Red</option>
            <option value="#6440d5">Violet</option>
          </select>
        </label>
        <label>
          Reading text color
          <select
            id="text-color"
            aria-label="Reading text color"
            value={settings.textColor}
            onChange={(event) => update('textColor', event.target.value)}
          >
            <option value="original">Original section colors</option>
            <option value="#171717">Ink</option>
            <option value="#c52b28">Red</option>
            <option value="#6440d5">Violet</option>
          </select>
        </label>
        <label>
          Line spacing
          <select
            id="line-spacing"
            aria-label="Line spacing"
            value={settings.spacing}
            onChange={(event) => update('spacing', Number(event.target.value))}
          >
            <option value="1.6">Original (1.6)</option>
            <option value="1.8">Relaxed (1.8)</option>
            <option value="2">Double (2)</option>
          </select>
        </label>
        <label>
          Reading font
          <select
            id="reading-font"
            aria-label="Reading font"
            value={settings.font}
            onChange={(event) => update('font', event.target.value)}
          >
            <option value="sans">Sans — Arial</option>
            <option value="serif">Serif — Georgia</option>
            <option value="mono">Mono — Courier New</option>
          </select>
        </label>
        <label>
          Highlight headings
          <select
            id="heading-highlight"
            aria-label="Highlight headings"
            value={String(settings.headingHighlight)}
            onChange={(event) =>
              update('headingHighlight', event.target.value === 'true')
            }
          >
            <option value="false">Off</option>
            <option value="true">On — lime background</option>
          </select>
        </label>
        <label>
          Highlight links
          <select
            id="link-highlight"
            aria-label="Highlight links"
            value={String(settings.highlight)}
            onChange={(event) =>
              update('highlight', event.target.value === 'true')
            }
          >
            <option value="false">Off</option>
            <option value="true">On — lime and underline</option>
          </select>
        </label>
        <label>
          Reading text weight
          <select
            id="font-weight"
            aria-label="Reading text weight"
            value={settings.weight}
            onChange={(event) => update('weight', Number(event.target.value))}
          >
            <option value="400">Regular</option>
            <option value="700">Bold</option>
          </select>
        </label>
        <label>
          Reading text size
          <select
            id="text-size"
            aria-label="Reading text size"
            value={settings.size}
            onChange={(event) => update('size', Number(event.target.value))}
          >
            <option value="16">16 px (original)</option>
            <option value="18">18 px</option>
            <option value="20">20 px (larger)</option>
            <option value="24">24 px (largest)</option>
          </select>
        </label>
        <button className="button button-ink" onClick={reset} disabled={busy}>
          Reset page <span aria-hidden="true">↺</span>
        </button>
      </dialog>
      <dialog
        ref={detailDialog}
        onKeyDown={keepDialogFocus}
        className="art-dialog"
        aria-labelledby="art-detail-title"
        onClick={(event) => {
          if (event.target === event.currentTarget) event.currentTarget.close();
        }}
      >
        <button
          className="detail-close"
          aria-label="Close art details"
          onClick={() => detailDialog.current.close()}
        >
          ×
        </button>
        {selected && (
          <>
            <div className={`detail-visual art-visual ${selected.color}`}>
              <ArtVisual item={selected} />
            </div>
            <div className="detail-copy">
              <span className="eyebrow">{selected.label}</span>
              <h2 id="art-detail-title">{selected.title}</h2>
              <p>{selected.description}</p>
              <span className="eyebrow">
                ORIGINAL OFFBEAT DEMO ART · NOT FOR SALE
              </span>
            </div>
          </>
        )}
      </dialog>
    </>
  );
}
