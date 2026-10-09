const tasks: Array<() => boolean> = [];
let scheduled = false;
let deadline = 0;
let activeTasks = 0;
let onIdle: (() => void) | null = null;

export function setStyleTasksCompleteHandler(callback: () => void): void {
    onIdle = callback;
}

export function hasPendingStyleTasks(): boolean {
    return activeTasks > 0;
}

function schedule() {
    if (scheduled) {
        return;
    }
    scheduled = true;
    const resume = () => {
        scheduled = false;
        deadline = performance.now() + 24;
        while (tasks.length > 0) {
            try {
                if (!tasks[0]()) {
                    break;
                }
            } catch (error) {
                tasks.shift();
                if (tasks.length > 0) {
                    schedule();
                }
                throw error;
            }
            tasks.shift();
        }
        if (tasks.length > 0) {
            schedule();
        }
    };
    const scheduler = (globalThis as typeof globalThis & {scheduler?: {yield(): Promise<void>}}).scheduler;
    if (scheduler?.yield) {
        void scheduler.yield().then(resume);
    } else {
        setTimeout(resume, 0);
    }
}

// Small styles finish synchronously. Large scans share a task budget so a
// page with many styles cannot spend a separate full budget on every sheet.
export function runStyleTask(iterator: Generator, isCancelled: () => boolean, onComplete?: (completed: boolean) => void): () => void {
    activeTasks++;
    let finished = false;
    const finish = (completed = false) => {
        if (!finished) {
            finished = true;
            iterator.return(undefined);
            try {
                onComplete?.(completed);
            } finally {
                activeTasks--;
            }
            if (activeTasks === 0) {
                onIdle?.();
            }
        }
    };
    const run = () => {
        if (finished || isCancelled()) {
            finish();
            return true;
        }
        for (let count = 0; ; count++) {
            if (count % 32 === 0 && performance.now() >= deadline) {
                return false;
            }
            try {
                if (iterator.next().done) {
                    finish(true);
                    return true;
                }
            } catch (error) {
                finish();
                throw error;
            }
        }
    };
    if (!scheduled && tasks.length === 0) {
        deadline = performance.now() + 24;
        // Reset the budget at the next task, including when all work completed.
        schedule();
    }
    if (tasks.length > 0 || !run()) {
        tasks.push(run);
        schedule();
    }
    return finish;
}
