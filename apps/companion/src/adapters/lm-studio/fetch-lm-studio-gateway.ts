import type { LmStudioGateway } from '../../modules/narration/narration-service.js';

function endpoint(baseUrl: string, path: string): string {
  return new URL(path.replace(/^\//u, ''), `${baseUrl.replace(/\/$/u, '')}/`).href;
}

export class FetchLmStudioGateway implements LmStudioGateway {
  readonly #chatUrl: string;
  readonly #modelsUrl: string;

  constructor(baseUrl: string) {
    this.#chatUrl = endpoint(baseUrl, 'chat/completions');
    this.#modelsUrl = endpoint(baseUrl, 'models');
  }

  chat(request: Readonly<Record<string, unknown>>, signal: AbortSignal): Promise<Response> {
    return fetch(this.#chatUrl, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(request),
      signal,
    });
  }

  models(signal: AbortSignal): Promise<Response> {
    return fetch(this.#modelsUrl, { method: 'GET', signal });
  }
}
