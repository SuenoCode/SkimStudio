export class History {
  constructor(limit = 40) { this.limit = limit; this.past = []; this.future = []; }
  push(state) { this.past.push(structuredClone(state)); if (this.past.length > this.limit) this.past.shift(); this.future = []; }
  undo(current) { if (!this.past.length) return null; this.future.push(structuredClone(current)); return this.past.pop(); }
  redo(current) { if (!this.future.length) return null; this.past.push(structuredClone(current)); return this.future.pop(); }
}
