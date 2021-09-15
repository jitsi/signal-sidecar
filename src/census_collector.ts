import logger from './logger';
import got from 'got';

export interface CensusData {
    reachable: boolean;
    code: number;
    contents: string;
}

export interface RoomData {
    room_name: string;
    participants: number;
    created_time: number;
}

export interface CensusReport {
    rooms: Array<RoomData>;
}

export interface CensusCollectorOptions {
    prosodyCensusUrl: string;
    censusPollingInterval: number;
}

export default class CensusCollector {
    private prosodyCensusUrl: string;
    private requestTimeout: number;
    private requestRetryCount: number;

    constructor(options: CensusCollectorOptions) {
        this.prosodyCensusUrl = options.prosodyCensusUrl;
        this.requestTimeout = 3 * 1000;
        this.requestRetryCount = 2;

        this.updateCensusReport = this.updateCensusReport.bind(this);
    }

    checkCensusHttp(url: string):CensusData {
        logger.debug('pulling census data from: ' + url);
        try {
            const response = await got.get(url, {
                responseType: 'json',
                timeout: this.requestTimeout,
                retry: this.requestRetryCount,
                throwHttpErrors: false,
            });
            return <CensusData>{
                reachable: true,
                code: response.statusCode,
                contents: response.body,
            };
        } catch (err) {
            logger.debug('checkCensusHttp failed', { err, url });
            return <CensusData>{
                reachable: false,
                code: 0,
                contents: '',
            };
        }
    }

    validateCensusJSON(pcensus: string): Array<RoomData> {
        try {
            const jsonArray: RoomData[] = JSON.parse(pcensus)['room_census'];
            return jsonArray;
        } catch (err) {
            logger.error('failed to parse: ', pcensus);
            return null;
        }
    }

    async updateCensusReport(): Promise<CensusReport> {
        const results: CensusData = this.checkCensusHttp(this.prosodyCensusUrl);
        const censusRoomData = this.validateCensusJSON(results.contents);
        if (!results.reachable || !censusRoomData || results.code != 200) {
            logger.warn('unable to update census');
            return null;
        }
        return <CensusReport>{
            rooms: censusRoomData,
        };
    }
}
