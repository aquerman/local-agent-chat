/** An error whose message is written for the model: it is returned as the tool result as-is. */
export class DocumentsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DocumentsError';
  }
}
