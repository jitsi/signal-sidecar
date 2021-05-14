import logger from './logger';
import got from 'got';
import { readFileSync } from 'fs';

export interface HealthData {
    reachable: boolean;
    code: number;
    contents: string;
}

export interface HealthReport {
    healthy: boolean;
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

export interface HealthCollectorOptions {
    jicofoHealthUrl: string;
    prosodyHealthUrl: string;
    statusFilePath: string;
    healthPollingInterval: number;
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

    async checkHealthHttp(url: string, method = 'GET'): Promise<HealthData> {
        logger.debug('health check of ' + url);
        try {
            let got_method = got.get;
            if (method == 'POST') {
                got_method = got.post;
            }
            const response = await got_method(url, {
                responseType: 'text',
                timeout: this.requestTimeout,
                retry: this.requestRetryCount,
                throwHttpErrors: false,
            });
            //logger.debug('HTTP RESPONSE', { response });
            return <HealthData>{
                reachable: true,
                code: response.statusCode,
                contents: '',
            };
        } catch (err) {
            logger.debug('checkHealthHttp failed ERROR ERROR', { err, url });
            return <HealthData>{
                reachable: false,
                code: 0,
                contents: '',
            };
        }
    }

    async readStatusFile(filePath: string): Promise<HealthData> {
        logger.debug('status file check of ' + filePath);

        try {
            const data = readFileSync(filePath, 'utf8');
            return <HealthData>{
                reachable: true,
                code: 1,
                contents: data.trim(),
            };
        } catch (err) {
            logger.warn('readStatusFile failed', { err, path: filePath });
            return <HealthData>{
                reachable: false,
                code: 0,
                contents: '',
            };
        }
    }

    async updateHealthReport(): Promise<HealthReport> {
        // spawn concurrent calls
        const ccalls: Promise<HealthData>[] = [];
        ccalls.push(this.checkHealthHttp(this.jicofoHealthUrl));
        ccalls.push(this.checkHealthHttp(this.prosodyHealthUrl));
        ccalls.push(this.readStatusFile(this.statusFilePath));

        return Promise.all(ccalls).then((results: HealthData[]) => {
            const jir = results[0].reachable;
            const jsc = results[0].code;
            const prr = results[1].reachable;
            const psc = results[1].code;
            const sff = results[2].reachable;
            const sfc = results[2].contents;

            let overallhealth = false;
            if (jir && jsc == 200 && prr && psc == 200 && sff) {
                overallhealth = true;
            }

            const report = <HealthReport>{
                healthy: overallhealth,
                status: sfc,
                services: {
                    jicofoReachable: jir,
                    jicofoStatusCode: jsc,
                    prosodyReachable: prr,
                    prosodyStatusCode: psc,
                    statusFileFound: sff,
                    statusFileContents: sfc,
                },
            };
            logger.debug('updateHealthReport return', report);
            return report;
        });
    }
}
