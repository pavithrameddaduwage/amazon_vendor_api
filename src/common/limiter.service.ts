import { Injectable } from '@nestjs/common';
import Bottleneck from 'bottleneck';

@Injectable()
export class LimiterService {
  /**
   * Amazon SP-API 'getReportDocument' rate limit:
   * Rate: 0.0167 req/sec (approx 1 per 60 seconds)
   * Burst: 15
   *
   * We use a global limiter to ensure we don't hit 429s across Sales and Inventory.
   */
  public readonly documentLimiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: 65_000, // Wait 65 seconds between document requests to be 100% safe
  });

  /**
   * Amazon SP-API 'createReport' rate limit:
   * Rate: 0.0167 req/sec (1 per 60 seconds)
   * Burst: 15
   */
  public readonly createReportLimiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: 65_000, // Ensure we don't exhaust the burst too quickly
  });
}
