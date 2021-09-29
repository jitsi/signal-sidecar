import logger from './logger';
import got from 'got';

export interface RoomData {
    room_name: string;
    participants: number;
    created_time: number;
}

export interface CensusReport {
    room_census: Array<RoomData>;
}

export interface CensusCollectorOptions {
    prosodyCensusUrl: string;
    censusHost: string;
    censusPollingInterval: number;
}

export default class CensusCollector {
    private prosodyCensusUrl: string;
    private censusHost: string;
    private requestTimeout: number;
    private requestRetryCount: number;

    constructor(options: CensusCollectorOptions) {
        this.prosodyCensusUrl = options.prosodyCensusUrl;
        this.censusHost = options.censusHost;
        this.requestTimeout = 3 * 1000;
        this.requestRetryCount = 2;
        this.updateCensusReport = this.updateCensusReport.bind(this);
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
            return response;
        } catch (err) {
            logger.warn('checkCensusHttp failed', { err });
            return <CensusReport>{
                room_census: null,
            };
        }
    }
}
