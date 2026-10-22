import { randomUUID } from "node:crypto";
import { errorResult, ToolError } from "./errors.js";
import { render, validateRender, type Artifact, type RenderInput, type Update } from "./render.js";
import { renderStudio, validateStudio, type StudioInput } from "./studio.js";

export type JobState = "queued" | "downloading_browser" | "rendering" | "compositing" | "preparing_people_model" | "preparing_people_masks" | "done" | "failed" | "canceled";
type Snapshot = { job_id: string; state: JobState; progress: number; aspect?: string; artifact?: Artifact; warnings?: string[]; error?: Record<string, unknown> };
type JobInput = RenderInput | StudioInput;
const isStudio = (input: JobInput): input is StudioInput => "kind" in input && input.kind === "studio";
type Job = { snapshot: Snapshot; input: JobInput; controller: AbortController; notify?: (snapshot: Snapshot) => Promise<void> };
const terminal = (state: JobState) => ["done", "failed", "canceled"].includes(state);
export class Jobs {
  private jobs = new Map<string, Job>();
  private queue: Job[] = [];
  private active = false;
  private closed = false;
  private draining: Promise<void> = Promise.resolve();
  async start(input: JobInput, notify?: Job["notify"], signal?: AbortSignal) {
    this.checkQueue();
    const validated = isStudio(input) ? { input: (await validateStudio(input, signal)).input, aspect: input.aspect } : await validateRender(input, signal);
    this.checkQueue();
    if (this.jobs.size >= 100) {
      for (const [id, job] of this.jobs) { if (terminal(job.snapshot.state)) { this.jobs.delete(id); break; } }
    }
    signal?.throwIfAborted();
    const job: Job = { snapshot: { job_id: randomUUID(), state: "queued", progress: 0, ...(validated.aspect === undefined ? {} : { aspect: validated.aspect }) }, input: "input" in validated ? validated.input : { ...input as RenderInput, configuration: validated.configuration }, controller: new AbortController(), notify };
    this.jobs.set(job.snapshot.job_id, job); this.queue.push(job);
    setImmediate(() => { if (!this.active) this.draining = this.drain(); });
    return { ...job.snapshot };
  }
  status(id: string) { return { ...this.find(id).snapshot }; }
  cancel(id: string) {
    const job = this.find(id);
    if (!terminal(job.snapshot.state)) {
      job.controller.abort();
      if (job.snapshot.state === "queued") { job.snapshot.state = "canceled"; this.notify(job); }
    }
    return this.status(id);
  }
  async close() { this.closed = true; for (const job of this.jobs.values()) job.controller.abort(); await this.draining; }
  private checkQueue() {
    if (this.closed) throw new ToolError("The local render server is shutting down.");
    if (this.queue.length >= 50) throw new ToolError("Render queue is full. Wait for a job to finish.");
  }
  private find(id: string) {
    const job = this.jobs.get(id);
    if (job === undefined) throw new ToolError("Unknown job_id. Jobs exist only in this server process.");
    return job;
  }
  private notify(job: Job) { if (job.notify !== undefined) void job.notify({ ...job.snapshot }).catch(() => {}); }
  private async drain() {
    this.active = true;
    try {
      while (this.queue.length > 0) {
        const job = this.queue.shift();
        if (job === undefined) throw new Error("Queue unexpectedly empty");
        if (job.controller.signal.aborted) { job.snapshot.state = "canceled"; this.notify(job); continue; }
        try {
          const update: Update = (state, progress) => {
            if (progress < job.snapshot.progress) return;
            job.snapshot.state = state; job.snapshot.progress = progress; this.notify(job);
          };
          const result = isStudio(job.input) ? await renderStudio(job.input, job.controller.signal, update) : await render(job.input, job.controller.signal, update);
          Object.assign(job.snapshot, { state: "done", progress: 1, ...result });
        } catch (error) {
          job.snapshot.state = job.controller.signal.aborted ? "canceled" : "failed";
          if (job.snapshot.state === "failed") job.snapshot.error = errorResult(error);
        }
        this.notify(job);
      }
    } finally { this.active = false; }
  }
}
