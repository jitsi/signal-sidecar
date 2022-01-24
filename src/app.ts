import config from './config';
import express from 'express';
import logger from './logger';
import HealthCollector, { HealthReport, HealthCollectorOptions } from './health_collector';
import CensusCollector, { CensusReport, CensusCollectorOptions } from './census_collector';
import metrics from './metrics';

logger.info('signal-sidecar startup', { config });

/////////////////////////
// health polling counter
let lastPollCheckTime: number = new Date().valueOf();
let currentPollCount = 0;
const pollCheckDurationSeconds = 3600;
const idealPollCount = pollCheckDurationSeconds / config.PollingInterval;
logger.info('initalizing health polling counter', { pollCheckDurationSeconds, idealPollCount });

function checkPollCounter() {
    const secondsElapsed: number = (new Date().valueOf() - lastPollCheckTime) * 1000;
    if (secondsElapsed > pollCheckDurationSeconds) {
        logger.info(
            'attempted %d health checks in %d seconds; target is %d checks every %d seconds.',
            currentPollCount,
            secondsElapsed,
            idealPollCount,
            pollCheckDurationSeconds,
        );
        logger.info('current health report', { report: healthReport });
        lastPollCheckTime = new Date().valueOf();
        currentPollCount = 0;
    }
    currentPollCount++;
}

/////////////////////////
// health polling loop
const healthCollectorOptions: HealthCollectorOptions = {
    jicofoHealthUrl: config.JicofoOrig + '/about/health',
    jicofoStatsUrl: config.JicofoOrig + '/stats',
    prosodyHealthUrl: config.ProsodyOrig + '/http-bind',
    statusFilePath: config.StatusPath,
    participantMax: config.ParticipantMax,
    healthPollingInterval: config.PollingInterval,
    collectMetrics: config.Metrics,
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
let pollHealthy = false;

async function pollForHealth() {
    logger.debug('entering pollForHealth', { report: healthReport });
    checkPollCounter();
    try {
        healthReport = await healthCollector.updateHealthReport();
        if (!pollHealthy && healthReport.healthy) {
            logger.info('signal node switched from unhealthy to healthy');
        }
        pollHealthy = healthReport.healthy;
    } catch (err) {
        logger.error('pollForHealth error', { err });
        healthReport = initHealthReport;
    }
    setTimeout(pollForHealth, healthCollectorOptions.healthPollingInterval * 1000);
}
pollForHealth();

/////////////////////////
// census polling loop
const censusCollectorOptions: CensusCollectorOptions = {
    prosodyCensusUrl: config.ProsodyOrig + '/room-census',
    censusHost: config.CensusHost,
    censusPollingInterval: config.PollingInterval,
    collectMetrics: config.Metrics,
};
const censusCollector = new CensusCollector(censusCollectorOptions);

const initCensusReport = <CensusReport>{
    room_census: [],
};
let censusReport: CensusReport = initCensusReport;

async function pollForCensus() {
    logger.debug('entering pollForCensus', { report: censusReport });
    try {
        censusReport = await censusCollector.updateCensusReport();
    } catch (err) {
        logger.error('pollForCensus error', { err });
    }
    setTimeout(pollForCensus, censusCollectorOptions.censusPollingInterval * 1000);
}
if (config.CensusPoll) {
    pollForCensus();
}

////////////////////
// express handlers
const app = express();

async function healthReportHandler(req: express.Request, res: express.Response) {
    if (healthReport) {
        res.status(200);
        if (!healthReport.healthy) {
            logger.info('/signal/report returned 503', { report: healthReport });
            res.status(503);
        }
        res.send(JSON.stringify(healthReport));
    } else {
        logger.warn('/signal/health returned 500 due to no healthReport');
        res.sendStatus(500);
    }
}

async function signalHealthHandler(req: express.Request, res: express.Response) {
    if (config.Metrics) {
        metrics.SignalHealthCheckCounter.inc(1);
    }
    if (healthReport) {
        res.status(200);
        if (!healthReport.healthy) {
            logger.info('/health returned 503', { report: healthReport });
            if (config.Metrics) {
                metrics.SignalHealthCheckUnhealthyCounter.inc(1);
            }
            res.status(503);
            res.send('NOT_OK');
        } else {
            res.send('OK');
        }
    } else {
        logger.warn('/health returned 500 due to no healthReport');
        if (config.Metrics) {
            metrics.SignalHealthCheckUnhealthyCounter.inc(1);
        }
        res.status(500);
        res.send('NOT_OK');
    }
}

async function censusReportHandler(req: express.Request, res: express.Response) {
    if (censusReport) {
        res.status(200);
        res.send(JSON.stringify(censusReport));
    } else {
        logger.warn('census report requested and missing');
        res.sendStatus(500);
    }
}

/////////////////////////
// routing endpoints

app.use(['/about*', '/signal*'], metrics.middleware);

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

// census of rooms in the signal node
if (config.CensusPoll) {
    app.get('/signal/census', async (req, res, next) => {
        try {
            await censusReportHandler(req, res);
        } catch (err) {
            next(err);
        }
    });
}

if (config.Metrics) {
    metrics.registerHandler(app, '/metrics');
}

app.listen(config.HTTPServerPort, () => {
    logger.info(`signal-sidecar listening on :${config.HTTPServerPort}`);
});
