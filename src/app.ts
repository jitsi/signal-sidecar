import config from './config';
import express from 'express';
import logger from './logger';
import HealthCollector, { HealthReport, HealthCollectorOptions } from './health_collector';

logger.info('starting up signal-sidecar with config', { config });

// health polling
const healthCollectorOptions: HealthCollectorOptions = {
    jicofoHealthUrl: config.JicofoURL,
    prosodyHealthUrl: config.ProsodyURL,
    statusFilePath: config.StatusPath,
    healthPollingInterval: config.PollingInterval,
};

const healthCollector = new HealthCollector(healthCollectorOptions);
let healthReport: HealthReport = undefined;

async function pollForHealth() {
    logger.debug('polling');
    try {
        healthReport = await healthCollector.updateHealthReport();
    } catch (err) {
        logger.error('pollForHealth error', { err });
        healthReport = undefined;
    }
    logger.debug('HEALTH REPORT: ' + JSON.stringify(healthReport));

    setTimeout(pollForHealth, healthCollectorOptions.healthPollingInterval * 1000);
}
pollForHealth();

// web handling
async function healthReportHandler(req: express.Request, res: express.Response) {
    if (healthReport) {
        res.status(200);
        res.send(JSON.stringify(healthReport));
    } else {
        res.sendStatus(500);
    }
}

const app = express();

app.get('/health', (req: express.Request, res: express.Response) => {
    res.sendStatus(200);
});

app.post('/signal/report', async (req, res, next) => {
    try {
        await healthReportHandler(req, res);
    } catch (err) {
        next(err);
    }
});

app.listen(config.HTTPServerPort, () => {
    logger.info(`...listening on :${config.HTTPServerPort}`);
});
