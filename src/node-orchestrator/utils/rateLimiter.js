/**
 * AEO Citation Graph Simulator - Rate Limiter
 * Enforces per-provider RPM and TPM limits with a fair FIFO queue.
 * TPM is enforced using actual usage metadata reported by providers.
 */

export class RateLimiter {
  constructor(limits) {
    this.rpm = (limits && limits.rpm) || 60;
    this.tpm = (limits && limits.tpm) || 100000;
    this.requestTimestamps = [];
    this.tokenCount = 0;
    this.windowMs = 60000;
    this.waitingQueue = [];
    this.processing = false;
    this._timers = new Set();
  }

  _decay(count) {
    // P0 FIX: track timer handles + unref so decay timers never leak / hold the loop open.
    const h = setTimeout(() => { this.tokenCount = Math.max(0, this.tokenCount - count); this._timers.delete(h); }, this.windowMs);
    if (h && typeof h.unref === 'function') h.unref();
    this._timers.add(h);
  }

  async waitForSlot({ inputTokens = 0, outputTokens = 0 } = {}) {
    const estimatedTokens = inputTokens + outputTokens;
    return new Promise((resolve) => {
      this.waitingQueue.push({ resolve, tokens: estimatedTokens });
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.waitingQueue.length === 0) return;
    this.processing = true;

    while (this.waitingQueue.length > 0) {
      const now = Date.now();
      this.requestTimestamps = this.requestTimestamps.filter(t => now - t < this.windowMs);

      const head = this.waitingQueue[0];

      const tokensAvailable = this.tokenCount + head.tokens <= this.tpm;
      const rpmAvailable = this.requestTimestamps.length < this.rpm;

      if (rpmAvailable && tokensAvailable) {
        this.requestTimestamps.push(now);
        // P0 FIX: single accounting point. waitForSlot only reserves ACTUAL estimated
        // tokens (>0); the post-call trackTokens() call reports real usage. Old code
        // double-counted: reservation + actual.
        if (head.tokens > 0) {
          this.tokenCount += head.tokens;
          this._decay(head.tokens);
          head.tokens = 0; // consumed: trackTokens() below becomes the only addition
        }
        this.waitingQueue.shift();
        head.resolve();
      } else {
        let waitTime = 100;
        if (!rpmAvailable) {
          const oldestTimestamp = this.requestTimestamps[0];
          waitTime = this.windowMs - (now - oldestTimestamp) + 50;
        }
        if (!tokensAvailable) {
          // Estimate time to token availability based on the rate of consumption.
          const rate = this.tokenCount / this.windowMs;
          if (rate > 0) {
            const projected = Math.ceil((this.tokenCount + head.tokens - this.tpm) / rate);
            waitTime = Math.max(waitTime, projected + 50);
          }
        }
        await new Promise(r => setTimeout(r, Math.min(Math.max(waitTime, 100), 30000)));
      }
    }

    this.processing = false;
  }

  trackTokens(count) {
    if (!count || count <= 0) return;
    this.tokenCount += count;
    this._decay(count);
  }

  getStats() {
    const now = Date.now();
    const recentRequests = this.requestTimestamps.filter(t => now - t < this.windowMs);
    return {
      rpm_limit: this.rpm,
      tpm_limit: this.tpm,
      current_rpm: recentRequests.length,
      current_tpm: this.tokenCount,
      queue_length: this.waitingQueue.length
    };
  }
}
