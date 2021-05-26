import config from './config';
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
        jicofoPartipants: number;
        jicofoConferences: number;
    };
}

export interface HealthCollectorOptions {
    jicofoHealthUrl: string;
    jicofoStatsUrl: string;
    prosodyHealthUrl: string;
    statusFilePath: string;
    healthPollingInterval: number;
}

export default class HealthCollector {
    private jicofoHealthUrl: string;
    private jicofoStatsUrl: string;
    private prosodyHealthUrl: string;
    private statusFilePath: string;
    private healthPollingInterval: number;
    private requestTimeout: number;
    private requestRetryCount: number;

    constructor(options: HealthCollectorOptions) {
        this.jicofoHealthUrl = options.jicofoHealthUrl;
        this.jicofoStatsUrl = options.jicofoStatsUrl;
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

    // returns [parsable, # partipants, # conferences]
    readStatsJSON(jstats: string): [boolean, number, number] {
        try {
            const parsed = JSON.parse(jstats);
            const partipants = parsed['partipants'];
            const conferences = parsed['conferences'];
            return [true, partipants, conferences];
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
            const jhr = results[0].reachable; // jicofo health
            const jhc = results[0].code;
            const jsr = results[1].reachable; // jicofo stats
            const jsc = results[1].code;
            const jsx = results[1].contents;
            const phr = results[2].reachable; // prosody health
            const phc = results[2].code;
            const sfr = results[3].reachable; // status file
            const sfx = results[3].contents;

            const jStats = this.readStatsJSON(jsx);

            let overallhealth = false;
            if (jhr && jhc == 200 && jsr && jsc == 200 && phr && phc == 200 && sfr && jStats[0]) {
                overallhealth = true;
            }

            let overallstatus = sfx;
            if (jStats[1] > config.ParticipantMax) {
                overallstatus = 'drain';
            }

            const report = <HealthReport>{
                healthy: overallhealth,
                status: overallstatus,
                services: {
                    jicofoReachable: jhr,
                    jicofoStatusCode: jhc,
                    jicofoStatsReachable: jsr,
                    jicofoStatsStatusCode: jsc,
                    prosodyReachable: phr,
                    prosodyStatusCode: phc,
                    statusFileFound: sfr,
                    statusFileContents: sfx,
                },
                stats: {
                    jicofoPartipants: jStats[1],
                    jicofoConferences: jStats[2],
                },
            };
            logger.debug('updateHealthReport return', report);
            return report;
        });
    }
}
