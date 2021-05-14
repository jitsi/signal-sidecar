import config from './config';
import express from 'express';
import logger from './logger';
import HealthCollector, { HealthReport, HealthCollectorOptions } from './health_collector';

logger.info('signal-sidecar startup', { config });

// health polling
const healthCollectorOptions: HealthCollectorOptions = {
    jicofoHealthUrl: config.JicofoURL,
    prosodyHealthUrl: config.ProsodyURL,
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
        prosodyReachable: false,
        prosodyStatusCode: 0,
        statusFileFound: false,
        statusFileContents: '',
    },
};
let healthReport: HealthReport = initHealthReport;

async function pollForHealth() {
    logger.debug('pollForHealth entry', { report: healthReport });
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

app.get('/health', (req: express.Request, res: express.Response) => {
    logger.debug('handlnig /health');
    res.sendStatus(200);
});

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
