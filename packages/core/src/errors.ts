export class PageSquireError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'PageSquireError';
  }
}

export class NavigationStarted extends PageSquireError {
  constructor(public readonly url: string) {
    super('NAVIGATION_PENDING', 'Waiting for the destination document.');
  }
}
