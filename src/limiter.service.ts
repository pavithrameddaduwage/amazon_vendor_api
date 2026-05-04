import { Injectable } from '@nestjs/common';
import Bottleneck from 'bottleneck';

@Injectable()
export class LimiterService {
  /**
   * Amazon SP-API 'getReportDocument' rate limit:
   * Rate: 0.0167 req/sec (approx 1 per 60 seconds)
   * Burst: 15
   */
  public readonly documentLimiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: 65_000, 
  });

  /**
   * Amazon SP-API 'createReport' rate limit:
   * Rate: 0.0167 req/sec (1 per 60 seconds)
   * Burst: 15
   */
  public readonly createReportLimiter = new Bottleneck({
    maxConcurrent: 1,
    minTime: 65_000,
  });
}
