// generated from the Modisign monorepo, do not edit
type Job = { controller: AbortController; waiters: number; settled: Promise<void> };

// Shared, waiter-counted, strictly serialized jobs: identical keys join one job, a job aborts when its last waiter leaves, and only one job works at a time (the segmenter takes one request at a time).
export function createPersonJobs(onChange: () => void) {
  const live = new Map<string, Job>();
  let tail: Promise<unknown> = Promise.resolve();

  function start(key: string, work: (signal: AbortSignal) => Promise<void>) {
    const controller = new AbortController();
    const previous = tail;
    const job: Job = { controller, waiters: 0, settled: Promise.resolve() };
    job.settled = (async () => {
      await previous;
      controller.signal.throwIfAborted();
      await work(controller.signal);
    })();
    tail = job.settled.catch(() => undefined);
    live.set(key, job);
    const end = () => { if (live.get(key) === job) live.delete(key); onChange(); };
    job.settled.then(end, end);
    onChange();
    return job;
  }

  return {
    busy: () => live.size > 0,
    run(key: string, work: (signal: AbortSignal) => Promise<void>, signal: AbortSignal) {
      if (signal.aborted) return Promise.reject(signal.reason);
      const job = live.get(key) ?? start(key, work);
      job.waiters++;
      const { promise, resolve, reject } = Promise.withResolvers<void>();
      let left = false;
      const leave = () => { if (left) return; left = true; signal.removeEventListener("abort", onAbort); job.waiters--; };
      const onAbort = () => {
        leave();
        if (job.waiters === 0) {
          if (live.get(key) === job) live.delete(key);
          job.controller.abort(signal.reason);
          onChange();
        }
        reject(signal.reason);
      };
      signal.addEventListener("abort", onAbort, { once: true });
      job.settled.then(() => { leave(); resolve(); }, (error) => { leave(); reject(error); });
      return promise;
    },
    abortAll(reason: unknown) {
      for (const job of live.values()) job.controller.abort(reason);
      live.clear();
      onChange();
    },
  };
}
