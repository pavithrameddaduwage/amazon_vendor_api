import { Injectable, Logger } from "@nestjs/common";
import { HttpService } from "@nestjs/axios";
import { InjectRepository } from "@nestjs/typeorm";
import { firstValueFrom } from "rxjs";
import { AuthService } from "src/auth.service";
import { Repository, In } from "typeorm";
import * as zlib from "zlib";
import { AmazonForecastByAsin } from "./entities/amazon_forecasting_by_asin.entity";
import { ReportStatusEntity } from "./entities/ReportStatusEntity";

@Injectable()
export class ForecastService {
  private currentAccessToken: string | null = null;
  private tokenExpirationTime: number | null = null;
  private readonly baseUrl = 'https://sellingpartnerapi-na.amazon.com';
  private readonly maxRetries = 5;
  private readonly retryDelay = 5000;

  constructor(
    private readonly httpService: HttpService,
    private readonly authService: AuthService,

    @InjectRepository(AmazonForecastByAsin)
    private readonly forecastRepository: Repository<AmazonForecastByAsin>,

    @InjectRepository(ReportStatusEntity)
    private readonly reportStatusRepository: Repository<ReportStatusEntity>
  ) {}

  private async ensureAccessToken() {
    const currentTime = new Date().getTime();
    if (!this.currentAccessToken || currentTime >= this.tokenExpirationTime!) {
      try {
        const { access_token, expirationTime } = await this.authService.getAccessToken();
        if (!access_token) {
          throw new Error('Access token is missing.');
        }
        this.currentAccessToken = access_token;
        this.tokenExpirationTime = expirationTime;
      } catch (error) {
        console.error('Error fetching access token:', error.message || error);
        throw new Error('Unable to fetch access token.');
      }
    }
  }

  private dateFormat(date: Date): string {
    return date.toISOString();
  }

  private async fetchForecastReports(startDate: Date, endDate: Date): Promise<any[]> {
    const reportType = "GET_VENDOR_FORECASTING_REPORT";
    let baseFetchUrl = `${this.baseUrl}/reports/2021-06-30/reports?reportTypes=${reportType}` +
                       `&processingStatuses=DONE&marketplaceIds=ATVPDKIKX0DER&pageSize=100` +
                       `&createdSince=${this.dateFormat(startDate)}&createdUntil=${this.dateFormat(endDate)}`;
  
    let allReports: any[] = [];
    const processedReportIds = new Set<string>();
    let failedRequests: string[] = [];
    let requestQueue: string[] = [baseFetchUrl];
  
    try {
      await this.ensureAccessToken();
  
      while (requestQueue.length > 0) {
        let url = requestQueue.shift();
        if (!url) continue;
  
        let retryCount = 0;
        let backoffDelay = 1000;
  
        while (retryCount <= this.maxRetries) {
          try {
            console.log(`Fetching forecast reports from URL: ${url}`);
  
            const response = await firstValueFrom(
              this.httpService.get(url, {
                headers: {
                  Authorization: `Bearer ${this.currentAccessToken}`,
                  'x-amz-access-token': this.currentAccessToken,
                },
              })
            );
  
            if (response.data.reports) {
              for (const report of response.data.reports) {
                const reportDocumentId = report.reportDocumentId || null;
                if (reportDocumentId && !processedReportIds.has(reportDocumentId)) {
                  allReports.push({ reportDocumentId });
                  processedReportIds.add(reportDocumentId);
                }
              }
              console.log(`Fetched ${response.data.reports.length} reports.`);
            }
  
            let nextToken = response.data.nextToken || null;
            if (nextToken) {
              console.log(`Next token found: ${nextToken}`);
              requestQueue.push(`${this.baseUrl}/reports/2021-06-30/reports?nextToken=${encodeURIComponent(nextToken)}`);
            } else {
              console.log("No next token found, stopping pagination.");
            }
  
            break;
          } catch (err) {
            retryCount++;
            if (err.response?.status === 429) {
              if (retryCount > this.maxRetries) {
                console.warn(`Max retries reached for URL: ${url}. Adding to failed requests.`);
                failedRequests.push(url);
                break;
              }
              console.warn(`Rate limit hit. Retrying in ${backoffDelay}ms...`);
              await this.delay(backoffDelay);
              backoffDelay = Math.min(backoffDelay * 2, 32000);
            } else {
              console.error(`Error fetching forecast reports: ${err.message || err}`);
              failedRequests.push(url);
              break;
            }
          }
        }
      }
    } catch (error) {
      console.error(`Error fetching forecast reports:`, error.message || error);
    }
  
    return allReports;
  }
  
  private async processForecastsSequentially() {
    let reportsToProcess = await this.reportStatusRepository.find({ where: { status: "IN_PROGRESS" } });
  
    for (const reportStatus of reportsToProcess) {
      await this.processForecastUntilComplete(reportStatus);
    }
  
    let failedReports = await this.reportStatusRepository.find({ where: { status: "FAILED" } });
  
    for (const reportStatus of failedReports) {
      await this.processForecastUntilComplete(reportStatus);
    }
  }
  
  private async processForecastUntilComplete(reportStatus: any) {
    const reportDocumentId = reportStatus.reportId;
    let retryCount = reportStatus.retryCount;
    let backoffDelay = 500;
  
    while (retryCount <= this.maxRetries) {
      try {
        const reportDocument = await this.fetchForecastDocument(reportDocumentId);
        if (!reportDocument) throw new Error("No data in forecast document.");
  
        await this.processForecastData(reportDocument);
  
        await this.reportStatusRepository.update(reportStatus.id, {
          status: "COMPLETED",
          errorMessage: null,
        });
  
        return;
      } catch (error) {
        retryCount++;
        console.warn(`Retrying forecast report ${reportDocumentId}, attempt ${retryCount}. Error: ${error.message}`);
  
        await this.reportStatusRepository.update(reportStatus.id, {
          status: retryCount >= this.maxRetries ? "FAILED" : "IN_PROGRESS",
          errorMessage: error.message || "Unknown error",
          retryCount,
        });
  
        if (retryCount >= this.maxRetries) {
          console.error(`Max retries reached for report ${reportDocumentId}. Marking as FAILED.`);
          return;
        }
  
        await this.delay(backoffDelay);
        backoffDelay = Math.min(backoffDelay * 2, 8000);
      }
    }
  }
  
  public async fetchAndStoreForecasts(startDate: Date, endDate: Date) {
    try {
      const reports = await this.fetchForecastReports(startDate, endDate);
      if (!reports.length) return;
  
      const reportIds = reports.map((r) => r.reportDocumentId).filter(Boolean);
      if (!reportIds.length) return;
  
      const existingReports = await this.reportStatusRepository.find({
        where: { reportId: In(reportIds) },
        select: ["reportId"],
      });
  
      const existingReportIds = new Set(existingReports.map((r) => r.reportId));
  
      const newReports = reports
        .filter((r) => !existingReportIds.has(r.reportDocumentId))
        .map((report) => ({
          reportType: "GET_VENDOR_FORECASTING_REPORT",
          reportId: report.reportDocumentId,
          startDate,
          endDate,
          status: "IN_PROGRESS",
          retryCount: 0,
        }));
  
      if (newReports.length) {
        await this.reportStatusRepository.upsert(newReports, ["reportId"]);
      }
  
      await this.processForecastsSequentially();
    } catch (error) {
      console.error("Error fetching and storing forecasts:", error);
    }
  }
  
  private async fetchForecastDocument(reportDocumentId: string, retryCount = 0): Promise<any> {
    const url = `${this.baseUrl}/reports/2021-06-30/documents/${reportDocumentId}`;
    try {
      await this.ensureAccessToken();
  
      const response = await firstValueFrom(
        this.httpService.get(url, {
          headers: {
            Authorization: `Bearer ${this.currentAccessToken}`,
            'x-amz-access-token': this.currentAccessToken,
          },
        })
      );
  
      const { url: documentUrl, compressionAlgorithm = 'GZIP' } = response.data;
      const documentResponse = await firstValueFrom(
        this.httpService.get(documentUrl, { responseType: 'arraybuffer' })
      );
  
      if (compressionAlgorithm === 'GZIP') {
        const decompressedData = zlib.gunzipSync(documentResponse.data);
        return JSON.parse(decompressedData.toString('utf-8'));
      }
  
      return JSON.parse(documentResponse.data.toString('utf-8'));
  
    } catch (error) {
      console.error(`Error fetching forecast document: ${error.message}`);
      if (retryCount < this.maxRetries) {
        await this.delay(this.retryDelay);
        return this.fetchForecastDocument(reportDocumentId, retryCount + 1);
      }
      throw new Error(`Unable to fetch forecast document after ${this.maxRetries} attempts.`);
    }
  }
  
  private async processForecastData(data: any) {
    if (!data || typeof data !== "object") {
        console.warn("Invalid or empty forecast data.");
        return;
    }

    const forecastArray = Array.isArray(data.forecasts) ? data.forecasts : Object.values(data).find(Array.isArray);

    if (!forecastArray || forecastArray.length === 0) {
        console.warn("No forecast records found.");
        return;
    }

    const uniqueForecasts = new Map<string, any>();

    forecastArray.forEach((forecast: any) => {
        const key = `${forecast.forecastGenerationDate}-${forecast.asin}`;
        if (uniqueForecasts.has(key)) {
            return;  
        }
        uniqueForecasts.set(key, {
            forecastGenerationDate: new Date(forecast.forecastGenerationDate || Date.now()),
            asin: forecast.asin || "UNKNOWN",
            startDate: forecast.startDate ? new Date(forecast.startDate) : null,
            endDate: forecast.endDate ? new Date(forecast.endDate) : null,
            meanForecastUnits: Math.round(parseFloat(forecast.meanForecastUnits)) || 0, 
            p70ForecastUnits: Math.round(parseFloat(forecast.p70ForecastUnits)) || 0, 
            p80ForecastUnits: Math.round(parseFloat(forecast.p80ForecastUnits)) || 0, 
            p90ForecastUnits: Math.round(parseFloat(forecast.p90ForecastUnits)) || 0, 
        });
    });

    const forecastRecords = Array.from(uniqueForecasts.values());

    if (forecastRecords.length === 0) {
        console.warn("No valid records to insert.");
        return;
    }

    console.log(`Processing ${forecastRecords.length} unique forecasts...`);

    const BATCH_SIZE = 500;
    for (let i = 0; i < forecastRecords.length; i += BATCH_SIZE) {
        const batch = forecastRecords.slice(i, i + BATCH_SIZE);
        try {
            await this.forecastRepository
                .createQueryBuilder()
                .insert()
                .into('amazon_forecast_by_asin')
                .values(batch)
                .orIgnore()  
                .execute();
        } catch (error) {
            if (error.code === '23505') {
                console.warn("Duplicate records detected. Skipping...");
            } else {
                console.error("Database error:", error.message);
            }
        }
    }

    console.log("Forecast data processing completed.");
}




  private async delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
