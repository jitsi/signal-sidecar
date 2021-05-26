import config from './config';
import express from 'express';
import logger from './logger';
import HealthCollector, { HealthReport, HealthCollectorOptions } from './health_collector';

logger.info('signal-sidecar startup', { config });

// health polling
const healthCollectorOptions: HealthCollectorOptions = {
    jicofoHealthUrl: config.JicofoOrig + '/about/health',
    jicofoStatsUrl: config.JicofoOrig + '/stats',
    prosodyHealthUrl: config.ProsodyOrig + '/http-bind',
    statusFilePath: config.StatusPath,
    healthPollingInterval: config.PollingInterval,
};

const healthCollector = new HealthCollector(healthCollectorOptions);
const initHealthReport = <HealthReport>{
    healthy: false,
    status: 'unknown',
    services: {
        jicofoReachable: false,
        jicofoStatusCode: 0,
        jicofoStatsReachable: false,
        jicofoStatsStatusCode: 0,
        prosodyReachable: false,
        prosodyStatusCode: 0,
        statusFileFound: false,
        statusFileContents: '',
    },
    stats: {
        jicofoParticipants: null,
        jicofoConferences: null,
    },
};
let healthReport: HealthReport = initHealthReport;

async function pollForHealth() {
    logger.debug('entering pollForHealth', { report: healthReport });
    try {
        healthReport = await healthCollector.updateHealthReport();
    } catch (err) {
        logger.error('pollForHealth error', { err });
        healthReport = initHealthReport;
    }
    setTimeout(pollForHealth, healthCollectorOptions.healthPollingInterval * 1000);
}
pollForHealth();

// express handlers
const app = express();

async function healthReportHandler(req: express.Request, res: express.Response) {
    if (healthReport) {
        res.status(200);
        if (!healthReport.healthy) {
            res.status(500);
        }
        res.send(JSON.stringify(healthReport));
    } else {
        res.sendStatus(500);
    }
}

async function signalHealthHandler(req: express.Request, res: express.Response) {
    if (healthReport) {
        res.status(200);
        if (!healthReport.healthy) {
            res.status(503);
            res.send('NOT_OK');
        } else {
            res.send('OK');
        }
    } else {
        res.status(500);
        res.send('NOT_OK');
    }
}

// health of the signal-sidecar itself
app.get('/health', (req: express.Request, res: express.Response) => {
    res.sendStatus(200);
});

// overall health of signal node, intended to be a public endpoint
app.get(['/about/health', '/signal/health'], async (req, res, next) => {
    try {
        await signalHealthHandler(req, res);
    } catch (err) {
        next(err);
    }
});

// detailed health report intended for internal use for load balancing
app.get('/signal/report', async (req, res, next) => {
    try {
        await healthReportHandler(req, res);
    } catch (err) {
        next(err);
    }
});

app.listen(config.HTTPServerPort, () => {
    logger.info(`signal-sidecar listening on :${config.HTTPServerPort}`);
});
