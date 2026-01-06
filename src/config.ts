import * as dotenv from 'dotenv';
import { cleanEnv, str, num, bool, host } from 'envalid';

dotenv.config();

const env = cleanEnv(process.env, {
    HTTP_PORT: num({
        desc: 'http port of this service',
        default: 6000,
    }),
    TCP_PORT: num({
        desc: 'tcp port of this service for haproxy',
        default: 6060,
    }),
    JICOFO_ORIG: str({
        desc: 'base url of jicofo health',
        default: 'http://localhost:8888',
    }),
    JICOFO_DUMP: str({
        desc: 'dump script to run if jicofo is unhealthy',
        default: '',
    }),
    PROSODY_ORIG: str({
        desc: 'base url of prosody rest api',
        default: 'http://localhost:5280',
    }),
    PROSODY_DUMP: str({
        desc: 'dump script to run if prosody is unhealthy',
        default: '',
    }),
    STATUS_PATH: str({
        desc: 'file to indicate ready/drain status of node',
        default: '/etc/jitsi/shard-status',
    }),
    POLLING_INTERVAL: num({
        desc: 'number of seconds between polling',
        default: 5,
    }),
    PARTICIPANT_MAX: num({
        desc: 'report node in drain state if participants exceed this value',
        default: 5000,
    }),
    WEIGHT_PARTICIPANTS: bool({
        desc: 'send weight via tcp agent based on % of max partipants',
        default: false,
    }),
    CENSUS_POLL: bool({
        desc: 'should the room census be polled?',
        default: false,
    }),
    CENSUS_HOST: host({
        desc: 'census conference host name',
        default: 'host.example.com',
    }),
    CENSUS_REPORTS: bool({
        desc: 'should consul be used to publish census reports in the signal reports?',
        default: false,
    }),
    HEALTH_DAMPENING_INTERVAL: num({
        desc: 'seconds to wait before report can go healthy after last unhealthy',
        default: 30,
    }),
    DRAIN_GRACE_INTERVAL: num({
        desc: 'seconds for haproxy agent to report DRAIN before switching to DOWN',
        default: 120,
    }),
    METRICS: bool({
        desc: 'publish prometheus metrics?',
        default: true,
    }),
    LOG_LEVEL: str({
        choices: ['debug', 'info', 'warn', 'error'],
        default: 'info',
    }),
    CONSUL_HOST: str({
        desc: 'consul http host',
        default: 'localhost',
    }),
    CONSUL_PORT: str({
        desc: 'consul http port',
        default: '8500',
    }),
    CONSUL_SECURE: bool({
        desc: 'consul https?',
        default: false,
    }),
    CONSUL_STATUS: bool({
        desc: 'should consul be used to read signal state?',
        default: false,
    }),
    CONSUL_REPORTS: bool({
        desc: 'should consul be used to publish signal reports?',
        default: false,
    }),
    CONSUL_STATUS_KEY: str({
        desc: 'path in consul kv store to read for shard state',
        default: 'shard-state',
    }),
    CONSUL_REPORT_KEY: str({
        desc: 'path in consul kv store to write reports',
        default: 'shard-report',
    }),
    CONSUL_REPORTS_INTERVAL: num({
        desc: 'seconds between writing health report to consul',
        default: 60,
    }),
});

const out = {
    HTTPServerPort: env.HTTP_PORT,
    TCPServerPort: env.TCP_PORT,
    JicofoOrig: env.JICOFO_ORIG,
    JicofoDump: env.JICOFO_DUMP,
    ProsodyOrig: env.PROSODY_ORIG,
    ProsodyDump: env.PROSODY_DUMP,
    StatusPath: env.STATUS_PATH,
    PollingInterval: env.POLLING_INTERVAL,
    ParticipantMax: env.PARTICIPANT_MAX,
    CensusPoll: env.CENSUS_POLL,
    CensusHost: env.CENSUS_HOST,
    CensusReports: env.CENSUS_REPORTS,
    WeightParticipants: env.WEIGHT_PARTICIPANTS,
    HealthDampeningInterval: env.HEALTH_DAMPENING_INTERVAL,
    DrainGraceInterval: <number>env.DRAIN_GRACE_INTERVAL,
    Metrics: env.METRICS,
    LogLevel: env.LOG_LEVEL,
    ConsulHost: env.CONSUL_HOST,
    ConsulPort: env.CONSUL_PORT,
    ConsulSecure: env.CONSUL_SECURE,
    ConsulStatus: env.CONSUL_STATUS,
    ConsulReports: env.CONSUL_REPORTS,
    ConsulReportsInterval: env.CONSUL_REPORTS_INTERVAL,
    ConsulStatusKey: env.CONSUL_STATUS_KEY,
    ConsulReportKey: env.CONSUL_REPORT_KEY,
};

if (out.DrainGraceInterval < out.HealthDampeningInterval) {
    out.DrainGraceInterval = out.HealthDampeningInterval + 1;
    console.log('WARNING: DRAIN_GRACE_INTERVAL should be > HEALTH_DAMPENING_INTERVAL; setting to equal +1');
}

export default out;
