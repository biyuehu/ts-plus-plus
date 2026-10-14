import {
  CancellationToken,
  OperationCanceledException,
} from "./types.js";

/** A shared bounded scheduler for compiler analysis workers. */

interface QueuedAnalysisWorkerTask {
  start(): void;
}

interface AnalysisWorkerQueue {
  readonly tasks: QueuedAnalysisWorkerTask[];
  activeCount: number;
  maximumCount: number | undefined;
}

const queues = new Map<string, AnalysisWorkerQueue>();

/** @internal */
export function scheduleAnalysisWorker<T>(queueName: string, start: () => Promise<T>, cancellationToken?: CancellationToken): Promise<T> {
  const queue = getQueue(queueName);
  return new Promise<T>((resolve, reject) => {
    cancellationToken?.throwIfCancellationRequested();
    let cancellationPoll: ReturnType<typeof setInterval> | undefined;
    const task: QueuedAnalysisWorkerTask = {
      start: () => {
        if (cancellationPoll) globalThis.clearInterval(cancellationPoll);
        try {
          cancellationToken?.throwIfCancellationRequested();
        }
        catch (error) {
          reject(error);
          return;
        }
        queue.activeCount++;
        let result: Promise<T>;
        try {
          result = start();
        }
        catch (error) {
          result = Promise.reject(error);
        }
        void result.then(resolve, reject).finally(() => {
          queue.activeCount--;
          drainQueue(queue);
        });
      },
    };
    queue.tasks.push(task);
    if (cancellationToken) {
      cancellationPoll = globalThis.setInterval(() => {
        if (!cancellationToken.isCancellationRequested()) return;
        const index = queue.tasks.indexOf(task);
        if (index < 0) return;
        queue.tasks.splice(index, 1);
        globalThis.clearInterval(cancellationPoll);
        reject(new OperationCanceledException());
      }, 25);
    }
    drainQueue(queue);
  });
}

function getQueue(name: string): AnalysisWorkerQueue {
  let queue = queues.get(name);
  if (!queue) {
    queue = { tasks: [], activeCount: 0, maximumCount: undefined };
    queues.set(name, queue);
  }
  return queue;
}

function drainQueue(queue: AnalysisWorkerQueue): void {
  queue.maximumCount ??= getDefaultMaximumWorkerCount();
  while (queue.activeCount < queue.maximumCount) {
    const task = queue.tasks.shift();
    if (!task) return;
    task.start();
  }
}

function getDefaultMaximumWorkerCount(): number {
  if (typeof require !== "function") return 1;
  const os = require("node:os") as typeof import("node:os");
  const availableParallelism = os.availableParallelism?.() ?? os.cpus().length;
  return Math.max(1, Math.min(4, availableParallelism));
}
