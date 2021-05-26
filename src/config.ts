import * as dotenv from 'dotenv';
import envalid from 'envalid';

dotenv.config();

const env = envalid.cleanEnv(process.env, {
    HTTP_PORT: envalid.num({ default: 6000 }),
    TCP_PORT: envalid.num({ default: 6060 }),
    LOG_LEVEL: envalid.str({ default: 'info' }),
    JICOFO_ORIG: envalid.str({ default: 'http://localhost:8888' }),
    PROSODY_ORIG: envalid.str({ default: 'http://localhost:5280' }),
    STATUS_PATH: envalid.str({ default: '/etc/jitsi/shard-status' }),
    POLLING_INTERVAL: envalid.num({ default: 5 }),
    PARTICIPANT_MAX: envalid.num({ default: 5000 }),
});

export default {
    HTTPServerPort: env.HTTP_PORT,
    TCPServerPort: env.TCP_PORT,
    LogLevel: env.LOG_LEVEL,
    JicofoOrig: env.JICOFO_ORIG,
    ProsodyOrig: env.PROSODY_ORIG,
    StatusPath: env.STATUS_PATH,
    PollingInterval: env.POLLING_INTERVAL,
    ParticipantMax: env.PARTICIPANT_MAX,
};
