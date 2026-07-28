export class RateLimiter {
  constructor(limits) {
    this.rpm = limits.rpm || 60;
    this.tpm = limits.tpm || 100000;
    this.requestTimestamps = [];
    this.tokenCount = 0;
    this.windowMs = 60000;
    this.waitingQueue = [];
    this.processing = false;
  }

  async waitForSlot() {
    return new Promise((resolve) => {
      this.waitingQueue.push(resolve);
      this.processQueue();
    });
  }

  async processQueue() {
    if (this.processing || this.waitingQueue.length === 0) return;
    this.processing = true;

    while (this.waitingQueue.length > 0) {
      const now = Date.now();
      this.requestTimestamps = this.requestTimestamps.filter(t => now - t < this.windowMs);

      if (this.requestTimestamps.length < this.rpm) {
        this.requestTimestamps.push(now);
        const resolver = this.waitingQueue.shift();
        resolver();
      } else {
        const oldestTimestamp = this.requestTimestamps[0];
        const waitTime = this.windowMs - (now - oldestTimestamp) + 50;
        await new Promise(r => setTimeout(r, Math.max(waitTime, 100)));
      }
    }

    this.processing = false;
  }

  trackTokens(count) {
    this.tokenCount += count;
    if (this.tokenCount >= this.tpm) {
      const resetDelay = 1000;
      setTimeout(() => { this.tokenCount = 0; }, resetDelay);
    }
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
