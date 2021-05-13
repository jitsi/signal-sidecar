import logger from './logger';
import got from 'got';
import { readFile } from 'fs';

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

export interface HealthData {
    reachable: boolean;
    code: number;
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

    async checkHealthHttp(url: string, method = 'GET'): Promise<HealthData> {
        logger.debug('aa: ' + url);
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
            logger.debug('bb');
            return <HealthData>{
                reachable: true,
                code: response.statusCode,
                contents: '',
            };
        } catch (err) {
            logger.debug('cc');
            logger.debug('checkHealthHttp failed', { err, url });
            return <HealthData>{
                reachable: false,
                code: 0,
                contents: '',
            };
        }
    }

    async readStatusFile(filePath: string): Promise<HealthData> {
        await readFile(filePath, { encoding: 'utf8', flag: 'r' }, function (err, data) {
            if (!err) {
                return <HealthData>{
                    reachable: true,
                    code: 1,
                    contents: data,
                };
            } else {
                logger.debug('readStatusFile failed', { err, path: filePath });
            }
        });
        return <HealthData>{
            reachable: false,
            code: 0,
            contents: '',
        };
    }

    async updateHealthReport(): Promise<HealthReport> {
        const report: Partial<HealthReport> = {};

        // spawn concurrent calls
        const ccalls: Promise<HealthData>[] = [];
        ccalls.push(this.checkHealthHttp(this.jicofoHealthUrl));
        ccalls.push(this.checkHealthHttp(this.prosodyHealthUrl));
        ccalls.push(this.readStatusFile(this.statusFilePath));
        // const cresult = await Promise.all(ccalls);
        Promise.all(ccalls).then((results: HealthData[]) => {
            report.services.jicofoReachable = results[0].reachable;
            report.services.jicofoStatusCode = results[0].code;
            report.services.prosodyReachable = results[1].reachable;
            report.services.prosodyStatusCode = results[1].code;
            report.services.statusFileFound = results[2].reachable;
            report.services.statusFileContents = results[2].contents;
            report.status = results[2].contents;
        });

        logger.debug(report);
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
