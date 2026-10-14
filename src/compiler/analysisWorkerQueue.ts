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
export function scheduleAnalysisWorker<T>(queueName: string, start: () => Promise<T>): Promise<T> {
  const queue = getQueue(queueName);
  return new Promise<T>((resolve, reject) => {
    queue.tasks.push({
      start: () => {
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
    });
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
