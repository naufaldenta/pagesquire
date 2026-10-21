import { PageSquireError } from '@pagesquire/core';

/** Opt-in final-answer speech. No microphone, provider key or cloud TTS client. */
export class SpeechOutput {
  private enabled = false;
  private utterance: SpeechSynthesisUtterance | undefined;
  private finish: ((success: boolean) => void) | undefined;
  private disposed = false;

  constructor(
    private readonly options: {
      window: Window & typeof globalThis;
      lang?: string;
      localOnly?: boolean;
      timeoutMs?: number;
    },
  ) {
    if (
      options.lang !== undefined &&
      !/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/.test(options.lang)
    )
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Choose a valid speech language tag.',
      );
    const timeout = options.timeoutMs ?? 60000;
    if (!Number.isInteger(timeout) || timeout < 1 || timeout > 120000)
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Speech timeout must be bounded.',
      );
  }

  setEnabled(enabled: boolean): void {
    if (this.disposed)
      throw new PageSquireError('CANCELLED', 'Speech output was disposed.');
    if (typeof enabled !== 'boolean')
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Speech must be explicitly enabled or disabled.',
      );
    this.enabled = enabled;
    if (!enabled) this.cancel();
  }

  async speak(text: string, signal?: AbortSignal): Promise<boolean> {
    if (typeof text !== 'string' || !text.trim() || text.length > 4000)
      throw new PageSquireError(
        'INVALID_OPTIONS',
        'Speak a nonempty final answer of at most 4,000 characters.',
      );
    const view = this.options.window;
    if (
      !this.enabled ||
      this.disposed ||
      signal?.aborted ||
      !view.speechSynthesis ||
      !view.SpeechSynthesisUtterance
    )
      return false;
    if (view.speechSynthesis.speaking && !this.utterance) return false;
    this.cancel();
    const lang = this.options.lang ?? 'en';
    let utterance: SpeechSynthesisUtterance;
    try {
      const voice = view.speechSynthesis
        .getVoices()
        .find(
          (candidate) =>
            (this.options.localOnly === false || candidate.localService) &&
            candidate.lang.toLowerCase().split('-')[0] ===
              lang.toLowerCase().split('-')[0],
        );
      if (!voice && this.options.localOnly !== false) return false;
      utterance = new view.SpeechSynthesisUtterance(text);
      if (voice) utterance.voice = voice;
      utterance.lang = lang;
    } catch {
      return false;
    }
    this.utterance = utterance;
    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (success: boolean) => {
        if (settled) return;
        settled = true;
        view.clearTimeout(timer);
        signal?.removeEventListener('abort', abort);
        utterance.onend = null;
        utterance.onerror = null;
        this.utterance = undefined;
        this.finish = undefined;
        resolve(success);
      };
      const abort = () => this.cancel();
      const timer = view.setTimeout(abort, this.options.timeoutMs ?? 60000);
      this.finish = finish;
      utterance.onend = () => finish(true);
      utterance.onerror = () => finish(false);
      signal?.addEventListener('abort', abort, { once: true });
      try {
        view.speechSynthesis.speak(utterance);
      } catch {
        this.cancel();
      }
      if (signal?.aborted) abort();
    });
  }

  cancel(): void {
    if (this.utterance) {
      this.finish?.(false);
      try {
        this.options.window.speechSynthesis.cancel();
      } catch {
        /* Optional audio never affects actions. */
      }
    }
  }
  dispose(): void {
    this.disposed = true;
    this.enabled = false;
    this.cancel();
  }
}
