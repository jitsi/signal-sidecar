import logger from './logger';
import got from 'got';

export interface CensusData {
    reachable: boolean;
    contents: CensusReport;
}

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

    async checkCensusHttp(url: string): Promise<CensusData> {
        logger.debug('pulling census data from: ' + url);
        try {
            const response = await got
                .get(url, {
                    headers: {
                        host: this.censusHost,
                    },
                    responseType: 'json',
                    timeout: this.requestTimeout,
                    retry: this.requestRetryCount,
                    throwHttpErrors: false,
                })
                .json<CensusReport>();
            return <CensusData>{
                reachable: true,
                contents: response,
            };
        } catch (err) {
            logger.warn('checkCensusHttp failed', { err, url });
            return <CensusData>{
                reachable: false,
                contents: null,
            };
        }
    }

    async updateCensusReport(): Promise<CensusReport> | undefined {
        this.checkCensusHttp(this.prosodyCensusUrl).then((results) => {
            if (results.reachable) {
                return results.contents;
            } else {
                logger.error('room census endpoint is unreachable or gave bad response');
            }
        });
        return undefined;
    }
}
