import logger from './logger';
import got from 'got';
import { readFileSync } from 'fs';

export interface HealthCollectorOptions {
    jicofoHealthUrl: string;
    prosodyHealthUrl: string;
    statusFilePath: string;
    healthPollingInterval: number;
}

export interface HealthReport {
    health: string;
    status: string;
    services: {
        jicofoReachable: boolean;
        jicofoStatusCode: number;
        prosodyReachable: boolean;
        prosodyStatusCode: number;
        statusFileFound: boolean;
        statusFileContents: string;
    };
}

export interface HttpCheck {
    reachable: boolean;
    statusCode: number;
}

export interface FileCheck {
    readable: boolean;
    contents: string;
}

export default class HealthCollector {
    private jicofoHealthUrl: string;
    private prosodyHealthUrl: string;
    private statusFilePath: string;
    private healthPollingInterval: number;
    private requestTimeout: number;
    private requestRetryCount: number;

    constructor(options: HealthCollectorOptions) {
        this.jicofoHealthUrl = options.jicofoHealthUrl;
        this.prosodyHealthUrl = options.prosodyHealthUrl;
        this.statusFilePath = options.statusFilePath;
        this.healthPollingInterval = options.healthPollingInterval;
        this.requestTimeout = 3 * 1000;
        this.requestRetryCount = 2;

        this.updateHealthReport = this.updateHealthReport.bind(this);
    }

    async checkHealthHttp(url: string, method = 'GET'): Promise<HttpCheck> {
        try {
            let got_method = got.get;
            if (method == 'POST') {
                got_method = got.post;
            }
            const response = await got_method(url, {
                responseType: 'text',
                timeout: this.requestTimeout,
                retry: this.requestRetryCount,
            });
            return <HttpCheck>{
                reachable: true,
                statusCode: response.statusCode,
            };
        } catch (err) {
            logger.debug('checkHealthHttp failed', { err, url: url });
            return <HttpCheck>{
                reachable: false,
                statusCode: 0,
            };
        }
    }

    readStatusFile(filePath: string): FileCheck {
        try {
            const contents = readFileSync(filePath, { encoding: 'utf8', flag: 'r' });
            return <FileCheck>{
                readable: true,
                contents: contents,
            };
        } catch (err) {
            logger.debug('readStatusFile failed', { err, path: filePath });
            return <FileCheck>{
                readable: false,
                contents: '',
            };
        }
    }

    async updateHealthReport(): Promise<HealthReport> {
        const report: Partial<HealthReport> = {};

        // spawn concurrent calls
        const jicofoHealthResp = this.checkHealthHttp(this.jicofoHealthUrl);
        const prosodyHealthResp = this.checkHealthHttp(this.prosodyHealthUrl, 'POST');

        const jhr = await jicofoHealthResp;
        report.services.jicofoReachable = jhr.reachable;
        report.services.jicofoStatusCode = jhr.statusCode;

        const phr = await prosodyHealthResp;
        report.services.prosodyReachable = phr.reachable;
        report.services.prosodyStatusCode = phr.statusCode;

        const statusFileCheck = this.readStatusFile(this.statusFilePath);
        if (statusFileCheck.readable) {
            report.services.statusFileFound = true;
            report.services.statusFileContents = statusFileCheck.contents;
            report.status = statusFileCheck.contents;
        } else {
            report.services.statusFileFound = false;
            report.services.statusFileContents = 'not found';
            report.status = 'UNKNOWN';
        }

        if (
            report.services.jicofoReachable &&
            report.services.jicofoStatusCode == 200 &&
            report.services.prosodyReachable &&
            report.services.prosodyStatusCode == 200 &&
            report.services.statusFileFound
        ) {
            report.health == 'UP';
        } else {
            report.health == 'DOWN';
        }

        logger.debug('Stats report', { report });
        return <HealthReport>report;
    }
}
