import * as dotenv from 'dotenv';
import envalid from 'envalid';

dotenv.config();

const env = envalid.cleanEnv(process.env, {
    HTTP_PORT: envalid.num({ default: 6000 }),
    TCP_PORT: envalid.num({ default: 6060 }),
    LOG_LEVEL: envalid.str({ default: 'info' }),
    JICOFO_URL: envalid.str(),
    PROSODY_URL: envalid.str(),
    STATUS_PATH: envalid.str(),
    POLLING_INTERVAL: envalid.num({ default: 30 }),
});

export default {
    HTTPServerPort: env.HTTP_PORT,
    TCPServerPort: env.TCP_PORT,
    LogLevel: env.LOG_LEVEL,
    JicofoURL: env.JICOFO_URL,
    ProsodyURL: env.PROSODY_URL,
    StatusPath: env.STATUS_PATH,
    PollingInterval: env.POLLING_INTERVAL,
};
