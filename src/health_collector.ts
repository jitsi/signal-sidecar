import logger from './logger';
import got from 'got';
import { readFileSync } from 'fs';
import metrics from './metrics';
import { calculateWeight } from './app';

export interface HealthData {
    reachable: boolean;
    timeout: boolean;
    code: number;
    contents: string;
}

export interface StatusFileData {
    readable: boolean;
    contents: string;
}

export interface HealthReport {
    time: Date;
    healthy: boolean;
    healthdamped?: boolean;
    status: string;
    weight?: string;
    agentmessage?: string;
    services: {
        jicofoHealthy: boolean;
        jicofoReachable: boolean;
        jicofoSoftDown: boolean;
        jicofoStatusCode: number;
        jicofoStatusContents: string;
        jicofoStatsReachable: boolean;
        jicofoStatsStatusCode: number;
        prosodyHealthy: boolean;
        prosodyReachable: boolean;
        prosodySoftDown: boolean;
        prosodyStatusCode: number;
    };
    statuses: {
        statusFileFound: boolean;
        statusFileContents: string;
    };
    stats: {
        jicofoParticipants: number;
        jicofoConferences: number;
        prosodyParticipants?: number;
        prosodySumSquaredParticipants?: number;
    };
}

export interface HealthCollectorOptions {
    jicofoHealthUrl: string;
    jicofoStatsUrl: string;
    prosodyHealthUrl: string;
    statusFilePath: string;
    healthPollingInterval: number;
    collectMetrics: boolean;
}

export default class HealthCollector {
    private jicofoHealthUrl: string;
    private jicofoStatsUrl: string;
    private prosodyHealthUrl: string;
    private statusFilePath: string;
    private requestTimeout: number;
    private requestRetryCount: number;
    private collectMetrics: boolean;

    constructor(options: HealthCollectorOptions) {
        this.jicofoHealthUrl = options.jicofoHealthUrl;
        this.jicofoStatsUrl = options.jicofoStatsUrl;
        this.prosodyHealthUrl = options.prosodyHealthUrl;
        this.statusFilePath = options.statusFilePath;
        this.requestTimeout = 3 * 1000;
        this.requestRetryCount = 2;
        this.collectMetrics = options.collectMetrics;

        this.updateHealthReport = this.updateHealthReport.bind(this);
    }

    //returns an empty unhealthy report for use starting up
    initHealthReport(): HealthReport {
        return <HealthReport>{
            time: new Date(),
            healthy: false,
            healthdamped: false,
            status: 'unknown',
            services: {
                jicofoHealthy: false,
                jicofoReachable: false,
                jicofoSoftDown: false,
                jicofoStatusCode: 0,
                jicofoStatusContents: '',
                jicofoStatsReachable: false,
                jicofoStatsStatusCode: 0,
                prosodyHealthy: false,
                prosodyReachable: false,
                prosodySoftDown: false,
                prosodyStatusCode: 0,
            },
            statuses: {
                statusFileFound: false,
                statusFileContents: '',
            },
            stats: {
                jicofoParticipants: null,
                jicofoConferences: null,
            },
        };
    }

    initHealthData(): HealthData {
        return <HealthData>{ reachable: false, timeout: false, code: 0, contents: '' };
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
            let timeout = false;
            if (err.code == 'ETIMEDOUT') {
                timeout = true;
            }
            logger.warn('health_collector checkHealthHttp failed', { err, url });
            return <HealthData>{
                reachable: false,
                timeout,
                code: 0,
                contents: '',
            };
        }
    }

    async readStatusFile(filePath: string): Promise<StatusFileData> {
        logger.debug('status file check of ' + filePath);
        let readable = false;
        let contents = '';
        try {
            const data = readFileSync(filePath, 'utf8');
            readable = true;
            contents = data.trim();
        } catch (err) {
            logger.warn('health_collector readStatusFile failed', { err, path: filePath });
        }
        return <StatusFileData>{
            readable,
            contents,
        };
    }
    unsettleStatusFile(item: PromiseSettledResult<StatusFileData>): StatusFileData {
        if (item.status != 'fulfilled') {
            logger.warn('unsettled status file promise', { item });
            return <StatusFileData>{ readable: false };
        } else {
            return <StatusFileData>item.value;
        }
    }
    unsettleHealthData(item: PromiseSettledResult<HealthData>): HealthData {
        if (item.status != 'fulfilled') {
            logger.warn('unsettled health data promise', { item });
            return this.initHealthData();
        } else {
            return <HealthData>item.value;
        }
    }
    async updateHealthReport(): Promise<HealthReport> {
        // spawn concurrent calls
        const settledResult = await Promise.allSettled([
            this.checkHealthHttp(this.jicofoHealthUrl),
            this.checkHealthHttp(this.jicofoStatsUrl),
            this.checkHealthHttp(this.prosodyHealthUrl),
            this.readStatusFile(this.statusFilePath),
        ]);
        //remove statusFileResult, would prefer to use .pop here but typescript doesn't likey
        const [statusFileResult] = settledResult.splice(-1).map(this.unsettleStatusFile);
        const [jicofoHealth, jicofoStats, prosodyHealth] = settledResult.map(this.unsettleHealthData);

        let parsedStatsFlag = false;
        let jicofoParticipants: number, jicofoConferences: number;

        if (jicofoStats.reachable) {
            try {
                const parsedStats = JSON.parse(jicofoStats.contents);
                jicofoParticipants = parsedStats['participants'];
                jicofoConferences = parsedStats['conferences'];
                parsedStatsFlag = true;
            } catch (err) {
                logger.warn('failed to parse jicofo stats json', { err, json: jicofoStats.contents });
            }
        }

        // jicofo may report stats out even when it's broken; set to null to be
        // more in alignment with reality
        if (!jicofoHealth.reachable || jicofoHealth.code != 200 || !jicofoStats.reachable || jicofoStats.code != 200) {
            jicofoParticipants = null;
            jicofoConferences = null;
        }

        let overallhealth = false;
        let overallstatus = 'unknown';
        let jicofoHealthy = false;
        let prosodyHealthy = false;
        let jicofoSoftDown = false;
        let prosodySoftDown = false;

        if (jicofoHealth.reachable && jicofoHealth.code == 200 && jicofoStats.reachable && jicofoStats.code == 200) {
            jicofoHealthy = true;
        }

        if (jicofoHealth.reachable && jicofoHealth.code == 503) {
            jicofoSoftDown = true;
        }

        if (prosodyHealth.reachable && prosodyHealth.code == 200) {
            prosodyHealthy = true;
        } else {
            if (prosodyHealth.timeout) {
                prosodySoftDown = true;
            }
        }

        if (statusFileResult.contents === 'unhealthy') {
            overallstatus = 'drain';
        } else {
            overallstatus = statusFileResult.contents;
        }

        if (
            jicofoHealthy &&
            prosodyHealthy &&
            statusFileResult.readable &&
            parsedStatsFlag &&        // stats file parsed successfully
            statusFileResult.contents !== 'unhealthy'
        ) {
            overallhealth = true;
        }

        const report = <HealthReport>{
            time: new Date(),
            healthy: overallhealth,
            healthdamped: false,
            status: overallstatus,
            weight: calculateWeight(statusFileResult.contents, jicofoParticipants),
            services: {
                jicofoHealthy,
                jicofoReachable: jicofoHealth.reachable,
                jicofoSoftDown,
                jicofoStatusCode: jicofoHealth.code,
                jicofoStatusContents: jicofoHealth.contents,
                jicofoStatsReachable: jicofoStats.reachable,
                jicofoStatsStatusCode: jicofoStats.code,
                prosodyHealthy,
                prosodyReachable: prosodyHealth.reachable,
                prosodySoftDown,
                prosodyStatusCode: prosodyHealth.code,
            },
            statuses: {
                statusFileFound: statusFileResult.readable,
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
    }
}
