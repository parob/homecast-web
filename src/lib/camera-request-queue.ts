/** One camera capture at a time per home in this page; opened viewers go first. */
interface Job { priority: number; run: () => Promise<void> }
const queues = new Map<string, Job[]>();

export function queueCameraRequest<T>(homeId: string | undefined, priority: number, run: () => Promise<T>): Promise<T> {
  const home = homeId ?? '';
  return new Promise<T>((resolve, reject) => {
    const job: Job = { priority, run: async () => {
      try { resolve(await run()); } catch (error) { reject(error); }
    } };
    const existing = queues.get(home);
    if (existing) { existing.push(job); return; }
    const pending: Job[] = [];
    queues.set(home, pending);
    void (async () => {
      let next: Job | undefined = job;
      while (next) {
        await next.run();
        pending.sort((a, b) => b.priority - a.priority);
        next = pending.shift();
      }
      queues.delete(home);
    })();
  });
}
