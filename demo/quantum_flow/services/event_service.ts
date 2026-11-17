/**
 * Synthetic Event Service
 */
export class EventService {
  public publishEvent(name: string, payload: unknown): { status: string; event: string } {
    return { status: "PUBLISHED", event: name };
  }
}
