export interface PaymentMetrics {
  totalVerifications: number;
  successfulVerifications: number;
  failedVerifications: number;
  cacheHits: number;
  cacheMisses: number;
  averageVerificationTime: number;
  cacheHitRate: number;
  successRate: number;
  rpcErrors: number;
  totalAmount: number; // Total USDC processed
}

export interface VerificationEvent {
  timestamp: number;
  success: boolean;
  duration: number;
  fromCache: boolean;
  amount?: number;
  errorCode?: string;
}

/**
 * Monitor payment verification metrics and send alerts
 */
export class PaymentMonitor {
  private metrics: PaymentMetrics = {
    totalVerifications: 0,
    successfulVerifications: 0,
    failedVerifications: 0,
    cacheHits: 0,
    cacheMisses: 0,
    averageVerificationTime: 0,
    cacheHitRate: 0,
    successRate: 1.0,
    rpcErrors: 0,
    totalAmount: 0
  };

  private recentEvents: VerificationEvent[] = [];
  private readonly maxEvents = 1000; // Keep last 1000 events
  private alertThreshold = 0.1; // 10% failure rate triggers alert
  private rpcErrorThreshold = 10;

  /**
   * Record a payment verification attempt
   */
  recordVerification(
    success: boolean,
    duration: number,
    fromCache: boolean,
    amount?: number,
    errorCode?: string
  ): void {
    this.metrics.totalVerifications++;

    if (success) {
      this.metrics.successfulVerifications++;
      if (amount) {
        this.metrics.totalAmount += amount;
      }
    } else {
      this.metrics.failedVerifications++;
    }

    if (fromCache) {
      this.metrics.cacheHits++;
    } else {
      this.metrics.cacheMisses++;
    }

    // Record event
    this.recentEvents.push({
      timestamp: Date.now(),
      success,
      duration,
      fromCache,
      amount,
      errorCode
    });

    // Trim old events
    if (this.recentEvents.length > this.maxEvents) {
      this.recentEvents = this.recentEvents.slice(-this.maxEvents);
    }

    // Update calculated metrics
    this.updateCalculatedMetrics();

    // Check alert conditions
    this.checkAlerts();
  }

  /**
   * Record an RPC error
   */
  recordRPCError(): void {
    this.metrics.rpcErrors++;

    if (this.metrics.rpcErrors >= this.rpcErrorThreshold) {
      this.sendAlert(
        'HIGH_RPC_ERRORS',
        `High number of RPC errors detected: ${this.metrics.rpcErrors}`,
        {
          rpcErrors: this.metrics.rpcErrors,
          suggestion: 'Check RPC endpoint health and connectivity'
        }
      );
    }
  }

  /**
   * Get current metrics
   */
  getMetrics(): PaymentMetrics {
    return { ...this.metrics };
  }

  /**
   * Get recent verification events
   */
  getRecentEvents(count?: number): VerificationEvent[] {
    if (count) {
      return this.recentEvents.slice(-count);
    }
    return [...this.recentEvents];
  }

  /**
   * Get time-windowed metrics (e.g., last hour)
   */
  getWindowedMetrics(windowMs: number = 3600000): PaymentMetrics {
    const cutoff = Date.now() - windowMs;
    const windowEvents = this.recentEvents.filter(e => e.timestamp >= cutoff);

    const windowMetrics: PaymentMetrics = {
      totalVerifications: windowEvents.length,
      successfulVerifications: windowEvents.filter(e => e.success).length,
      failedVerifications: windowEvents.filter(e => !e.success).length,
      cacheHits: windowEvents.filter(e => e.fromCache).length,
      cacheMisses: windowEvents.filter(e => !e.fromCache).length,
      averageVerificationTime: 0,
      cacheHitRate: 0,
      successRate: 0,
      rpcErrors: 0,
      totalAmount: windowEvents.reduce((sum, e) => sum + (e.amount || 0), 0)
    };

    // Calculate rates
    if (windowMetrics.totalVerifications > 0) {
      windowMetrics.successRate =
        windowMetrics.successfulVerifications / windowMetrics.totalVerifications;
      windowMetrics.cacheHitRate =
        windowMetrics.cacheHits / windowMetrics.totalVerifications;

      const totalDuration = windowEvents.reduce((sum, e) => sum + e.duration, 0);
      windowMetrics.averageVerificationTime =
        totalDuration / windowMetrics.totalVerifications;
    }

    return windowMetrics;
  }

  /**
   * Get error breakdown
   */
  getErrorBreakdown(): Record<string, number> {
    const breakdown: Record<string, number> = {};

    for (const event of this.recentEvents) {
      if (!event.success && event.errorCode) {
        breakdown[event.errorCode] = (breakdown[event.errorCode] || 0) + 1;
      }
    }

    return breakdown;
  }

  /**
   * Reset metrics
   */
  reset(): void {
    this.metrics = {
      totalVerifications: 0,
      successfulVerifications: 0,
      failedVerifications: 0,
      cacheHits: 0,
      cacheMisses: 0,
      averageVerificationTime: 0,
      cacheHitRate: 0,
      successRate: 1.0,
      rpcErrors: 0,
      totalAmount: 0
    };
    this.recentEvents = [];
  }

  /**
   * Set alert threshold
   */
  setAlertThreshold(threshold: number): void {
    this.alertThreshold = threshold;
  }

  /**
   * Update calculated metrics
   */
  private updateCalculatedMetrics(): void {
    // Success rate
    if (this.metrics.totalVerifications > 0) {
      this.metrics.successRate =
        this.metrics.successfulVerifications / this.metrics.totalVerifications;
    }

    // Cache hit rate
    if (this.metrics.totalVerifications > 0) {
      this.metrics.cacheHitRate =
        this.metrics.cacheHits / this.metrics.totalVerifications;
    }

    // Average verification time
    if (this.recentEvents.length > 0) {
      const totalDuration = this.recentEvents.reduce(
        (sum, event) => sum + event.duration,
        0
      );
      this.metrics.averageVerificationTime = totalDuration / this.recentEvents.length;
    }
  }

  /**
   * Check for alert conditions
   */
  private checkAlerts(): void {
    const failureRate = 1 - this.metrics.successRate;

    // Alert on high failure rate (but only if we have enough data)
    if (this.metrics.totalVerifications >= 10 && failureRate > this.alertThreshold) {
      this.sendAlert(
        'HIGH_FAILURE_RATE',
        `Payment verification failure rate is ${(failureRate * 100).toFixed(1)}%`,
        {
          failureRate,
          threshold: this.alertThreshold,
          totalVerifications: this.metrics.totalVerifications,
          failedVerifications: this.metrics.failedVerifications,
          errorBreakdown: this.getErrorBreakdown()
        }
      );
    }

    // Alert on slow verification times
    if (this.metrics.averageVerificationTime > 5000) { // 5 seconds
      this.sendAlert(
        'SLOW_VERIFICATION',
        `Average verification time is ${(this.metrics.averageVerificationTime / 1000).toFixed(2)}s`,
        {
          averageTime: this.metrics.averageVerificationTime,
          suggestion: 'Check RPC endpoint performance and network conditions'
        }
      );
    }
  }

  /**
   * Send alert (integrate with monitoring service)
   */
  private sendAlert(code: string, message: string, details?: any): void {
    const alert = {
      code,
      message,
      details,
      timestamp: new Date().toISOString(),
      metrics: this.getMetrics()
    };

    // Log to console (in production, send to monitoring service)
    console.error('[PAYMENT ALERT]', JSON.stringify(alert, null, 2));

    // In production, integrate with:
    // - Datadog: datadog.sendMetric()
    // - New Relic: newrelic.recordCustomEvent()
    // - PagerDuty: pagerduty.trigger()
    // - Slack: slack.postMessage()
    // - CloudWatch: cloudwatch.putMetricData()
  }

  /**
   * Export metrics for external monitoring systems
   */
  exportPrometheusMetrics(): string {
    const metrics = this.getMetrics();

    return `
# HELP payment_verifications_total Total number of payment verifications
# TYPE payment_verifications_total counter
payment_verifications_total ${metrics.totalVerifications}

# HELP payment_verifications_success_total Successful payment verifications
# TYPE payment_verifications_success_total counter
payment_verifications_success_total ${metrics.successfulVerifications}

# HELP payment_verifications_failed_total Failed payment verifications
# TYPE payment_verifications_failed_total counter
payment_verifications_failed_total ${metrics.failedVerifications}

# HELP payment_cache_hits_total Cache hits
# TYPE payment_cache_hits_total counter
payment_cache_hits_total ${metrics.cacheHits}

# HELP payment_cache_misses_total Cache misses
# TYPE payment_cache_misses_total counter
payment_cache_misses_total ${metrics.cacheMisses}

# HELP payment_verification_duration_seconds Average verification duration
# TYPE payment_verification_duration_seconds gauge
payment_verification_duration_seconds ${metrics.averageVerificationTime / 1000}

# HELP payment_success_rate Payment verification success rate
# TYPE payment_success_rate gauge
payment_success_rate ${metrics.successRate}

# HELP payment_cache_hit_rate Cache hit rate
# TYPE payment_cache_hit_rate gauge
payment_cache_hit_rate ${metrics.cacheHitRate}

# HELP payment_rpc_errors_total RPC errors
# TYPE payment_rpc_errors_total counter
payment_rpc_errors_total ${metrics.rpcErrors}

# HELP payment_total_amount_usdc Total USDC processed
# TYPE payment_total_amount_usdc counter
payment_total_amount_usdc ${metrics.totalAmount}
`.trim();
  }
}
