export class WebSearchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebSearchError';
  }
}
