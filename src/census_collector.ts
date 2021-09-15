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
            const response = await got.get(url, {
                headers: {
                    host: this.censusHost,
                },
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
            logger.error('failed to parse census data', pcensus);
            return null;
        }
    }

    async updateCensusReport(): Promise<CensusReport> {
        this.checkCensusHttp(this.prosodyCensusUrl).then((results) => {
            if (results.reachable && results.code == 200) {
                const censusRoomData = this.validateCensusJSON(results.contents);
                if (censusRoomData) {
                    return <CensusReport>{
                        rooms: censusRoomData,
                    };
                }
            } else {
                if (!results.reachable) {
                    logger.error('room census endpoint unreachable');
                } else {
                    logger.error('room census endpoint bad status: ' + results.code);
                }
            }
        });
        return <CensusReport>{
            rooms: [],
        };
    }
}
