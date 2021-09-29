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
}

export default class HealthCollector {
    private jicofoHealthUrl: string;
    private jicofoStatsUrl: string;
    private prosodyHealthUrl: string;
    private statusFilePath: string;
    private participantMax: number;
    private requestTimeout: number;
    private requestRetryCount: number;

    constructor(options: HealthCollectorOptions) {
        this.jicofoHealthUrl = options.jicofoHealthUrl;
        this.jicofoStatsUrl = options.jicofoStatsUrl;
        this.prosodyHealthUrl = options.prosodyHealthUrl;
        this.statusFilePath = options.statusFilePath;
        this.participantMax = options.participantMax;
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
            return <HealthData>{
                reachable: true,
                code: response.statusCode,
                contents: response.body,
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

    // returns [parsable, # participants, # conferences]
    readStatsJSON(jstats: string): [boolean, number, number] {
        try {
            const parsed = JSON.parse(jstats);
            const participants = parsed['participants'];
            const conferences = parsed['conferences'];
            return [true, participants, conferences];
        } catch (err) {
            logger.warn('failed to parse jicofo stats json', { err, json: jstats });
            return [false, 0, 0];
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
            const jicofoReachable = results[0].reachable;
            const jicofoStatusCode = results[0].code;
            const jicofoStatsReachable = results[1].reachable;
            const jicofoStatsStatusCode = results[1].code;
            const jicofoStatsContents = results[1].contents;
            const prosodyHealthReachable = results[2].reachable;
            const prosodyHealthStatusCode = results[2].code;
            const statusFileReachable = results[3].reachable;
            const statusFileContents = results[3].contents;

            const jStats = this.readStatsJSON(jicofoStatsContents);

            let overallhealth = false;
            if (
                jicofoReachable &&
                jicofoStatusCode == 200 &&
                jicofoStatsReachable &&
                jicofoStatsStatusCode == 200 &&
                prosodyHealthReachable &&
                prosodyHealthStatusCode == 200 &&
                statusFileReachable &&
                jStats[0] // stats file parsed successfully
            ) {
                overallhealth = true;
            }

            let overallstatus = statusFileContents;
            if (jStats[1] > this.participantMax) {
                overallstatus = 'drain';
            }

            const report = <HealthReport>{
                healthy: overallhealth,
                status: overallstatus,
                services: {
                    jicofoReachable: jicofoReachable,
                    jicofoStatusCode: jicofoStatusCode,
                    jicofoStatsReachable: jicofoStatsReachable,
                    jicofoStatsStatusCode: jicofoStatsStatusCode,
                    prosodyReachable: prosodyHealthReachable,
                    prosodyStatusCode: prosodyHealthStatusCode,
                    statusFileFound: statusFileReachable,
                    statusFileContents: statusFileContents,
                },
                stats: {
                    jicofoParticipants: jStats[1],
                    jicofoConferences: jStats[2],
                },
            };
            logger.debug('updateHealthReport return', report);
            return report;
        });
    }
}
