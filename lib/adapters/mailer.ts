export interface OutboxMessage { to: string; subject: string; body: string }

/** v1 swaps in SMTPMailer implementing this same interface (spec rule #3). */
export interface Mailer {
  send(msg: OutboxMessage): Promise<{ delivered: boolean; sent_at: string }>;
}

export class SimulatedMailer implements Mailer {
  async send(_msg: OutboxMessage): Promise<{ delivered: boolean; sent_at: string }> {
    return { delivered: true, sent_at: new Date().toISOString() };
  }
}

export function getMailer(): Mailer {
  return new SimulatedMailer();
}
