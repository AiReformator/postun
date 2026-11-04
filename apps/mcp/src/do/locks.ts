import { PostunError } from '@postun/contracts';

/** FIFO mutex per key with a bounded wait. Serialises operations on one Telegram account (MT-02). */
export class KeyedLocks {
  private readonly tails = new Map<string, Promise<void>>();

  async acquire(key: string, timeoutMs: number): Promise<() => void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    let release!: () => void;
    const mine = new Promise<void>((r) => {
      release = r;
    });
    const tail = prev.then(() => mine);
    this.tails.set(key, tail);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<false>((r) => {
      timer = setTimeout(() => r(false), timeoutMs);
    });
    const got = await Promise.race([prev.then(() => true as const), timeout]);
    clearTimeout(timer);
    let released = false;
    const done = () => {
      if (released) return;
      released = true;
      release();
      void tail.then(() => {
        if (this.tails.get(key) === tail) this.tails.delete(key);
      });
    };
    if (!got) {
      void prev.then(done);
      throw new PostunError('CONFLICT');
    }
    return done;
  }

  isBusy(key: string): boolean {
    return this.tails.has(key);
  }
}
