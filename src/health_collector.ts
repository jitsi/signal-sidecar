import logger from './logger';
import got from 'got';
import { readFileSync } from 'fs';
import metrics from './metrics';

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
        jicofoStatsReachable: boolean;
        jicofoStatsStatusCode: number;
        prosodyReachable: boolean;
        prosodyStatusCode: number;
        statusFileFound: boolean;
        statusFileContents: string;
    };
    stats: {
        jicofoParticipants: number;
        jicofoConferences: number;
    };
}

export interface HealthCollectorOptions {
    jicofoHealthUrl: string;
    jicofoStatsUrl: string;
    prosodyHealthUrl: string;
    statusFilePath: string;
    participantMax: number;
    healthPollingInterval: number;
    collectMetrics: boolean;
}

export default class HealthCollector {
    private jicofoHealthUrl: string;
    private jicofoStatsUrl: string;
    private prosodyHealthUrl: string;
    private statusFilePath: string;
    private participantMax: number;
    private requestTimeout: number;
    private requestRetryCount: number;
    private collectMetrics: boolean;

    constructor(options: HealthCollectorOptions) {
        this.jicofoHealthUrl = options.jicofoHealthUrl;
        this.jicofoStatsUrl = options.jicofoStatsUrl;
        this.prosodyHealthUrl = options.prosodyHealthUrl;
        this.statusFilePath = options.statusFilePath;
        this.participantMax = options.participantMax;
        this.requestTimeout = 3 * 1000;
        this.requestRetryCount = 2;
        this.collectMetrics = options.collectMetrics;

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
            return <HealthData>{
                reachable: true,
                code: response.statusCode,
                contents: response.body,
            };
        } catch (err) {
            logger.warn('health_collector checkHealthHttp failed', { err, url });
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
            logger.warn('health_collector readStatusFile failed', { err, path: filePath });
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
        ccalls.push(this.checkHealthHttp(this.jicofoStatsUrl));
        ccalls.push(this.checkHealthHttp(this.prosodyHealthUrl));
        ccalls.push(this.readStatusFile(this.statusFilePath));

        return Promise.all(ccalls).then((results: HealthData[]) => {
            const [jicofoHealth, jicofoStats, prosodyHealth, statusFileResult] = results;
            let parsedStatsFlag = false;
            let jicofoParticipants, jicofoConferences = 0;
            try {
                const parsedStats = JSON.parse(jicofoStats.contents);
                jicofoParticipants = parsedStats['participants'];
                jicofoConferences = parsedStats['conferences'];
                parsedStatsFlag = true;
            } catch (err) {
                logger.warn('failed to parse jicofo stats json', { err, json: jicofoStats.contents });
            }

            let overallhealth = false;
            if (
                jicofoHealth.reachable &&
                jicofoHealth.code == 200 &&
                jicofoStats.reachable &&
                jicofoStats.code == 200 &&
                prosodyHealth.reachable &&
                prosodyHealth.code == 200 &&
                statusFileResult.reachable &&
                parsedStatsFlag // stats file parsed successfully
            ) {
                overallhealth = true;
            }

            let overallstatus = statusFileResult.contents;
            if (jicofoParticipants > this.participantMax) {
                // TODO: log something here
                overallstatus = 'drain';
            }

            const report = <HealthReport>{
                healthy: overallhealth,
                status: overallstatus,
                services: {
                    jicofoReachable: jicofoHealth.reachable,
                    jicofoStatusCode: jicofoHealth.code,
                    jicofoStatsReachable: jicofoStats.reachable,
                    jicofoStatsStatusCode: jicofoStats.code,
                    prosodyReachable: prosodyHealth.reachable,
                    prosodyStatusCode: prosodyHealth.code,
                    statusFileFound: statusFileResult.reachable,
                    statusFileContents: statusFileResult.contents,
                },
                stats: {
                    jicofoParticipants,
                    jicofoConferences,
                },
            };

            if (!overallhealth) {
                logger.warn('updateHealthReport returned unhealthy', { report });
                if (this.collectMetrics) {
                    metrics.SignalHealthGauge.set(0);
                }
            } else {
                logger.debug('updateHealthReport return', { report });
                if (this.collectMetrics) {
                    metrics.SignalHealthGauge.set(1);
                }
            }
            return report;
        });
    }
}
