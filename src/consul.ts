import Consul from 'consul';
import logger from './logger';
import { HealthReport } from './health_collector';
import { RoomData } from './census_collector';

interface ConsulReport extends HealthReport {
    census: RoomData[];
}

export interface SidecarConsulOptions {
    host: string;
    port: string;
    secure: boolean;
    statusKey: string;
    reportKey: string;
}

type SidecarConsulCallback = (state: string) => void;

class SidecarConsul {
    private consul: Consul.Consul;

    private statusKey: string;
    private reportKey: string;
    private statusWatch: Consul.Watch;

    constructor(options: SidecarConsulOptions) {
        this.consul = new Consul({ host: options.host, port: options.port, secure: options.secure });
        this.statusKey = options.statusKey;
        this.reportKey = options.reportKey;
    }

    startWatch(cb: SidecarConsulCallback): void {
        this.statusWatch = this.consul.watch({
            method: this.consul.kv.get,
            options: { key: this.statusKey, stale: true },
            backoffFactor: 1000,
        });

        this.statusWatch.on('change', (data, res) => {
            logger.debug('watch change', { data, res });
            cb(data.Value);
        });

        this.statusWatch.on('error', (err) => {
            logger.debug('watch error', { err });
        });
    }

    stopWatch(): void {
        if (this.statusWatch) {
            this.statusWatch.end();
        } else {
            logger.error('Watch not started');
        }
    }

    async publishReport(health: HealthReport, census: RoomData[]): Promise<unknown> {
        const report: ConsulReport = {
            ...health,
            census,
        };
        return new Promise((resolve, reject) => {
            this.consul.kv
                .set(this.reportKey, JSON.stringify(report))
                .then((result) => {
                    logger.debug('KV report written successfully', { key: this.reportKey, result });
                    resolve(result);
                })
                .catch((err) => {
                    logger.error('KV report write error', { key: this.reportKey, err });
                    reject(err);
                });
        });
    }
}

export default SidecarConsul;
