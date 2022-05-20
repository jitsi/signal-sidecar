import logger from './logger';
import got from 'got';
import metrics from './metrics';

export interface RoomData {
    room_name: string;
    participants: number;
    created_time: number;
}

export interface CensusReport {
    room_census: Array<RoomData>;
    censusParticipantCount(): number;
    censusSumSquaredParticipantCount(): number;
}

export interface CensusCollectorOptions {
    prosodyCensusUrl: string;
    censusHost: string;
    censusPollingInterval: number;
    collectMetrics: boolean;
}

export default class CensusCollector {
    private prosodyCensusUrl: string;
    private censusHost: string;
    private requestTimeout: number;
    private requestRetryCount: number;
    private collectMetrics: boolean;

    constructor(options: CensusCollectorOptions) {
        this.prosodyCensusUrl = options.prosodyCensusUrl;
        this.censusHost = options.censusHost;
        this.requestTimeout = 3 * 1000;
        this.requestRetryCount = 2;
        this.collectMetrics = options.collectMetrics;
        this.updateCensusReport = this.updateCensusReport.bind(this);
    }
    initCensusReport(): CensusReport {
        return <CensusReport>{
            room_census: [],
            censusParticipantCount(): number {
                let participantCount = 0;
                for (const conference of this.room_census) {
                    participantCount += conference['participants'];
                }
                return participantCount;
            },
            censusSumSquaredParticipantCount(): number {
                let participantSquaredCount = 0;
                for (const conference of this.room_census) {
                    participantSquaredCount += conference['participants'] ** 2;
                }
                return participantSquaredCount;
            },
        };
    }
    async updateCensusReport(): Promise<CensusReport> {
        logger.debug('poll census data: ' + this.prosodyCensusUrl);
        try {
            const response = await got
                .get(this.prosodyCensusUrl, {
                    headers: {
                        host: this.censusHost,
                    },
                    responseType: 'json',
                    timeout: this.requestTimeout,
                    retry: this.requestRetryCount,
                    throwHttpErrors: false,
                })
                .json<CensusReport>();
            logger.debug('prosody census response: ' + JSON.stringify(response));
            if (this.collectMetrics) {
                metrics.SignalCensusGauge.set(1);
            }
            return response;
        } catch (err) {
            logger.warn('checkCensusHttp failed', { err });
            if (this.collectMetrics) {
                metrics.SignalCensusGauge.set(0);
            }
            return <CensusReport>{
                room_census: null,
            };
        }
    }
}
