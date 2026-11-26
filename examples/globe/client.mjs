export class GlobeWorkerClient {
  constructor(worker) {
    this.worker = worker;
    this.id = 0;
    this.pending = new Map();
    this.closed = false;
    this.message = ({ data }) => {
      const p = this.pending.get(data.id);
      if (!p) return;
      this.pending.delete(data.id);
      if (data.error) p.reject(new Error(data.error));
      else p.resolve(data);
    };
    this.error = (e) => {
      this.dispose(new Error(e.message || "Globe worker failed"));
    };
    worker.addEventListener("message", this.message);
    worker.addEventListener("error", this.error);
  }
  send(type, data) {
    if (this.closed) return Promise.reject(new Error("Worker closed"));
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.worker.postMessage({ id, type, ...data });
      } catch (e) {
        this.pending.delete(id);
        reject(e);
      }
    });
  }
  init(source) {
    return this.send("init", { source });
  }
  async query(level) {
    return (await this.send("query", { level })).frame;
  }
  dispose(error = new DOMException("Cancelled", "AbortError")) {
    if (this.closed) return;
    this.closed = true;
    this.worker.removeEventListener("message", this.message);
    this.worker.removeEventListener("error", this.error);
    for (const p of this.pending.values()) p.reject(error);
    this.pending.clear();
    this.worker.terminate();
  }
}
