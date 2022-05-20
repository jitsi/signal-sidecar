import * as dotenv from 'dotenv';
import envalid from 'envalid';

dotenv.config();

const env = envalid.cleanEnv(process.env, {
    HTTP_PORT: envalid.num({
        desc: 'http port of this service',
        default: 6000,
    }),
    TCP_PORT: envalid.num({
        desc: 'tcp port of this service for haproxy',
        default: 6060,
    }),
    JICOFO_ORIG: envalid.str({
        desc: 'base url of jicofo health',
        default: 'http://localhost:8888',
    }),
    PROSODY_ORIG: envalid.str({
        desc: 'base url of prosody rest api',
        default: 'http://localhost:5280',
    }),
    STATUS_PATH: envalid.str({
        desc: 'file to indicate ready/drain status of node',
        default: '/etc/jitsi/shard-status',
    }),
    POLLING_INTERVAL: envalid.num({
        desc: 'number of seconds between polling',
        default: 5,
    }),
    PARTICIPANT_MAX: envalid.num({
        desc: 'report node in drain state if participants exceed this value',
        default: 5000,
    }),
    WEIGHT_PARTICIPANTS: envalid.bool({
        desc: 'send weight via tcp agent based on % of max partipants',
        default: false,
    }),
    CENSUS_POLL: envalid.bool({
        desc: 'should the room census be polled?',
        default: false,
    }),
    CENSUS_HOST: envalid.host({
        desc: 'census conference host name',
        default: 'host.example.com',
    }),
    HEALTH_DAMPENING_INTERVAL: envalid.num({
        desc: 'seconds to wait before report can go healthy after last unhealthy',
        default: 30,
    }),
    DRAIN_GRACE_INTERVAL: envalid.num({
        desc: 'seconds for haproxy agent to report DRAIN before switching to DOWN',
        default: 120,
    }),
    METRICS: envalid.bool({
        desc: 'publish prometheus metrics?',
        default: true,
    }),
    LOG_LEVEL: envalid.str({
        choices: ['debug', 'info', 'warn', 'error'],
        default: 'info',
    }),
});

const out = {
    HTTPServerPort: env.HTTP_PORT,
    TCPServerPort: env.TCP_PORT,
    JicofoOrig: env.JICOFO_ORIG,
    ProsodyOrig: env.PROSODY_ORIG,
    StatusPath: env.STATUS_PATH,
    PollingInterval: env.POLLING_INTERVAL,
    ParticipantMax: env.PARTICIPANT_MAX,
    CensusPoll: env.CENSUS_POLL,
    CensusHost: env.CENSUS_HOST,
    WeightParticipants: env.WEIGHT_PARTICIPANTS,
    HealthDampeningInterval: env.HEALTH_DAMPENING_INTERVAL,
    DrainGraceInterval: <number>env.DRAIN_GRACE_INTERVAL,
    Metrics: env.METRICS,
    LogLevel: env.LOG_LEVEL,
};

if (out.DrainGraceInterval < out.HealthDampeningInterval) {
    out.DrainGraceInterval = out.HealthDampeningInterval + 1;
    console.log('WARNING: DRAIN_GRACE_INTERVAL should be > HEALTH_DAMPENING_INTERVAL; setting to equal +1');
}

export default out;
