import config from './config';
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
    shard: string;
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

    async checkCensusHttp(url: string): Promise<CensusData> {
        logger.debug('pulling census data from: ' + url);
        try {
            const got_method = got.get;
            const response = await got_method(url, {
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
	    logger.debug('validating census JSON', pcensus)
        let result: RoomData[] = []
        const jsonArray = JSON.parse(pcensus); // top level is an []
        jsonArray.forEach( element: RoomData => {
            logger.debug(element);
        });
        return jsonArray;
    }

    async updateCensusReport(): Promise<CensusReport> {
        // spawn concurrent calls
        const ccalls: Promise<CensusData>[] = [];
        ccalls.push(this.checkCensusHttp(this.prosodyCensusUrl));

        return Promise.all(ccalls).then((results: CensusData[]) => {
            const prosodyCensusReachable = results[0].reachable;
            const prosodyCensusStatusCode = results[0].code;
            const prosodyCensusContents = results[0].contents;

            const report = <CensusReport>{
	        shard: "insert shard here",
		rooms: prosodyCensusContents,  // Array<RoomData>
            };
            logger.debug('updateCensusReport return', report);
            return report;
        });
    }
}
